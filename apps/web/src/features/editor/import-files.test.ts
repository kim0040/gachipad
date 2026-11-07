import { MAX_FILES_PER_SHARE } from "@gachipad/shared";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addFile, fileText, readFiles, setFileLanguage } from "../../lib/collab/model";
import { excludedFolderIn, isJunkFile } from "./dropped-files";
import {
  decodeText,
  importFiles,
  MAX_FILE_BYTES,
  MAX_ZIP_FILES,
  normalizeImportPath,
} from "./import-files";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("decodeText", () => {
  it("turns Windows line endings into \\n and drops a byte order mark", () => {
    const text = new TextEncoder().encode("﻿a\r\nb\rc\n");
    expect(decodeText(text)).toBe("a\nb\nc\n");
  });

  it("reads UTF-16 files saved as Unicode on Windows", () => {
    // BOM, "h", "i", CR, LF in UTF-16LE.
    expect(decodeText(bytes(0xff, 0xfe, 0x68, 0, 0x69, 0, 0x0d, 0, 0x0a, 0))).toBe("hi\n");
  });

  it("falls back to the Korean Windows code page when the bytes are not UTF-8", () => {
    // "한글" in EUC-KR / CP949.
    expect(decodeText(bytes(0xc7, 0xd1, 0xb1, 0xdb))).toBe("한글");
  });

  it("skips binary files", () => {
    expect(decodeText(bytes(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00))).toBeNull();
  });
});

describe("isJunkFile", () => {
  it("recognises what Finder, Explorer and Office leave behind", () => {
    for (const path of [
      ".DS_Store",
      "src/.DS_Store",
      "Thumbs.db",
      "desktop.ini",
      "src/._main.c",
      "~$report.docx",
      "__MACOSX/src/._main.c",
    ]) {
      expect(isJunkFile(path), path).toBe(true);
    }
  });

  it("keeps real files, including dot files people write", () => {
    for (const path of [".gitignore", "src/main.ts", "docs/desktop-notes.md", "a._b"]) {
      expect(isJunkFile(path), path).toBe(false);
    }
  });
});

function emptyShare() {
  const doc = new Y.Doc();
  const file = new Y.Map();
  doc.getMap("files").set("main", file);
  file.set("path", "main.txt");
  file.set("order", 0);
  setFileLanguage(doc, "main", "text");
  return doc;
}

/** A share that already holds some files. */
function shareWith(files: Record<string, string>) {
  const doc = new Y.Doc();
  for (const [path, content] of Object.entries(files)) addFile(doc, path, "text", content);
  return doc;
}

const texts = (doc: Y.Doc) =>
  Object.fromEntries(readFiles(doc).map((file) => [file.path, fileText(doc, file.id).toString()]));

/** A file whose contents cannot be read, like a file removed or locked after the drop. */
function unreadable(name: string): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.reject(new Error("denied")) });
  return file;
}

/** A file that was dropped inside a folder. */
function inFolder(path: string, content: string | Uint8Array = "x"): File {
  const file = new File([content as BlobPart], path.slice(path.lastIndexOf("/") + 1));
  (file as File & { gachipadPath?: string }).gachipadPath = path;
  return file;
}

describe("import permissions", () => {
  it("keeps an existing file language when only file management is allowed", async () => {
    const doc = emptyShare();
    const result = await importFiles(doc, [new File(["print(1)"], "new.py")], {
      canChangeLanguage: false,
    });
    expect(result.added).toBe(1);
    expect(readFiles(doc)[0]).toMatchObject({ path: "new.py", language: "text" });
    expect(doc.getMap("meta").get("language")).toBe("text");
  });
  it("does not apply an import if permission was revoked while reading files", async () => {
    const doc = emptyShare();
    const result = await importFiles(doc, [new File(["print(1)"], "new.py")], {
      mayApply: () => false,
    });
    expect(result.added).toBe(0);
    expect(result.refused).toBe(true);
    expect(readFiles(doc)[0]?.path).toBe("main.txt");
    expect(doc.getText("file:main").toString()).toBe("");
  });
});

describe("a first file into a fresh share", () => {
  it("replaces the empty placeholder file and detects the language", async () => {
    const doc = emptyShare();
    const result = await importFiles(doc, [new File(["print(1)\n"], "main.py")]);
    expect(result).toMatchObject({ added: 1, addedPaths: ["main.py"], firstId: "main" });
    expect(readFiles(doc)).toHaveLength(1);
    expect(readFiles(doc)[0]).toMatchObject({ path: "main.py", language: "python" });
    expect(fileText(doc, "main").toString()).toBe("print(1)\n");
  });

  it("reads the file list when the files are applied, not before they were read", async () => {
    const doc = emptyShare();
    const slow = new File(["print(1)"], "slow.py");
    Object.defineProperty(slow, "arrayBuffer", {
      value: async () => {
        // Someone else adds a file while this one is being read.
        addFile(doc, "theirs.py", "python", "keep me");
        return new TextEncoder().encode("print(1)").buffer;
      },
    });
    const result = await importFiles(doc, [slow]);
    expect(result.added).toBe(1);
    expect(texts(doc)).toEqual({ "main.txt": "", "theirs.py": "keep me", "slow.py": "print(1)" });
  });

  it("does not replace a placeholder that someone has typed into", async () => {
    const doc = emptyShare();
    fileText(doc, "main").insert(0, "typed");
    await importFiles(doc, [new File(["a"], "a.txt")]);
    expect(texts(doc)).toEqual({ "main.txt": "typed", "a.txt": "a" });
  });
});

describe("a file whose name is already taken", () => {
  it("adds nothing for the same text and points at the existing file", async () => {
    const doc = shareWith({ "main.py": "print(1)\n" });
    const id = readFiles(doc)[0]?.id;
    const result = await importFiles(doc, [new File(["print(1)\r\n"], "main.py")]);
    expect(result).toMatchObject({ added: 0, duplicates: ["main.py"], firstId: id });
    expect(readFiles(doc)).toHaveLength(1);
  });

  it("never overwrites different text: it is added as main (2).py and both names are reported", async () => {
    const doc = shareWith({ "main.py": "mine", "keep.txt": "k" });
    const result = await importFiles(doc, [new File(["theirs"], "main.py")]);
    expect(result.renamed).toEqual([{ from: "main.py", to: "main (2).py" }]);
    expect(result.addedPaths).toEqual(["main (2).py"]);
    expect(texts(doc)).toEqual({ "main.py": "mine", "keep.txt": "k", "main (2).py": "theirs" });
  });

  it("does not make another copy of a file it already added under a number", async () => {
    const doc = shareWith({ "main.py": "mine" });
    await importFiles(doc, [new File(["theirs"], "main.py")]);
    const again = await importFiles(doc, [new File(["theirs"], "main.py")]);
    expect(again.added).toBe(0);
    expect(again.duplicates).toEqual(["main (2).py"]);
    expect(readFiles(doc)).toHaveLength(2);
  });

  it("numbers on past a taken number", async () => {
    const doc = shareWith({ "a.txt": "1", "a (2).txt": "2" });
    const result = await importFiles(doc, [new File(["3"], "a.txt")]);
    expect(result.addedPaths).toEqual(["a (3).txt"]);
  });

  it("keeps folder paths: the same name in another folder is another file", async () => {
    const doc = shareWith({ "main.py": "x" });
    const result = await importFiles(doc, [inFolder("src/main.py", "x")]);
    expect(result.addedPaths).toEqual(["src/main.py"]);
    expect(result.duplicates).toEqual([]);
  });
});

describe("what is skipped, with its reason", () => {
  it("names a binary file", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [
      new File([new Uint8Array([0x89, 0x50, 0, 0])], "logo.png"),
    ]);
    expect(result.added).toBe(0);
    expect(result.skipped).toEqual([{ name: "logo.png", reason: "binary" }]);
  });

  it("names a file over the size limit without reading it", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1).fill(97)], "big.txt");
    Object.defineProperty(big, "arrayBuffer", { value: () => Promise.reject(new Error("read")) });
    const result = await importFiles(doc, [big]);
    expect(result.skipped).toEqual([{ name: "big.txt", reason: "tooBig" }]);
  });

  it("turns one unreadable file into a skip and still adds the others", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [unreadable("gone.txt"), new File(["b"], "b.txt")]);
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([{ name: "gone.txt", reason: "unreadable" }]);
    expect(texts(doc)["b.txt"]).toBe("b");
  });

  it("stops at the share's file limit and names what was left out", async () => {
    const doc = new Y.Doc();
    for (let n = 0; n < MAX_FILES_PER_SHARE - 1; n++) addFile(doc, `f${n}.txt`, "text", `${n}`);
    const result = await importFiles(doc, [
      new File(["x"], "one.txt"),
      new File(["y"], "two.txt"),
      new File(["z"], "three.txt"),
    ]);
    expect(result.added).toBe(1);
    expect(readFiles(doc)).toHaveLength(MAX_FILES_PER_SHARE);
    expect(result.skipped).toEqual([
      { name: "two.txt", reason: "tooMany" },
      { name: "three.txt", reason: "tooMany" },
    ]);
  });

  it("carries skips found while the drop was collected", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [new File(["b"], "b.txt")], {
      skipped: [{ name: "node_modules", reason: "excludedFolder" }],
    });
    expect(result.skipped).toEqual([{ name: "node_modules", reason: "excludedFolder" }]);
  });
});

describe("the share's size limit", () => {
  it("adds files until the room is used up, then names what did not fit", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const room = Y.encodeStateAsUpdate(doc).byteLength;
    const content = "x".repeat(2000);
    const result = await importFiles(
      doc,
      [
        new File([content], "one.txt"),
        new File([content], "two.txt"),
        new File([content], "three.txt"),
      ],
      // Room for the 16 KB kept free for typing, the document, and a little over two files.
      { maxDocBytes: () => 16 * 1024 + room + 2 * 2000 + 700 },
    );
    expect(result.addedPaths).toEqual(["one.txt", "two.txt"]);
    expect(result.skipped).toEqual([{ name: "three.txt", reason: "shareFull" }]);
    // What was applied fits: the update the server would measure stays under the limit.
    expect(Y.encodeStateAsUpdate(doc).byteLength).toBeLessThan(16 * 1024 + room + 2 * 2000 + 700);
  });

  it("adds nothing, and says so, when even the first file does not fit", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [new File(["x".repeat(5000)], "big.txt")], {
      maxDocBytes: () => 1000,
    });
    expect(result.added).toBe(0);
    expect(result.skipped).toEqual([{ name: "big.txt", reason: "shareFull" }]);
    expect(readFiles(doc)).toHaveLength(1);
  });

  it("takes the empty placeholder's replacement into the same budget", async () => {
    const doc = emptyShare();
    const result = await importFiles(doc, [new File(["x".repeat(5000)], "big.txt")], {
      maxDocBytes: () => 1000,
    });
    expect(result.skipped).toEqual([{ name: "big.txt", reason: "shareFull" }]);
    expect(readFiles(doc)[0]?.path).toBe("main.txt");
  });
});

describe("normalizeImportPath", () => {
  it("makes separators slashes and drops empty and dot parts", () => {
    expect(normalizeImportPath("a\\b//./c.txt")).toBe("a/b/c.txt");
    expect(normalizeImportPath("/abs/file.txt")).toBe("abs/file.txt");
  });
  it("refuses what could leave its folder, a drive, control characters and long paths", () => {
    for (const bad of [
      "../x.txt",
      "a/../../x",
      "C:\\x.txt",
      "c:/x",
      "a\u0000b",
      "",
      "/",
      "x/".repeat(200),
    ]) {
      expect(normalizeImportPath(bad), bad).toBeNull();
    }
  });
  it("keeps names that only look odd", () => {
    expect(normalizeImportPath("..hidden/file")).toBe("..hidden/file");
    expect(normalizeImportPath("a/c:/x")).toBe("a/c:/x");
  });
});

describe("excluded folders", () => {
  it("finds a dependency or build folder in a path, not in its file name", () => {
    expect(excludedFolderIn("proj/node_modules/pkg/index.js")).toBe("proj/node_modules");
    expect(excludedFolderIn(".git/config")).toBe(".git");
    expect(excludedFolderIn("a/venv/lib/x.py")).toBe("a/venv");
    expect(excludedFolderIn("src/main.py")).toBeNull();
    expect(excludedFolderIn("docs/node_modules")).toBeNull();
    for (const name of [
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
    ]) {
      expect(excludedFolderIn(`${name}/x`), name).toBe(name);
    }
  });

  it("skips them as one named entry when a picked folder contains them", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [
      inFolder("proj/src/main.py", "print(1)"),
      inFolder("proj/node_modules/x/index.js", "1"),
      inFolder("proj/node_modules/y/index.js", "2"),
      inFolder("proj/.git/HEAD", "ref"),
    ]);
    expect(result.addedPaths).toEqual(["proj/src/main.py"]);
    expect(result.skipped).toEqual([
      { name: "proj/node_modules", reason: "excludedFolder" },
      { name: "proj/.git", reason: "excludedFolder" },
    ]);
  });
});

describe("zip files", () => {
  const zip = (entries: Record<string, string | Uint8Array>) =>
    new File(
      [
        zipSync(
          Object.fromEntries(
            Object.entries(entries).map(([name, data]) => [
              name,
              typeof data === "string" ? strToU8(data) : data,
            ]),
          ),
        ),
      ],
      "pack.zip",
    );

  it("adds the text files of an archive and skips what is not text", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [
      zip({
        "src/main.py": "print(1)",
        "logo.png": new Uint8Array([1, 0, 2]),
        "notes/": new Uint8Array(),
      }),
    ]);
    expect(result.addedPaths).toEqual(["src/main.py"]);
    expect(result.skipped).toEqual([{ name: "logo.png", reason: "binary" }]);
  });

  it("refuses entries that climb out of the share, start at a root or name a drive", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [
      zip({ "../evil.txt": "x", "C:\\win.txt": "x", "/abs.txt": "x", "ok.txt": "ok" }),
    ]);
    expect(result.addedPaths.sort()).toEqual(["abs.txt", "ok.txt"]);
    expect(result.skipped.map((skip) => [skip.name, skip.reason])).toEqual(
      expect.arrayContaining([
        ["../evil.txt", "badPath"],
        ["C:/win.txt", "badPath"],
      ]),
    );
    expect(Object.keys(texts(doc))).not.toContain("../evil.txt");
  });

  it("leaves excluded folders in an archive unread", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [
      zip({ "p/node_modules/x.js": "1", "p/.git/HEAD": "r", "p/a.py": "1" }),
    ]);
    expect(result.addedPaths).toEqual(["p/a.py"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { name: "p/node_modules", reason: "excludedFolder" },
        { name: "p/.git", reason: "excludedFolder" },
      ]),
    );
  });

  it("is bounded by the entries it declares before anything is inflated", async () => {
    const entries: Record<string, string> = {};
    for (let n = 0; n < MAX_ZIP_FILES + 20; n++) entries[`f${n}.txt`] = "x";
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [zip(entries)]);
    // Only up to the share's file limit is added, and the archive is reported as too big a bundle.
    expect(readFiles(doc)).toHaveLength(MAX_FILES_PER_SHARE);
    expect(result.skipped.some((skip) => skip.reason === "zipTooMany")).toBe(true);
  });

  it("skips an entry that declares more than a file may hold, without inflating it", async () => {
    const bomb = new Uint8Array(MAX_FILE_BYTES + 1024).fill(97);
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [zip({ "huge.txt": bomb, "small.txt": "s" })]);
    expect(result.addedPaths).toEqual(["small.txt"]);
    expect(result.skipped).toEqual([{ name: "huge.txt", reason: "tooBig" }]);
  });

  it("stops taking entries once the archive would unpack past its total", async () => {
    const chunk = new Uint8Array(MAX_FILE_BYTES - 1024).fill(97);
    const entries: Record<string, Uint8Array> = {};
    for (let n = 0; n < 9; n++) entries[`part${n}.txt`] = chunk;
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [zip(entries)]);
    expect(result.skipped.some((skip) => skip.reason === "zipTooBig")).toBe(true);
    expect(result.added).toBeLessThan(9);
  });

  it("reports an archive that cannot be read", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [new File(["not a zip at all"], "broken.zip")]);
    expect(result.added).toBe(0);
    expect(result.skipped).toEqual([{ name: "broken.zip", reason: "zipBad" }]);
  });
});
