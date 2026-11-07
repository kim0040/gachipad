import { describe, expect, it, vi } from "vitest";
import {
  collectDrop,
  collectDroppedFiles,
  MAX_COLLECTED_FILES,
  MAX_WALKED_ENTRIES,
} from "./dropped-files";

/** A tiny file system entry tree, shaped like what `webkitGetAsEntry` returns. */
interface FakeEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (ok: (entries: FakeEntry[]) => void, fail: (e: unknown) => void) => void;
  };
}

const fileEntry = (path: string, content = "x", fail = false): FakeEntry => ({
  isFile: true,
  isDirectory: false,
  name: path.slice(path.lastIndexOf("/") + 1),
  fullPath: `/${path}`,
  file: (ok, reject) =>
    fail
      ? reject(new Error("locked"))
      : ok(new File([content], path.slice(path.lastIndexOf("/") + 1))),
});

function dirEntry(path: string, children: FakeEntry[], failReading = false) {
  const reads = vi.fn();
  const entry: FakeEntry = {
    isFile: false,
    isDirectory: true,
    name: path.slice(path.lastIndexOf("/") + 1),
    fullPath: `/${path}`,
    createReader: () => {
      let done = false;
      return {
        readEntries: (ok, reject) => {
          reads();
          if (failReading) return reject(new Error("denied"));
          const batch = done ? [] : children;
          done = true;
          ok(batch);
        },
      };
    },
  };
  return Object.assign(entry, { reads });
}

function transferOf(entries: FakeEntry[]): DataTransfer {
  const items = entries.map((entry) => ({
    kind: "file",
    webkitGetAsEntry: () => entry,
    getAsFile: () => null,
  }));
  return { items, files: [], types: ["Files"] } as unknown as DataTransfer;
}

describe("collectDrop", () => {
  it("keeps the relative path of every file in a folder", async () => {
    const dropped = await collectDrop(
      transferOf([
        dirEntry("proj", [
          fileEntry("proj/a.py"),
          dirEntry("proj/src", [fileEntry("proj/src/b.py")]),
        ]),
      ]),
    );
    expect(
      dropped.files.map((file) => (file as File & { gachipadPath?: string }).gachipadPath),
    ).toEqual(["proj/a.py", "proj/src/b.py"]);
    expect(dropped.skipped).toEqual([]);
  });

  it("does not even walk dependency and build folders, and reports them", async () => {
    const names = [
      ".git",
      "node_modules",
      "__pycache__",
      ".venv",
      "venv",
      ".pytest_cache",
      ".mypy_cache",
      ".next",
      ".gradle",
      ".idea",
    ];
    const junk = names.map((name) => dirEntry(`proj/${name}`, [fileEntry(`proj/${name}/x.js`)]));
    const dropped = await collectDrop(
      transferOf([dirEntry("proj", [fileEntry("proj/main.py"), ...junk])]),
    );
    expect(dropped.files).toHaveLength(1);
    expect(dropped.skipped).toEqual(
      names.map((name) => ({ name: `proj/${name}`, reason: "excludedFolder" })),
    );
    for (const entry of junk) expect(entry.reads).not.toHaveBeenCalled();
  });

  it("turns a file that cannot be read into a skip and keeps the rest", async () => {
    const dropped = await collectDrop(
      transferOf([fileEntry("a.txt"), fileEntry("locked.txt", "x", true), fileEntry("b.txt")]),
    );
    expect(dropped.files.map((file) => file.name)).toEqual(["a.txt", "b.txt"]);
    expect(dropped.skipped).toEqual([{ name: "locked.txt", reason: "unreadable" }]);
  });

  it("turns a folder that cannot be listed into a skip", async () => {
    const dropped = await collectDrop(
      transferOf([dirEntry("secret", [], true), fileEntry("ok.txt")]),
    );
    expect(dropped.files.map((file) => file.name)).toEqual(["ok.txt"]);
    expect(dropped.skipped).toEqual([{ name: "secret", reason: "unreadable" }]);
  });

  it("leaves out the junk a file manager adds", async () => {
    const dropped = await collectDrop(
      transferOf([dirEntry("p", [fileEntry("p/.DS_Store"), fileEntry("p/a.txt")])]),
    );
    expect(dropped.files.map((file) => file.name)).toEqual(["a.txt"]);
    expect(dropped.skipped).toEqual([]);
  });

  it("reads past the cap only far enough to count what was left", async () => {
    const children = Array.from({ length: MAX_COLLECTED_FILES + 25 }, (_, n) =>
      fileEntry(`big/f${n}.txt`),
    );
    const dropped = await collectDrop(transferOf([dirEntry("big", children)]));
    expect(dropped.files).toHaveLength(MAX_COLLECTED_FILES);
    expect(dropped.skipped).toEqual([{ name: "", reason: "tooMany", count: 25 }]);
  });

  it("stops the walk at its limit and says the rest was not checked", async () => {
    const batch = (from: number, size: number) =>
      Array.from({ length: size }, (_, n) => fileEntry(`big/._${from + n}`));
    // A folder that never runs out, read a hundred entries at a time: only the limit ends the walk.
    let asked = 0;
    const flat: FakeEntry = {
      isFile: false,
      isDirectory: true,
      name: "big",
      fullPath: "/big",
      createReader: () => ({
        readEntries: (ok) => {
          asked++;
          ok(batch(asked * 100, 100));
        },
      }),
    };
    const later = dirEntry("later", [fileEntry("later/a.txt")]);
    const dropped = await collectDrop(transferOf([flat, later]));
    // The folder itself is one entry of the walk, and the entry over the limit ends it.
    expect(asked).toBe(Math.ceil(MAX_WALKED_ENTRIES / 100));
    expect(later.reads).not.toHaveBeenCalled();
    expect(dropped.skipped).toEqual([{ name: "", reason: "notChecked", count: 0 }]);
  });

  it("counts top-level entries towards the limit too", async () => {
    const entries = Array.from({ length: MAX_WALKED_ENTRIES + 3 }, (_, n) => ({
      ...fileEntry(`f${n}.txt`),
      file: vi.fn(fileEntry(`f${n}.txt`).file),
    }));
    const dropped = await collectDrop(transferOf(entries));
    expect(entries.filter((entry) => entry.file.mock.calls.length > 0)).toHaveLength(
      MAX_COLLECTED_FILES,
    );
    expect(dropped.skipped).toContainEqual({ name: "", reason: "notChecked", count: 0 });
  });

  it("falls back on the file handed over next to an entry that cannot read it", async () => {
    const entry = fileEntry("direct.txt", "x", true);
    const file = new File(["x"], "direct.txt");
    const transfer = {
      items: [{ kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => file }],
      files: [],
      types: ["Files"],
    } as unknown as DataTransfer;
    const dropped = await collectDrop(transfer);
    expect(dropped.files).toEqual([file]);
    expect(dropped.skipped).toEqual([]);
    expect((dropped.files[0] as File & { gachipadPath?: string }).gachipadPath).toBe("direct.txt");
  });

  it("keeps names in NFC, whatever form the file manager handed over", async () => {
    const nfd = "폴더/과제1.py".normalize("NFD");
    const dropped = await collectDrop(transferOf([fileEntry(nfd)]));
    const path = (dropped.files[0] as File & { gachipadPath?: string }).gachipadPath;
    expect(path).toBe("폴더/과제1.py");
  });

  it("reads the transfer before the first await: the browser empties it after the event", async () => {
    const entries = [fileEntry("a.txt")];
    const transfer = transferOf(entries);
    const pending = collectDrop(transfer);
    // What the browser does once the drop event has ended.
    (transfer as unknown as { items: unknown[] }).items = [];
    (transfer as unknown as { files: unknown[] }).files = [];
    expect((await pending).files.map((file) => file.name)).toEqual(["a.txt"]);
  });

  it("falls back to the plain file list when items are missing", async () => {
    const transfer = {
      files: [new File(["x"], "a.txt")],
      types: ["Files"],
    } as unknown as DataTransfer;
    expect((await collectDrop(transfer)).files.map((file) => file.name)).toEqual(["a.txt"]);
  });

  it("reports a folder as skipped in a browser that cannot list folders", async () => {
    const folder = new File([], "project");
    Object.defineProperty(folder, "slice", {
      value: () => ({ arrayBuffer: () => Promise.reject(new Error("is a directory")) }),
    });
    const plain = new File(["x"], "a.txt");
    const transfer = {
      items: [folder, plain].map((file) => ({ kind: "file", getAsFile: () => file })),
      files: [folder, plain],
      types: ["Files"],
    } as unknown as DataTransfer;
    const dropped = await collectDrop(transfer);
    expect(dropped.files.map((file) => file.name)).toEqual(["a.txt"]);
    expect(dropped.skipped).toEqual([{ name: "project", reason: "folder" }]);
  });

  it("never rejects, even when the transfer itself throws", async () => {
    const hostile = {
      get items(): never {
        throw new Error("gone");
      },
      files: [],
    } as unknown as DataTransfer;
    await expect(collectDrop(hostile)).resolves.toEqual({ files: [], skipped: [] });
    await expect(collectDroppedFiles(hostile)).resolves.toEqual([]);
  });
});
