import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { RegisterSWOptions } from "virtual:pwa-register";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn<(options?: RegisterSWOptions) => (reload?: boolean) => Promise<void>>(),
  flush: vi.fn(async () => true),
  open: vi.fn(() => false),
}));
vi.mock("virtual:pwa-register", () => ({ registerSW: mocks.register }));
vi.mock("./collab/session", () => ({
  EDITING_LOCK: "gachipad-editing",
  flushPendingSessions: mocks.flush,
  hasOpenSessions: mocks.open,
}));

const answer = (version: string) =>
  vi.fn(async () => new Response(JSON.stringify({ version }), { status: 200 }));

describe("app update", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.flush.mockReset().mockResolvedValue(true);
    mocks.open.mockReset().mockReturnValue(false);
    mocks.register.mockReset().mockReturnValue(async () => undefined);
    vi.stubEnv("VITE_APP_VERSION", "1.0.0");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("offers a reload only when the server runs another version", async () => {
    const update = await import("./app-update");
    const same = answer("1.0.0");
    vi.stubGlobal("fetch", same);
    await update.checkServerVersion(0);
    expect(same).toHaveBeenCalledWith(
      "/api/version",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(update.appUpdateState().available).toBe(false);

    vi.stubGlobal("fetch", answer("1.1.0"));
    await update.checkServerVersion(0);
    expect(update.appUpdateState()).toMatchObject({ available: true, serverVersion: "1.1.0" });
  });

  it("stays quiet when offline and asks again on the next trigger", async () => {
    const update = await import("./app-update");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    await expect(update.checkServerVersion(0)).resolves.toBeUndefined();
    expect(update.appUpdateState().available).toBe(false);
  });

  it("asks at most once per gap; a collab reconnect uses a short gap", async () => {
    const update = await import("./app-update");
    const fetch = answer("1.0.0");
    vi.stubGlobal("fetch", fetch);
    await update.checkServerVersion(0);
    await update.checkServerVersion();
    update.onCollabConnected();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hides the prompt on Later until yet another version shows up", async () => {
    const update = await import("./app-update");
    vi.stubGlobal("fetch", answer("1.1.0"));
    await update.checkServerVersion(0);
    update.dismissAppUpdate();
    expect(update.appUpdateState()).toMatchObject({ available: true, dismissed: true });
    vi.stubGlobal("fetch", answer("1.1.0"));
    await update.checkServerVersion(0);
    expect(update.appUpdateState().dismissed).toBe(true);
    vi.stubGlobal("fetch", answer("1.2.0"));
    await update.checkServerVersion(0);
    expect(update.appUpdateState()).toMatchObject({ serverVersion: "1.2.0", dismissed: false });
  });

  it("uses the installed Workbox registration in two tabs: only the approving tab reloads", async () => {
    // Exercise the library's real controlling handlers, rather than mocking registerSW's behavior.
    const require = createRequire(import.meta.url);
    const source = readFileSync(
      join(dirname(require.resolve("vite-plugin-pwa")), "client/build/register.js"),
      "utf8",
    )
      .replace('import("workbox-window")', "loadWorkbox()")
      .replace(/export \{[\s\S]*$/, "return registerSW;");
    type Handler = (event: { isUpdate: boolean }) => void;
    const tabs: Array<{
      handlers: Map<string, Handler[]>;
      reload: ReturnType<typeof vi.fn>;
      window: {
        location: { reload: ReturnType<typeof vi.fn> };
        setInterval: typeof vi.fn;
        addEventListener: typeof vi.fn;
      };
      registration: { waiting: object | null; update: ReturnType<typeof vi.fn> };
      update: typeof import("./app-update");
    }> = [];
    const skipWaiting = vi.fn();
    vi.stubEnv("PROD", true);
    vi.stubGlobal("document", { addEventListener: vi.fn(), visibilityState: "visible" });
    vi.stubGlobal("fetch", answer("1.1.0"));
    for (let i = 0; i < 2; i++) {
      vi.resetModules();
      const handlers = new Map<string, Handler[]>();
      const reload = vi.fn();
      const window = { location: { reload }, setInterval: vi.fn(), addEventListener: vi.fn() };
      const registration = { waiting: {}, update: vi.fn(async () => undefined) };
      class Workbox {
        addEventListener(name: string, handler: Handler) {
          handlers.set(name, [...(handlers.get(name) ?? []), handler]);
        }
        register() {
          return Promise.resolve(registration);
        }
        messageSkipWaiting() {
          skipWaiting();
        }
      }
      const register = new Function("navigator", "window", "loadWorkbox", source)(
        { serviceWorker: {} },
        window,
        async () => ({ Workbox }),
      ) as (options?: RegisterSWOptions) => (reload?: boolean) => Promise<void>;
      mocks.register.mockImplementation(register);
      vi.stubGlobal("navigator", { serviceWorker: {} });
      vi.stubGlobal("window", window);
      const update = await import("./app-update");
      update.startAppUpdates();
      await vi.waitFor(() => expect(handlers.has("waiting")).toBe(true));
      for (const handler of handlers.get("waiting") ?? []) handler({ isUpdate: true });
      tabs.push({ handlers, reload, window, registration, update });
    }
    const [clicked, later] = tabs;
    if (!clicked || !later) throw new Error("missing tabs");
    later.update.dismissAppUpdate();
    vi.stubGlobal("window", clicked.window);
    expect(await clicked.update.applyAppUpdate()).toBe(true);
    expect(skipWaiting).toHaveBeenCalledTimes(1);
    // The SW emits controlling in BOTH contexts, exactly as Workbox does across browser tabs.
    for (const tab of tabs) {
      vi.stubGlobal("window", tab.window);
      tab.registration.waiting = null;
      for (const handler of tab.handlers.get("controlling") ?? []) handler({ isUpdate: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(clicked.reload).toHaveBeenCalledTimes(1);
    expect(later.reload).not.toHaveBeenCalled();
    expect(later.update.appUpdateState().dismissed).toBe(false);
    vi.stubGlobal("window", later.window);
    await later.update.applyAppUpdate();
    expect(later.reload).toHaveBeenCalledTimes(1);
  });

  it("checks pending edits again when the new worker takes control", async () => {
    const reload = vi.fn();
    const registration = { waiting: {} as object | null, update: vi.fn(async () => undefined) };
    mocks.register.mockImplementation((options) => {
      options?.onRegisteredSW?.("sw.js", registration as unknown as ServiceWorkerRegistration);
      return async () => undefined;
    });
    vi.stubEnv("PROD", true);
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("window", {
      location: { reload },
      setInterval: vi.fn(),
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    vi.stubGlobal("fetch", answer("1.1.0"));
    const update = await import("./app-update");
    update.startAppUpdates();
    expect(await update.applyAppUpdate()).toBe(true);
    mocks.flush.mockResolvedValue(false);
    mocks.register.mock.calls[0]?.[0]?.onNeedReload?.();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    // A later controlling event cannot revive the failed approval.
    mocks.flush.mockResolvedValue(true);
    mocks.register.mock.calls[0]?.[0]?.onNeedReload?.();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    registration.waiting = null;
    await update.applyAppUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps unsent edits alive when the server cannot acknowledge them", async () => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    mocks.flush.mockResolvedValue(false);
    const update = await import("./app-update");
    expect(await update.applyAppUpdate()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    mocks.flush.mockResolvedValue(true);
    expect(await update.applyAppUpdate()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("expires tab approval and re-shows a dismissed prompt after a stale chunk fails", async () => {
    const reload = vi.fn();
    const addEventListener = vi.fn();
    const registration = { waiting: {}, update: vi.fn(async () => undefined) };
    mocks.register.mockImplementation((options) => {
      options?.onRegisteredSW?.("sw.js", registration as unknown as ServiceWorkerRegistration);
      return async () => undefined;
    });
    vi.stubEnv("PROD", true);
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("window", { location: { reload }, setInterval: vi.fn(), addEventListener });
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    vi.stubGlobal("fetch", answer("1.1.0"));
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      const update = await import("./app-update");
      update.startAppUpdates();
      expect(await update.applyAppUpdate()).toBe(true);
      now.mockReturnValue(131_000);
      update.dismissAppUpdate();
      mocks.register.mock.calls[0]?.[0]?.onNeedReload?.();
      await Promise.resolve();
      expect(reload).not.toHaveBeenCalled();
      expect(update.appUpdateState().dismissed).toBe(false);
      update.dismissAppUpdate();
      const preload = addEventListener.mock.calls.find(([name]) => name === "vite:preloadError");
      preload?.[1]();
      expect(update.appUpdateState()).toMatchObject({ available: true, dismissed: false });
      expect(reload).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  describe("a page nobody is using takes a waiting worker by itself", () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** A browser tab with a worker waiting. `load` runs the module again, as a reload does. */
    function browser(options: { locks?: object | null; storage?: Storage } = {}) {
      const stored = new Map<string, string>();
      const storage =
        options.storage ??
        ({
          getItem: (name: string) => stored.get(name) ?? null,
          setItem: (name: string, value: string) => void stored.set(name, value),
        } as unknown as Storage);
      const locks =
        options.locks === null
          ? undefined
          : (options.locks ?? { query: vi.fn(async () => ({ held: [], pending: [] })) });
      const reload = vi.fn();
      const skipWaiting = vi.fn(async () => undefined);
      const statechange: Array<() => void> = [];
      const worker = {
        state: "installed",
        addEventListener: (_name: string, handler: () => void) => void statechange.push(handler),
      };
      const registration = {
        waiting: worker as typeof worker | null,
        update: vi.fn(async () => undefined),
      };
      const onWindow = new Map<string, () => void>();
      const onDocument = new Map<string, () => void>();
      vi.stubEnv("PROD", true);
      vi.stubGlobal("navigator", { serviceWorker: {}, locks });
      vi.stubGlobal("sessionStorage", storage);
      vi.stubGlobal("document", {
        visibilityState: "visible",
        addEventListener: (name: string, handler: () => void) => void onDocument.set(name, handler),
      });
      vi.stubGlobal("window", {
        location: { reload },
        setInterval: vi.fn(),
        addEventListener: (name: string, handler: () => void) => void onWindow.set(name, handler),
      });
      vi.stubGlobal("fetch", answer("1.0.0"));
      mocks.register.mockReturnValue(skipWaiting);
      return {
        reload,
        skipWaiting,
        worker,
        statechange,
        registration,
        onWindow,
        onDocument,
        locks,
        /** Workbox's order for a worker already waiting: onNeedRefresh, then onRegisteredSW. */
        async load() {
          vi.resetModules();
          mocks.register.mockClear();
          onWindow.clear();
          const update = await import("./app-update");
          update.startAppUpdates();
          const sw = mocks.register.mock.calls[0]?.[0];
          if (registration.waiting) sw?.onNeedRefresh?.();
          sw?.onRegisteredSW?.("sw.js", registration as unknown as ServiceWorkerRegistration);
          await settle();
          return { update, sw };
        },
        activate() {
          worker.state = "activated";
          for (const handler of statechange) handler();
        },
      };
    }

    it("applies once a worker waits, and reloads when it is active", async () => {
      const tab = browser();
      await tab.load();
      expect(tab.skipWaiting).toHaveBeenCalledTimes(1);
      expect(tab.reload).not.toHaveBeenCalled();
      tab.activate();
      await settle();
      expect(tab.reload).toHaveBeenCalledTimes(1);
    });

    it("applies a worker already waiting at load without a version answer", async () => {
      const tab = browser();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise(() => {})),
      );
      await tab.load();
      expect(tab.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it("does not reload before the worker is active", async () => {
      const tab = browser();
      await tab.load();
      tab.worker.state = "activating";
      for (const handler of tab.statechange) handler();
      await settle();
      expect(tab.reload).not.toHaveBeenCalled();
    });

    it("applies a worker that starts waiting after the registration is known", async () => {
      const tab = browser();
      const waiting = tab.registration.waiting;
      tab.registration.waiting = null;
      const { sw } = await tab.load();
      expect(tab.skipWaiting).not.toHaveBeenCalled();
      tab.registration.waiting = waiting;
      sw?.onNeedRefresh?.();
      await settle();
      expect(tab.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it("looks again when the tab becomes visible and after a version check", async () => {
      const tab = browser();
      mocks.open.mockReturnValue(true);
      await tab.load();
      expect(tab.skipWaiting).not.toHaveBeenCalled();
      mocks.open.mockReturnValue(false);
      tab.onDocument.get("visibilitychange")?.();
      await settle();
      expect(tab.skipWaiting).toHaveBeenCalledTimes(1);

      const again = browser();
      mocks.open.mockReturnValue(true);
      const { update } = await again.load();
      mocks.open.mockReturnValue(false);
      await update.checkServerVersion(0);
      await settle();
      expect(again.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it("stays on the prompt while a document is open in this tab", async () => {
      const tab = browser();
      mocks.open.mockReturnValue(true);
      const { update } = await tab.load();
      expect(tab.skipWaiting).not.toHaveBeenCalled();
      expect(update.appUpdateState().available).toBe(true);
    });

    it.each([
      ["held", { held: [{ name: "gachipad-editing", mode: "shared" }], pending: [] }],
      ["being requested", { held: [], pending: [{ name: "gachipad-editing", mode: "shared" }] }],
    ])("stays on the prompt while another tab's editing lock is %s", async (_name, snapshot) => {
      const tab = browser({ locks: { query: vi.fn(async () => snapshot) } });
      await tab.load();
      expect(tab.skipWaiting).not.toHaveBeenCalled();
    });

    it("ignores other locks of this origin", async () => {
      const held = [{ name: "something-else", mode: "exclusive" }];
      const tab = browser({ locks: { query: vi.fn(async () => ({ held, pending: [] })) } });
      await tab.load();
      expect(tab.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["there are no Web Locks", null],
      ["they cannot be read", { query: vi.fn(async () => Promise.reject(new Error("denied"))) }],
    ])("counts as someone editing when %s", async (_name, locks) => {
      const tab = browser({ locks });
      const { update } = await tab.load();
      expect(tab.skipWaiting).not.toHaveBeenCalled();
      expect(update.appUpdateState().available).toBe(true);
    });

    it.each(["pointerdown", "keydown", "wheel", "touchstart", "dragenter", "paste", "input"])(
      "a %s since the load keeps the prompt, and the next load starts clean",
      async (name) => {
        const tab = browser();
        const waiting = tab.registration.waiting;
        tab.registration.waiting = null;
        const { sw } = await tab.load();
        tab.onWindow.get(name)?.();
        tab.registration.waiting = waiting;
        sw?.onNeedRefresh?.();
        await settle();
        expect(tab.skipWaiting).not.toHaveBeenCalled();

        await tab.load();
        expect(tab.skipWaiting).toHaveBeenCalledTimes(1);
      },
    );

    it("listens passively in the capture phase", async () => {
      const add = vi.fn();
      browser();
      vi.stubGlobal("window", { location: {}, setInterval: vi.fn(), addEventListener: add });
      const update = await import("./app-update");
      update.startAppUpdates();
      expect(add).toHaveBeenCalledWith(
        "pointerdown",
        expect.any(Function),
        expect.objectContaining({ capture: true, passive: true }),
      );
    });

    it("a document or a touch arriving during the lock check stops it", async () => {
      for (const arrive of ["document", "touch"]) {
        let answerQuery: (value: object) => void = () => {};
        const query = vi.fn(
          () =>
            new Promise((resolve) => {
              answerQuery = resolve;
            }),
        );
        const tab = browser({ locks: { query } });
        await tab.load();
        expect(query).toHaveBeenCalled();
        if (arrive === "document") mocks.open.mockReturnValue(true);
        else tab.onWindow.get("keydown")?.();
        answerQuery({ held: [], pending: [] });
        await settle();
        expect(tab.skipWaiting).not.toHaveBeenCalled();
        mocks.open.mockReturnValue(false);
      }
    });

    it("a document or a touch arriving during the activation stops the reload", async () => {
      const opened = browser();
      await opened.load();
      expect(opened.skipWaiting).toHaveBeenCalledTimes(1);
      mocks.open.mockReturnValue(true);
      opened.activate();
      await settle();
      expect(opened.reload).not.toHaveBeenCalled();

      mocks.open.mockReturnValue(false);
      const used = browser();
      await used.load();
      used.onWindow.get("pointerdown")?.();
      used.activate();
      await settle();
      expect(used.reload).not.toHaveBeenCalled();
    });

    it("never reloads on a version mismatch while nothing is waiting", async () => {
      const tab = browser();
      tab.registration.waiting = null;
      const { update } = await tab.load();
      vi.stubGlobal("fetch", answer("1.1.0"));
      await update.checkServerVersion(0);
      tab.onDocument.get("visibilitychange")?.();
      await settle();
      expect(tab.registration.update).toHaveBeenCalled();
      expect(update.appUpdateState().available).toBe(true);
      expect(tab.skipWaiting).not.toHaveBeenCalled();
      expect(tab.reload).not.toHaveBeenCalled();
    });

    it("tries once per tab and gap, however often it reloads and however often it looks", async () => {
      const tab = browser();
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      try {
        const { update, sw } = await tab.load();
        expect(tab.skipWaiting).toHaveBeenCalledTimes(1);
        sw?.onNeedRefresh?.();
        tab.onDocument.get("visibilitychange")?.();
        await update.checkServerVersion(0);
        await settle();
        expect(tab.skipWaiting).toHaveBeenCalledTimes(1);

        // The worker never took over, or another one waits right after the reload.
        now.mockReturnValue(1_000_000 + 60_000);
        await tab.load();
        expect(tab.skipWaiting).toHaveBeenCalledTimes(1);

        now.mockReturnValue(1_000_000 + 5 * 60_000);
        await tab.load();
        expect(tab.skipWaiting).toHaveBeenCalledTimes(2);
      } finally {
        now.mockRestore();
      }
    });

    it("without working session storage it does nothing and throws nothing", async () => {
      const refusing = {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      } as unknown as Storage;
      const noReads = browser({ storage: refusing });
      await noReads.load();
      expect(noReads.skipWaiting).not.toHaveBeenCalled();

      const noWrites = browser({
        storage: { ...refusing, getItem: () => null } as unknown as Storage,
      });
      await noWrites.load();
      expect(noWrites.skipWaiting).not.toHaveBeenCalled();
    });

    it("a refused activation stays quiet and leaves the prompt", async () => {
      const tab = browser();
      tab.skipWaiting.mockRejectedValue(new Error("gone"));
      const { update } = await tab.load();
      expect(tab.skipWaiting).toHaveBeenCalledTimes(1);
      expect(tab.reload).not.toHaveBeenCalled();
      expect(update.appUpdateState().available).toBe(true);
    });

    it("another tab's activation does not reload this tab through the approval path", async () => {
      const tab = browser({ locks: null });
      const { sw } = await tab.load();
      sw?.onNeedReload?.();
      await settle();
      expect(tab.reload).not.toHaveBeenCalled();
    });

    it("does nothing without service workers or in dev", async () => {
      const add = vi.fn();
      vi.stubEnv("PROD", true);
      vi.stubGlobal("navigator", {});
      vi.stubGlobal("document", { addEventListener: vi.fn() });
      vi.stubGlobal("window", { setInterval: vi.fn(), addEventListener: add });
      vi.stubGlobal("fetch", answer("1.1.0"));
      const plain = await import("./app-update");
      plain.startAppUpdates();
      await plain.checkServerVersion(0);
      await settle();
      expect(mocks.register).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalledWith("pointerdown", expect.anything(), expect.anything());

      vi.resetModules();
      vi.stubEnv("PROD", false);
      vi.stubGlobal("navigator", { serviceWorker: {} });
      const dev = await import("./app-update");
      dev.startAppUpdates();
      expect(mocks.register).not.toHaveBeenCalled();
    });
  });
});
