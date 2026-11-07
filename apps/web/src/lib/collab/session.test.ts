import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ApiError } from "../api";
import { DocSession, EDITING_LOCK, hasOpenSessions, isOutage } from "./session";

/** The provider callbacks these tests call. */
interface ProviderConfig {
  token: () => Promise<string>;
  onStateless: (data: { payload: string }) => void;
  onAuthenticationFailed: (data: { reason: string }) => void;
  onAuthenticated: (data: { scope: string }) => void;
  onUnsyncedChanges: (data: { number: number }) => void;
}

/** The provider and the IndexedDB copy, reduced to what DocSession calls. */
const fakes = vi.hoisted(() => {
  class Provider {
    static made: Provider[] = [];
    destroyed = 0;
    isAuthenticated = false;
    unsyncedChanges = 0;
    awareness = { setLocalStateField() {}, getLocalState: () => ({}), setLocalState() {} };
    onOpen = vi.fn(async () => undefined);
    connect = vi.fn(async () => undefined);
    constructor(readonly config: ProviderConfig) {
      Provider.made.push(this);
    }
    attach() {}
    destroy() {
      this.destroyed++;
    }
  }
  class Persistence {
    static made: Persistence[] = [];
    whenSynced = Promise.resolve();
    destroyed = 0;
    constructor(readonly name: string) {
      Persistence.made.push(this);
    }
    async destroy() {
      this.destroyed++;
    }
  }
  return {
    Provider,
    Persistence,
    joinShare: vi.fn(),
    leaveAfterDenial: vi.fn(async () => true),
    dropCopy: vi.fn(async (_shareId: string) => true),
  };
});

vi.mock("@hocuspocus/provider", () => ({ HocuspocusProvider: fakes.Provider }));
vi.mock("y-indexeddb", () => ({ IndexeddbPersistence: fakes.Persistence }));
vi.mock("./socket", () => ({
  acquireSocket: () => ({ socket: { status: "connected" }, release: () => {} }),
}));
vi.mock("../prefs", () => ({ subscribePrefs: () => () => {} }));
vi.mock("../device", () => ({
  CLOSE_TIMEOUT_MS: 4000,
  dropCopy: fakes.dropCopy,
  idbName: (shareId: string) => `gachipad:doc:${shareId}`,
  leaveAfterDenial: fakes.leaveAfterDenial,
  mayKeepCopy: () => true,
  noteCopy: () => true,
  registerHolder: () => () => {},
  within: (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      () => undefined,
    ),
}));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { joinShare: fakes.joinShare },
}));

const user = { clientId: "c1", name: "Ada", color: "#000000" };

function open(credentials = { editKey: "key-1" }) {
  return new DocSession({ shareId: "share1", user, role: "edit", credentials });
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fakes.Provider.made = [];
  fakes.Persistence.made = [];
  fakes.joinShare.mockReset();
  fakes.leaveAfterDenial.mockClear();
  fakes.dropCopy.mockReset();
  fakes.dropCopy.mockResolvedValue(true);
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the editing lock other tabs read before applying an update", () => {
  function fakeLocks() {
    const held: Array<{ name: string; mode: string }> = [];
    const request = vi.fn(
      async (name: string, options: { mode: string }, callback: () => Promise<unknown>) => {
        const lock = { name, mode: options.mode };
        held.push(lock);
        await callback();
        held.splice(held.indexOf(lock), 1);
      },
    );
    return { held, request };
  }

  it("is held shared from the first open document until the last one closes", async () => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    expect(hasOpenSessions()).toBe(false);
    const first = open();
    const second = open();
    expect(hasOpenSessions()).toBe(true);
    expect(locks.request).toHaveBeenCalledTimes(1);
    expect(locks.held).toMatchObject([{ name: EDITING_LOCK, mode: "shared" }]);

    first.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(locks.held).toHaveLength(1);

    second.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(locks.held).toHaveLength(0);
    expect(hasOpenSessions()).toBe(false);

    const third = open();
    expect(locks.request).toHaveBeenCalledTimes(2);
    expect(locks.held).toHaveLength(1);
    third.destroy();
  });

  it("opens a document without Web Locks, and when the lock is refused", async () => {
    vi.stubGlobal("navigator", {});
    open().destroy();
    const request = vi.fn(async () => Promise.reject(new Error("SecurityError")));
    vi.stubGlobal("navigator", { locks: { request } });
    const session = open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledTimes(1);
    session.destroy();
  });
});

describe("join failures", () => {
  it("only the API's own answer is a decision about access", () => {
    expect(isOutage(null)).toBe(true);
    expect(isOutage(new ApiError(0, "network", "Network error", null))).toBe(true);
    expect(isOutage(new ApiError(404, "unknown", "Not Found", null))).toBe(true);
    expect(isOutage(new ApiError(503, "unavailable", "down", null))).toBe(true);
    expect(isOutage(new ApiError(429, "rate_limited", "slow down", 2))).toBe(true);
    expect(isOutage(new ApiError(403, "forbidden", "no", null))).toBe(false);
    expect(isOutage(new ApiError(403, "pin_required", "pin", null))).toBe(false);
  });

  it("a join that never reached the API keeps the document, its copy and its key, and retries", async () => {
    vi.useFakeTimers();
    const session = open();
    const provider = fakes.Provider.made[0];
    if (!provider) throw new Error("no provider");
    fakes.joinShare.mockRejectedValueOnce(new ApiError(0, "network", "Network error", null));
    expect(await provider.config.token()).toBe("");
    session.doc.getText("t").insert(0, "typed offline");
    provider.config.onAuthenticationFailed({ reason: "permission-denied" });

    expect(fakes.leaveAfterDenial).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ denied: null, closed: null, lostEdits: false });
    expect(provider.destroyed).toBe(0);
    expect(fakes.Persistence.made[0]?.destroyed).toBe(0);
    expect(session.unsent()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.onOpen).toHaveBeenCalledTimes(1);
    fakes.joinShare.mockResolvedValueOnce({ token: "t", role: "edit" });
    expect(await provider.config.token()).toBe("t");
    expect(fakes.joinShare).toHaveBeenLastCalledWith("share1", { editKey: "key-1" });
    session.destroy();
  });

  it("the API's refusal ends the session and says the unsent edits are gone", async () => {
    const session = open();
    const provider = fakes.Provider.made[0];
    if (!provider) throw new Error("no provider");
    fakes.joinShare.mockRejectedValueOnce(new ApiError(403, "forbidden", "no", null));
    await provider.config.token();
    session.doc.getText("t").insert(0, "typed");
    provider.config.onAuthenticationFailed({ reason: "permission-denied" });
    expect(fakes.leaveAfterDenial).toHaveBeenCalledWith("share1");
    expect(session.getState()).toMatchObject({ denied: "unauthorized", lostEdits: true });
    session.destroy();
  });
});

describe("authentication", () => {
  it("the latest answer decides read-only, also after a late one for an earlier provider", () => {
    const session = open();
    const provider = fakes.Provider.made[0];
    if (!provider) throw new Error("no provider");
    // An earlier provider of this document asked as a viewer; its answer reaches this one first.
    provider.config.onAuthenticated({ scope: "readonly" });
    expect(session.getState().readOnly).toBe(true);
    provider.config.onAuthenticated({ scope: "read-write" });
    expect(session.getState().readOnly).toBe(false);
    session.destroy();
  });
});

describe("unsent edits", () => {
  it("are only edits typed here, until the server confirmed them", () => {
    const session = open();
    const provider = fakes.Provider.made[0];
    if (!provider) throw new Error("no provider");
    // A sync under way counts one in the provider, edits or not.
    provider.unsyncedChanges = 1;
    expect(session.unsent()).toBe(0);
    session.doc.getText("t").insert(0, "x");
    expect(session.unsent()).toBe(1);
    provider.unsyncedChanges = 0;
    provider.config.onUnsyncedChanges({ number: 0 });
    expect(session.unsent()).toBe(0);
    session.destroy();
  });
});

describe("resync", () => {
  for (const ending of ["leave", "destroy"] as const) {
    it(`a resync overtaken by ${ending} builds no new provider`, async () => {
      const session = open();
      const clearing = deferred();
      fakes.dropCopy.mockReturnValueOnce(clearing.promise.then(() => true));

      const resync = session.resync();
      if (ending === "leave") await session.leave();
      else session.destroy();
      clearing.resolve();
      await resync;

      expect(fakes.Provider.made).toHaveLength(1);
      expect(fakes.Persistence.made).toHaveLength(1);
      expect(session.provider).toBe(fakes.Provider.made[0]);
      session.destroy();
      expect(fakes.Provider.made[0]?.destroyed).toBe(1);
      if (ending === "leave") expect(session.getState().closed).toBe("left");
    });
  }

  it("a resync that was not overtaken starts over with a new provider", async () => {
    const session = open();
    await session.resync();
    expect(fakes.Provider.made).toHaveLength(2);
    expect(fakes.Provider.made[0]?.destroyed).toBe(1);
    expect(fakes.Persistence.made[0]?.destroyed).toBe(1);
    expect(fakes.dropCopy).toHaveBeenCalledWith("share1");
    expect(fakes.Persistence.made).toHaveLength(2);
    expect(session.getState().generation).toBe(1);
    session.destroy();
    expect(fakes.Provider.made[1]?.destroyed).toBe(1);
  });
});

describe("permission messages", () => {
  it("drops a refused local document and copy before reconnecting", async () => {
    const session = open();
    const previous = session.doc;
    previous.getMap("meta").set("title", "forged");
    previous.getText("file:main").insert(0, "my unsent main text");
    previous.getText("file:deleted").insert(0, "my unsent deleted file text");
    previous.getMap("files").set("main", "invalid file metadata");
    previous.getMap("file:invalid").set("bad", "not a text root");
    const resync = vi.spyOn(session, "resync");
    fakes.Provider.made[0]?.config.onStateless({
      payload: JSON.stringify({ type: "permission_refused" }),
    });
    await vi.waitFor(() => expect(fakes.Provider.made).toHaveLength(2));
    expect(resync).toHaveBeenCalledOnce();
    expect(session.doc).not.toBe(previous);
    expect(session.doc.getMap("meta").has("title")).toBe(false);
    expect(fakes.dropCopy).toHaveBeenCalledWith("share1");
    expect(session.getState().readOnly).toBe(true);
    expect(session.getState().unsentText).toEqual([
      { id: 0, fileId: "main", path: "main", text: "my unsent main text" },
      { id: 1, fileId: "deleted", path: "deleted", text: "my unsent deleted file text" },
    ]);
    expect(session.doc.getText("file:main").toString()).toBe("");
    session.dismissUnsentText();
    expect(session.getState().unsentText).toEqual([]);
    fakes.Provider.made[1]?.config.onAuthenticated({ scope: "read-write" });
    expect(session.getState().readOnly).toBe(false);
    session.destroy();
  });
  it("keeps only what this client changed when a share is too large, one copy per file", async () => {
    const session = open();
    const first = session.doc;
    const remote = new Y.Doc();
    remote.getText("file:theirs").insert(0, "someone else's text");
    Y.applyUpdate(first, Y.encodeStateAsUpdate(remote), fakes.Provider.made[0]);
    first.getText("file:mine").insert(0, "my refused file");
    const tooLarge = (index: number) =>
      fakes.Provider.made[index]?.config.onStateless({
        payload: JSON.stringify({ type: "too_large", maxDocBytes: 10 }),
      });
    tooLarge(0);
    await vi.waitFor(() => expect(fakes.Provider.made).toHaveLength(2));
    expect(session.getState().tooLarge).toBe(10);
    expect(session.getState().unsentText).toEqual([
      { id: 0, fileId: "mine", path: "mine", text: "my refused file" },
    ]);

    // Refused again, as every keystroke is at the limit: the newer copy replaces the older one.
    session.doc.getText("file:mine").insert(0, "typed more: ");
    tooLarge(1);
    await vi.waitFor(() => expect(fakes.Provider.made).toHaveLength(3));
    expect(session.getState().unsentText.map((saved) => saved.text)).toEqual(["typed more: "]);
    session.destroy();
  });

  it("does not keep text the server already confirmed when a later update is refused", async () => {
    const session = open();
    session.doc.getText("file:saved").insert(0, "confirmed");
    fakes.Provider.made[0]?.config.onUnsyncedChanges({ number: 0 });
    session.doc.getText("file:new").insert(0, "refused");
    fakes.Provider.made[0]?.config.onStateless({
      payload: JSON.stringify({ type: "too_large", maxDocBytes: 10 }),
    });
    await vi.waitFor(() => expect(fakes.Provider.made).toHaveLength(2));
    expect(session.getState().unsentText.map((saved) => saved.fileId)).toEqual(["new"]);
    session.destroy();
  });

  it("changes the document epoch as soon as a resync starts, before the document is replaced", async () => {
    const session = open();
    const doc = session.doc;
    const epoch = session.docEpoch;
    const resync = session.resync();
    expect(session.docEpoch).not.toBe(epoch);
    expect(session.doc).toBe(doc);
    await resync;
    expect(session.doc).not.toBe(doc);
    const next = session.docEpoch;
    session.destroy();
    expect(session.docEpoch).not.toBe(next);
  });

  it("updates capabilities live without discarding text edits", () => {
    const session = open();
    const previous = session.doc;
    const permissions = { rename: true, files: false, language: true };
    fakes.Provider.made[0]?.config.onStateless({
      payload: JSON.stringify({ type: "permissions", permissions }),
    });
    expect(session.getState().permissions).toEqual(permissions);
    expect(session.doc).toBe(previous);
    session.destroy();
  });
});
