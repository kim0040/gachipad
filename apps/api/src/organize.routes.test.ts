import {
  BUILTIN_TEMPLATES,
  defaultSettings,
  type Settings,
  type ShareListItem,
  type Template,
} from "@gachipad/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readContent } from "./docs.js";
import {
  type Client,
  createHarness,
  createShare,
  type Harness,
  integration,
  storedDoc,
} from "./testing/harness.js";

const errorCode = (response: { json: <T>() => T }) =>
  response.json<{ error: { code: string } }>().error.code;
const bearer = { authorization: "Bearer admin-token-for-tests" };

interface Labels {
  folder: string | null;
  tags: string[];
}

describe.skipIf(!integration)("share labels", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const list = async (client: Client) => (await client.get("/api/shares")).json<ShareListItem[]>();
  const labelsOf = async (client: Client, id: string) => {
    const item = (await list(client)).find((share) => share.id === id);
    return { folder: item?.folder, tags: item?.tags };
  };
  const put = (client: Client, id: string, body: unknown) =>
    client.put(`/api/shares/${id}/labels`, body);

  it("lists a share without labels with no folder and no tags", async () => {
    const owner = h.client();
    const { id } = await createShare(owner);
    expect(await labelsOf(owner, id)).toEqual({ folder: null, tags: [] });
  });

  it("stores folder and tags of an owned share, trimmed, and shows them in the list", async () => {
    const owner = h.client();
    const ownerId = await owner.clientId();
    const { id } = await createShare(owner);

    const response = await put(owner, id, { folder: "  Week 1 ", tags: [" loops ", "java"] });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ folder: "Week 1", tags: ["loops", "java"] });
    expect(await labelsOf(owner, id)).toEqual({ folder: "Week 1", tags: ["loops", "java"] });
    expect(await h.stores.labels.get(ownerId, id)).toMatchObject({
      clientId: ownerId,
      shareId: id,
      folder: "Week 1",
      tags: ["loops", "java"],
    });
  });

  it("replaces the previous labels and allows tags without a folder", async () => {
    const owner = h.client();
    const { id } = await createShare(owner);
    await put(owner, id, { folder: "A", tags: ["x", "y"] });
    const response = await put(owner, id, { folder: null, tags: ["z"] });
    expect(response.json()).toEqual({ folder: null, tags: ["z"] });
    expect(await labelsOf(owner, id)).toEqual({ folder: null, tags: ["z"] });
  });

  it("removes duplicate tags case-insensitively and keeps the first spelling", async () => {
    const owner = h.client();
    const { id } = await createShare(owner);
    const response = await put(owner, id, { folder: "F", tags: ["Java", "java", "JAVA", "Loops"] });
    expect(response.json<Labels>().tags).toEqual(["Java", "Loops"]);
  });

  it("deletes the entry when folder is empty and there are no tags", async () => {
    const owner = h.client();
    const ownerId = await owner.clientId();
    const { id } = await createShare(owner);
    await put(owner, id, { folder: "A", tags: ["x"] });
    for (const folder of [null, "", "   "]) {
      await put(owner, id, { folder: "A", tags: ["x"] });
      const response = await put(owner, id, { folder, tags: [] });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ folder: null, tags: [] });
      expect(await h.stores.labels.get(ownerId, id)).toBeNull();
    }
    expect(await labelsOf(owner, id)).toEqual({ folder: null, tags: [] });
  });

  it("enforces the limits: folder 60, 10 tags of at most 30 characters", async () => {
    const owner = h.client();
    const { id } = await createShare(owner);
    expect((await put(owner, id, { folder: "f".repeat(60), tags: [] })).statusCode).toBe(200);
    const tooLongFolder = await put(owner, id, { folder: "f".repeat(61), tags: [] });
    expect(tooLongFolder.statusCode).toBe(400);
    expect(errorCode(tooLongFolder)).toBe("validation");

    expect((await put(owner, id, { folder: null, tags: ["t".repeat(30)] })).statusCode).toBe(200);
    expect((await put(owner, id, { folder: null, tags: ["t".repeat(31)] })).statusCode).toBe(400);
    expect((await put(owner, id, { folder: null, tags: [""] })).statusCode).toBe(400);
    expect((await put(owner, id, { folder: null, tags: ["   "] })).statusCode).toBe(400);

    const ten = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    expect((await put(owner, id, { folder: null, tags: ten })).statusCode).toBe(200);
    expect((await put(owner, id, { folder: null, tags: [...ten, "tag10"] })).statusCode).toBe(400);
    // A duplicate does not count against the limit.
    const dup = await put(owner, id, { folder: null, tags: [...ten, "TAG3"] });
    expect(dup.statusCode).toBe(200);
    expect(dup.json<Labels>().tags).toEqual(ten);
    // The refused requests changed nothing.
    expect(await labelsOf(owner, id)).toEqual({ folder: null, tags: ten });
  });

  it("refuses malformed bodies and share ids", async () => {
    const owner = h.client();
    const { id } = await createShare(owner);
    for (const body of [
      {},
      { tags: [] },
      { folder: null },
      { folder: 5, tags: [] },
      { folder: null, tags: "a" },
    ]) {
      expect((await put(owner, id, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await put(owner, "not-an-id", { folder: null, tags: [] })).statusCode).toBe(400);
  });

  it("is private: each person sees only their own labels of a saved share", async () => {
    const owner = h.client();
    const guest = h.client();
    const { id } = await createShare(owner);
    await guest.post(`/api/shares/${id}/save`);

    await put(owner, id, { folder: "Owner folder", tags: ["o"] });
    await put(guest, id, { folder: "Guest folder", tags: ["g"] });

    expect(await labelsOf(owner, id)).toEqual({ folder: "Owner folder", tags: ["o"] });
    expect(await labelsOf(guest, id)).toEqual({ folder: "Guest folder", tags: ["g"] });
  });

  it("answers 404 for a share that is not in my shares", async () => {
    const owner = h.client();
    const stranger = h.client();
    const { id } = await createShare(owner);
    const strangerId = await stranger.clientId();

    const foreign = await put(stranger, id, { folder: "F", tags: ["x"] });
    expect(foreign.statusCode).toBe(404);
    expect(errorCode(foreign)).toBe("not_found");
    expect(await h.stores.labels.get(strangerId, id)).toBeNull();

    const missing = await put(stranger, "Zz9Zz9Zz", { folder: "F", tags: [] });
    expect(missing.statusCode).toBe(404);

    // Saving the share puts it into the stranger's list, and then it works.
    await stranger.post(`/api/shares/${id}/save`);
    expect((await put(stranger, id, { folder: "F", tags: ["x"] })).statusCode).toBe(200);
  });

  it("answers 404 for an expired share", async () => {
    const owner = h.client();
    const { id } = await createShare(owner);
    await h.stores.shares.update(id, { expiresAt: new Date(Date.now() - 1000) });
    expect((await put(owner, id, { folder: "F", tags: [] })).statusCode).toBe(404);
  });

  it("removes the labels of a share the person unsaves", async () => {
    const owner = h.client();
    const guest = h.client();
    const other = h.client();
    const guestId = await guest.clientId();
    const otherId = await other.clientId();
    const { id } = await createShare(owner);
    await guest.post(`/api/shares/${id}/save`);
    await other.post(`/api/shares/${id}/save`);
    await put(guest, id, { folder: "G", tags: ["g"] });
    await put(other, id, { folder: "O", tags: ["o"] });

    expect((await guest.delete(`/api/shares/${id}/save`)).statusCode).toBe(200);
    expect(await h.stores.labels.get(guestId, id)).toBeNull();
    // Another person's labels of the same share stay.
    expect(await h.stores.labels.get(otherId, id)).toMatchObject({ folder: "O" });
    // The share left the list, so labels can not be set any more.
    expect((await put(guest, id, { folder: "G", tags: [] })).statusCode).toBe(404);
  });

  it("keeps the labels of an owned share when its owner unsaves it", async () => {
    const owner = h.client();
    const ownerId = await owner.clientId();
    const { id } = await createShare(owner);
    await owner.post(`/api/shares/${id}/save`);
    await put(owner, id, { folder: "Mine", tags: ["a"] });

    await owner.delete(`/api/shares/${id}/save`);
    await owner.patch(`/api/shares/${id}`, { saved: false });
    // The share is still in the owner's list, so its labels are.
    expect(await h.stores.labels.get(ownerId, id)).toMatchObject({ folder: "Mine" });
    expect(await labelsOf(owner, id)).toEqual({ folder: "Mine", tags: ["a"] });
  });

  it("removes the labels of a banned person, and only theirs", async () => {
    const owner = h.client();
    const guest = h.client();
    const other = h.client();
    const guestId = await guest.clientId();
    const { id } = await createShare(owner);
    await put(owner, id, { folder: "Owner", tags: [] });
    await guest.post(`/api/shares/${id}/save`);
    await other.post(`/api/shares/${id}/save`);
    await put(guest, id, { folder: "G", tags: ["g"] });
    await put(other, id, { folder: "O", tags: [] });

    // A kick without a ban leaves the share in the guest's list.
    await owner.post(`/api/shares/${id}/kick`, { clientId: guestId, ban: false });
    expect(await h.stores.labels.get(guestId, id)).not.toBeNull();

    await owner.post(`/api/shares/${id}/kick`, { clientId: guestId, ban: true });
    expect(await h.stores.labels.get(guestId, id)).toBeNull();
    expect((await put(guest, id, { folder: "G", tags: [] })).statusCode).toBe(404);
    expect(await labelsOf(owner, id)).toEqual({ folder: "Owner", tags: [] });
    expect(await labelsOf(other, id)).toEqual({ folder: "O", tags: [] });
  });

  it("does not keep a label that raced with unsave or ban", async () => {
    const owner = h.client();
    const guest = h.client();
    const guestId = await guest.clientId();
    const { id } = await createShare(owner);
    await guest.post(`/api/shares/${id}/save`);

    // The person leaves the share, and their labels are deleted, between the membership check and the write.
    const set = h.stores.labels.set.bind(h.stores.labels);
    let leave: (() => Promise<unknown>) | null = () => guest.delete(`/api/shares/${id}/save`);
    h.stores.labels.set = async (...args) => {
      const run = leave;
      leave = null;
      await run?.();
      return set(...args);
    };
    try {
      expect((await put(guest, id, { folder: "G", tags: ["g"] })).statusCode).toBe(404);
      expect(await h.stores.labels.get(guestId, id)).toBeNull();

      // The same for a ban by the owner.
      await guest.post(`/api/shares/${id}/save`);
      leave = () => owner.post(`/api/shares/${id}/kick`, { clientId: guestId, ban: true });
      expect((await put(guest, id, { folder: "G", tags: ["g"] })).statusCode).toBe(404);
      expect(await h.stores.labels.get(guestId, id)).toBeNull();
    } finally {
      h.stores.labels.set = set;
    }
  });

  it("removes every person's labels when the owner deletes the share", async () => {
    const owner = h.client();
    const guest = h.client();
    const ownerId = await owner.clientId();
    const guestId = await guest.clientId();
    const { id } = await createShare(owner);
    const keep = await createShare(owner);
    await guest.post(`/api/shares/${id}/save`);
    await put(owner, id, { folder: "A", tags: ["a"] });
    await put(guest, id, { folder: "B", tags: [] });
    await put(owner, keep.id, { folder: "Keep", tags: [] });

    expect((await owner.delete(`/api/shares/${id}`)).statusCode).toBe(200);
    expect(await h.stores.labels.get(ownerId, id)).toBeNull();
    expect(await h.stores.labels.get(guestId, id)).toBeNull();
    expect(await h.stores.labels.get(ownerId, keep.id)).toMatchObject({ folder: "Keep" });
  });
});

describe.skipIf(!integration)("templates", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const putSettings = (patch: Partial<Settings>) =>
    h.client().put("/api/admin/settings", { ...defaultSettings(), ...patch }, bearer);
  const orgTemplate = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: "Team service",
    language: "go",
    description: "Our service skeleton",
    files: [{ path: "main.go", content: "package main\n" }],
    ...overrides,
  });

  it("lists the built-in templates first with i18n keys, and nothing else by default", async () => {
    const response = await h.client().get("/api/templates");
    expect(response.statusCode).toBe(200);
    const templates = response.json<Template[]>();
    expect(templates).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(templates.every((template) => template.builtin)).toBe(true);
    const java = templates.find((template) => template.id === "builtin-java");
    expect(java).toMatchObject({
      name: "template.java.name",
      description: "template.java.description",
      language: "java",
      files: [{ path: "Main.java" }],
    });
  });

  it("appends the templates of the settings after the built-in ones", async () => {
    expect(
      (await putSettings({ templates: [orgTemplate("org-a"), orgTemplate("org-b")] })).statusCode,
    ).toBe(200);
    const templates = (await h.client().get("/api/templates")).json<Template[]>();
    expect(templates.map((template) => template.id)).toEqual([
      ...BUILTIN_TEMPLATES.map((template) => template.id),
      "org-a",
      "org-b",
    ]);
    expect(templates.at(-1)).toMatchObject({
      builtin: false,
      name: "Team service",
      description: "Our service skeleton",
      files: [{ path: "main.go", content: "package main\n" }],
    });
    await putSettings({ templates: [] });
  });

  it("creates a share from every built-in template through POST /api/shares", async () => {
    const owner = h.client();
    const templates = (await owner.get("/api/templates")).json<Template[]>();
    for (const template of templates) {
      const { id } = await createShare(owner, {
        title: "From a template",
        language: template.language,
        files: template.files,
      });
      const content = readContent(await storedDoc(h.stores, id));
      expect(
        content.files.map((file) => file.path),
        template.id,
      ).toEqual(template.files.map((file) => file.path));
      expect(
        content.files.map((file) => file.content),
        template.id,
      ).toEqual(template.files.map((file) => file.content));
      expect(content.language).toBe(template.language);
    }
  });

  describe("settings validation", () => {
    const expectRefused = async (templates: unknown[], extra: Partial<Settings> = {}) => {
      const response = await putSettings({ ...extra, templates: templates as never });
      expect(response.statusCode, JSON.stringify(templates).slice(0, 80)).toBe(400);
      expect(errorCode(response)).toBe("validation");
      expect(
        (await h.client().get("/api/admin/settings", bearer)).json<Settings>().templates,
      ).toEqual([]);
    };

    it("stores valid templates and returns them with the settings", async () => {
      const response = await putSettings({ templates: [orgTemplate("org-a", { name: " Team " })] });
      expect(response.statusCode).toBe(200);
      expect(response.json<Settings>().templates[0]).toMatchObject({ id: "org-a", name: "Team" });
      const stored = (await h.client().get("/api/admin/settings", bearer)).json<Settings>();
      expect(stored.templates).toHaveLength(1);
      await putSettings({ templates: [] });
    });

    it("refuses duplicate ids", async () => {
      await expectRefused([orgTemplate("org-a"), orgTemplate("org-a")]);
    });

    it("refuses ids that start with builtin-", async () => {
      await expectRefused([orgTemplate("builtin-java")]);
    });

    it("refuses more than 50 templates", async () => {
      await expectRefused(Array.from({ length: 51 }, (_, i) => orgTemplate(`org-${i}`)));
    });

    it("refuses templates without a name, language or files, and bad ids", async () => {
      await expectRefused([orgTemplate("org-a", { name: "" })]);
      await expectRefused([orgTemplate("org-a", { language: "" })]);
      await expectRefused([orgTemplate("org-a", { files: [] })]);
      await expectRefused([orgTemplate("has space")]);
    });

    it("refuses duplicate or unsafe file paths", async () => {
      const file = (path: string) => ({ path, content: "x" });
      await expectRefused([orgTemplate("org-a", { files: [file("a.go"), file("a.go")] })]);
      await expectRefused([orgTemplate("org-a", { files: [file("../a.go")] })]);
      await expectRefused([orgTemplate("org-a", { files: [file("/etc/a.go")] })]);
    });

    it("refuses templates above 2 MiB together, and accepts a body above Fastify's 1 MiB default", async () => {
      const big = (id: string, size: number) =>
        orgTemplate(id, { files: [{ path: "a.txt", content: "x".repeat(size) }] });
      const half = 1024 * 1024 + 1000;
      // 1.1 MiB in one request used to fail with a bare 413.
      expect((await putSettings({ templates: [big("org-a", half)] })).statusCode).toBe(200);
      await putSettings({ templates: [] });
      // Two of them are 2.2 MiB together: refused by the schema, not by the body limit.
      await expectRefused([big("org-a", half), big("org-b", half)]);
      // Far above the cap the body limit answers 413 too_large.
      const huge = await putSettings({ templates: [big("org-a", 14 * 1024 * 1024)] });
      expect(huge.statusCode).toBe(413);
      expect(errorCode(huge)).toBe("too_large");
    });

    it("refuses a template larger than maxDocBytes", async () => {
      await expectRefused(
        [orgTemplate("org-a", { files: [{ path: "a.txt", content: "x".repeat(2000) }] })],
        { maxDocBytes: 1000 },
      );
    });
  });
});

describe.skipIf(!integration)("GET /api/settings/public", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it("returns only what the intro page and help texts need", async () => {
    const response = await h.client().get("/api/settings/public");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      contact: "",
      anonymousTtlHours: 24,
      historyRetentionDays: 7,
      maxUploadMB: 200,
      maxDocBytes: defaultSettings().maxDocBytes,
      guestAllowed: true,
    });
  });

  it("follows the admin settings and leaks nothing else", async () => {
    await h.client().put(
      "/api/admin/settings",
      {
        ...defaultSettings(),
        contact: "it-help@example.org",
        anonymousTtlHours: 48,
        historyRetentionDays: 30,
        maxUploadMB: 50,
        rooms: [{ name: "Lab 1", cidrs: ["10.0.1.0/24"] }],
        audit: { enabled: true, retentionDays: 10 },
      },
      bearer,
    );
    const body = (await h.client().get("/api/settings/public")).json<Record<string, unknown>>();
    expect(body).toEqual({
      contact: "it-help@example.org",
      anonymousTtlHours: 48,
      historyRetentionDays: 30,
      maxUploadMB: 50,
      maxDocBytes: defaultSettings().maxDocBytes,
      guestAllowed: true,
    });
  });

  it("is available to visitors that may not use the app without signing in", async () => {
    await h
      .client()
      .put(
        "/api/admin/settings",
        { ...defaultSettings(), guestAllowed: false, contact: "ask-it" },
        bearer,
      );
    const visitor = h.client();
    expect((await visitor.get("/api/templates")).statusCode).toBe(403);
    const response = await visitor.get("/api/settings/public");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ contact: "ask-it", guestAllowed: false });
  });
});
