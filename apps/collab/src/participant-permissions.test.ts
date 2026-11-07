import {
  AWARENESS_MAX_STATE_BYTES,
  generateClientId,
  participantPermissions,
  signCollabToken,
  YDOC,
} from "@gachipad/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { loadPersisted } from "./persisted-doc.js";
import type { CollabServer } from "./server.js";
import { Harness, servicesAvailable, sleep, TEST_SECRET, waitFor } from "./testing/harness.js";

const available = await servicesAvailable();
describe.runIf(available)("participant document permissions", () => {
  let h: Harness;
  let server: CollabServer;
  beforeAll(async () => {
    h = await Harness.create();
    server = await h.startServer();
  });
  afterAll(() => h?.close());

  async function room() {
    const share = await h.createShare({
      access: {
        default: "edit",
        editKey: "key",
        pinHash: null,
        requireApproval: false,
        nearby: false,
      },
    });
    const owner = await h.connect(server.webSocketURL, share.id, {
      role: "owner",
      clientId: share.ownerId,
    });
    await owner.synced;
    owner.doc.transact(() => {
      owner.doc.getMap(YDOC.meta).set("title", "Original");
      const file = new Y.Map();
      owner.doc.getMap(YDOC.files).set("main", file);
      file.set("path", "main.ts");
      file.set("language", "typescript");
      owner.text.insert(0, "current");
    });
    await waitFor(
      () =>
        server.collab.docs.get(share.id)?.document.getMap(YDOC.meta).get("title") === "Original",
      "seeded",
    );
    const editor = await h.connect(server.webSocketURL, share.id);
    const viewer = await h.connect(server.webSocketURL, share.id, { role: "view" });
    await Promise.all([editor.synced, viewer.synced]);
    return { share, owner, editor, viewer };
  }
  it("rejects an editor's mixed title/text update before broadcast and persistence, then resyncs cleanly", async () => {
    const { share, owner, editor, viewer } = await room();
    editor.doc.transact(() => {
      editor.doc.getMap(YDOC.meta).set("title", "FORBIDDEN_TITLE");
      editor.text.insert(0, "FORBIDDEN_TEXT");
    });
    await waitFor(
      () =>
        editor.stateless.some(
          (message) => (message as { type: string }).type === "permission_refused",
        ),
      "refused",
    );
    expect(owner.doc.getMap(YDOC.meta).get("title")).toBe("Original");
    expect(viewer.text.toString()).toBe("current");
    expect(
      viewer.received.some((bytes) => new TextDecoder().decode(bytes).includes("FORBIDDEN")),
    ).toBe(false);
    await server.collab.flushAll();
    const stored = new Y.Doc();
    const persisted = await loadPersisted(h.stores, share.id);
    if (persisted.state) Y.applyUpdate(stored, persisted.state);
    expect(stored.getMap(YDOC.meta).get("title")).toBe("Original");
    expect(stored.getText("file:main").toString()).toBe("current");
    // Like DocSession.resync: a fresh doc drops rejected CRDT clocks instead of merging the state.
    editor.destroy();
    const healed = await h.connect(server.webSocketURL, share.id, { clientId: editor.clientId });
    await healed.synced;
    expect(healed.doc.getMap(YDOC.meta).get("title")).toBe("Original");
    healed.text.insert(0, "allowed;");
    await waitFor(() => owner.text.toString() === "allowed;current", "text remains editable");
  });
  it("pushes toggles live, permits rename when enabled and refuses it again after revocation", async () => {
    const { share, owner, editor } = await room();
    await h.stores.shares.update(share.id, { access: { allowParticipantRename: true } });
    await h.publishPerm(share.id, { kind: "permissions", version: 1 });
    await waitFor(
      () =>
        editor.stateless.some(
          (m) => (m as { permissions?: { rename: boolean } }).permissions?.rename === true,
        ),
      "rename enabled live",
    );
    editor.doc.getMap(YDOC.meta).set("title", "Allowed");
    await waitFor(() => owner.doc.getMap(YDOC.meta).get("title") === "Allowed", "rename received");
    await h.stores.shares.update(share.id, { access: { allowParticipantRename: false } });
    await h.publishPerm(share.id, { kind: "permissions", version: 2 });
    await waitFor(
      () => participantPermissions(server.collab.docs.get(share.id)?.share.access).rename === false,
      "rename disabled",
    );
    editor.doc.getMap(YDOC.meta).set("title", "Refused");
    await waitFor(
      () => editor.stateless.some((m) => (m as { type: string }).type === "permission_refused"),
      "revoked rename refused",
    );
    expect(owner.doc.getMap(YDOC.meta).get("title")).toBe("Allowed");
  });
  it.each([false, true])(
    "accepts combined main/deleted-file text edits (offline: %s)",
    async (offline) => {
      const { share, owner, editor } = await room();
      owner.doc.transact(() => {
        const file = new Y.Map();
        owner.doc.getMap(YDOC.files).set("second", file);
        file.set("path", "second.ts");
        owner.doc.getText("file:second").insert(0, "old");
      });
      await waitFor(
        () => editor.doc.getText("file:second").toString() === "old",
        "second file received",
      );
      if (offline) editor.socket.disconnect();
      owner.doc.getMap(YDOC.files).delete("second");
      await waitFor(
        () => !server.collab.docs.get(share.id)?.document.getMap(YDOC.files).has("second"),
        "owner deletion applied",
      );
      if (!offline)
        await waitFor(() => !editor.doc.getMap(YDOC.files).has("second"), "deletion received");
      editor.doc.transact(() => {
        editor.text.insert(0, "accepted main;");
        editor.doc.getText("file:second").insert(0, "late edit;");
      });
      if (offline) await editor.socket.connect();
      await waitFor(
        () => owner.text.toString() === "accepted main;current",
        "main edit reaches owner",
      );
      expect(owner.doc.getMap(YDOC.files).has("second")).toBe(false);
      expect(
        editor.stateless.some((m) => (m as { type: string }).type === "permission_refused"),
      ).toBe(false);
    },
  );
  it("allows 50 updates/s and a 256 KiB paste, but closes a sustained update flood", async () => {
    const { owner, editor } = await room();
    const started = Date.now();
    for (let i = 0; i < 100; i++) {
      editor.text.insert(editor.text.length, "x");
      await sleep(20);
    }
    const paste = "p".repeat(256 * 1024);
    editor.text.insert(editor.text.length, paste);
    await waitFor(() => owner.text.toString().endsWith(paste), "fast typing and paste delivered");
    expect(editor.closes).toEqual([]);
    console.log(
      `update budget: 100 typing updates and 256 KiB paste delivered in ${Date.now() - started}ms`,
    );
    for (let i = 0; i < 500; i++) editor.text.insert(editor.text.length, "f");
    await waitFor(() => editor.closes.includes("Document update rate exceeded"), "flood closed");
  });
  it("refuses every viewer mutation even when all participant toggles are enabled", async () => {
    const { share, owner, viewer } = await room();
    await h.stores.shares.update(share.id, {
      access: {
        allowParticipantRename: true,
        allowParticipantFiles: true,
        allowParticipantLanguage: true,
      },
    });
    await h.publishPerm(share.id, { kind: "permissions", version: 1 });
    viewer.doc.transact(() => {
      viewer.doc.getMap(YDOC.meta).set("title", "viewer");
      viewer.doc.getMap(YDOC.files).delete("main");
      viewer.text.delete(0, viewer.text.length);
      viewer.doc.getArray(YDOC.comments).push([{ body: "viewer" }]);
    });
    await waitFor(
      () => viewer.stateless.some((m) => (m as { type: string }).type === "permission_refused"),
      "viewer refusal",
    );
    expect(owner.text.toString()).toBe("current");
    expect(owner.doc.getMap(YDOC.files).has("main")).toBe(true);
    expect(owner.doc.getArray(YDOC.comments).length).toBe(0);
  });
  it("stamps a lab's teacher as host, not the student who owns the copy", async () => {
    const share = await h.createShare({
      labId: "lab1",
      access: {
        default: "edit",
        editKey: "key",
        pinHash: null,
        requireApproval: false,
        nearby: false,
      },
    });
    // What apps/api mints for a lab: the student owns the copy, the teacher controls it.
    const token = (clientId: string, role: "owner" | "edit", controller: boolean) =>
      signCollabToken(
        {
          shareId: share.id,
          clientId,
          name: "Tester",
          color: "#336699",
          role,
          controller,
          exp: Math.floor(Date.now() / 1000) + 600,
        },
        TEST_SECRET,
      );
    const student = await h.connect(server.webSocketURL, share.id, {
      clientId: share.ownerId,
      token: await token(share.ownerId, "owner", false),
    });
    const teacherId = generateClientId();
    const teacher = await h.connect(server.webSocketURL, share.id, {
      clientId: teacherId,
      token: await token(teacherId, "edit", true),
    });
    const viewer = await h.connect(server.webSocketURL, share.id, { role: "view" });
    await Promise.all([student.synced, teacher.synced, viewer.synced]);
    student.provider.awareness?.setLocalStateField("fileId", "main");
    teacher.provider.awareness?.setLocalStateField("fileId", "main");
    await waitFor(() => {
      const states = [...(viewer.provider.awareness?.getStates().values() ?? [])];
      return states.filter((s) => s.fileId === "main").length === 2;
    }, "both states received");
    const states = [...(viewer.provider.awareness?.getStates().values() ?? [])];
    expect(states.find((s) => s.user?.clientId === teacherId)?.host).toBe(true);
    expect(states.find((s) => s.user?.clientId === share.ownerId)?.host).toBeUndefined();
  });
  it("holds awareness to its limit in bytes, not characters", async () => {
    const { editor, viewer } = await room();
    const noteOnViewer = () =>
      [...(viewer.provider.awareness?.getStates().values() ?? [])].find((s) => s.note)?.note;
    // Under the limit by both counts: it arrives.
    const ascii = "a".repeat(AWARENESS_MAX_STATE_BYTES / 2);
    editor.provider.awareness?.setLocalStateField("note", ascii);
    await waitFor(() => noteOnViewer() === ascii, "short note received");
    // As many characters, three bytes each: over the limit on the wire.
    const korean = "가".repeat(AWARENESS_MAX_STATE_BYTES / 2);
    expect(JSON.stringify({ note: korean }).length).toBeLessThan(AWARENESS_MAX_STATE_BYTES);
    expect(Buffer.byteLength(korean, "utf8")).toBeGreaterThan(AWARENESS_MAX_STATE_BYTES);
    editor.provider.awareness?.setLocalStateField("note", korean);
    await sleep(200);
    expect(noteOnViewer()).not.toBe(korean);
  });

  it("keeps file structure and language independent and ignores forged presenter awareness", async () => {
    const { share, owner, editor, viewer } = await room();
    await h.stores.shares.update(share.id, { access: { allowParticipantLanguage: true } });
    await h.publishPerm(share.id, { kind: "permissions", version: 1 });
    await waitFor(
      () => participantPermissions(server.collab.docs.get(share.id)?.share.access).language,
      "language allowed",
    );
    editor.doc.getMap<Y.Map<unknown>>(YDOC.files).get("main")?.set("language", "python");
    await waitFor(
      () => owner.doc.getMap<Y.Map<unknown>>(YDOC.files).get("main")?.get("language") === "python",
      "language received",
    );
    editor.provider.awareness?.setLocalStateField("presenting", true);
    await sleep(100);
    expect(
      [...(owner.provider.awareness?.getStates().values() ?? [])].some((s) => s.presenting),
    ).toBe(false);
    // The owner's state carries `host` from the server; an editor claiming it is stripped.
    owner.provider.awareness?.setLocalStateField("fileId", "main");
    editor.provider.awareness?.setLocalStateField("host", true);
    editor.provider.awareness?.setLocalStateField("fileId", "main");
    await waitFor(() => {
      const hosts = (viewer.provider.awareness?.getStates() ?? new Map()).values();
      const states = [...hosts].filter((s) => s.fileId === "main");
      return states.length === 2 && states.filter((s) => s.host === true).length === 1;
    }, "owner stamped as host");
    const seen = [...(viewer.provider.awareness?.getStates().values() ?? [])];
    expect(seen.find((s) => s.host === true)?.user.clientId).toBe(share.ownerId);
    editor.doc.getMap<Y.Map<unknown>>(YDOC.files).get("main")?.set("path", "renamed.py");
    await waitFor(
      () => editor.stateless.some((m) => (m as { type: string }).type === "permission_refused"),
      "structure refused",
    );
    expect(owner.doc.getMap<Y.Map<unknown>>(YDOC.files).get("main")?.get("path")).toBe("main.ts");
  });
});
