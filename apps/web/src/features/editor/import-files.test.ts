import { MAX_FILES_PER_SHARE, MAX_PATH_LENGTH } from "@gachipad/shared";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { addFile, fileText, readFiles, setFileLanguage } from "../../lib/collab/model";
import {
  excludedFolderIn,
  isJunkFile,
  MAX_COLLECTED_FILES,
  MAX_WALKED_ENTRIES,
} from "./dropped-files";
import {
  decodeText,
  importFiles,
  MAX_DROP_INPUT_BYTES,
  MAX_DROP_TEXT_BYTES,
  MAX_FILE_BYTES,
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_FILES,
  MAX_ZIP_UNPACKED_BYTES,
  normalizeImportPath,
  readForNewShare,
  zipEntryCount,
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

  it("skips binary with no NUL in it instead of decoding it into replacement characters", () => {
    // Neither UTF-8 nor EUC-KR: 0xff starts no character in either.
    expect(decodeText(bytes(0xff, 0xfd, 0xff, 0xfd))).toBeNull();
    // A lead byte of EUC-KR with no valid second byte.
    expect(decodeText(bytes(0xc7, 0x20, 0xc7, 0x20))).toBeNull();
    // Valid UTF-8, but nothing a text file is made of.
    expect(decodeText(bytes(0x01, 0x02, 0x03, 0x04))).toBeNull();
  });

  it("knows common formats by their first bytes, with or without a NUL", () => {
    expect(decodeText(bytes(0xff, 0xd8, 0xff, 0xe0, 0x41))).toBeNull();
    expect(decodeText(strToU8("%PDF-1.7\nhello"))).toBeNull();
    expect(decodeText(strToU8("GIF89a hello"))).toBeNull();
    expect(decodeText(bytes(0x1f, 0x8b, 0x08, 0x41))).toBeNull();
  });

  it("skips broken UTF-16: half a character at the end, or half a surrogate pair", () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x68, 0, 0x69))).toBeNull();
    expect(decodeText(bytes(0xff, 0xfe, 0x00, 0xd8, 0x41, 0))).toBeNull();
    expect(decodeText(bytes(0xfe, 0xff, 0xd8, 0x00, 0, 0x41))).toBeNull();
  });

  it("keeps real text in legacy Korean, and the control characters text really has", () => {
    // "한글 test" and a CRLF in CP949.
    expect(decodeText(bytes(0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0x74, 0x0d, 0x0a))).toBe("한글 t\n");
    expect(decodeText(strToU8("a\tb\fc\u001b[0m\n"))).toBe("a\tb\fc\u001b[0m\n");
    // One stray control character in a long text does not make it binary.
    expect(decodeText(strToU8(`${"text ".repeat(100)}\u0001`))).not.toBeNull();
  });

  it("treats a NUL anywhere as binary, not just in the first bytes", () => {
    const text = new Uint8Array(20_000).fill(97);
    text[19_000] = 0;
    expect(decodeText(text)).toBeNull();
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
    // Large enough that a limit of this size keeps the full 16 KB free for typing.
    const size = 60_000;
    const limit = 16 * 1024 + room + 2 * size + 700;
    const content = "x".repeat(size);
    const result = await importFiles(
      doc,
      [
        new File([content], "one.txt"),
        new File([content], "two.txt"),
        new File([content], "three.txt"),
      ],
      // Room for the 16 KB kept free for typing, the document, and a little over two files.
      { maxDocBytes: () => limit },
    );
    expect(result.addedPaths).toEqual(["one.txt", "two.txt"]);
    expect(result.skipped).toEqual([{ name: "three.txt", reason: "shareFull" }]);
    // What was applied fits: the update the server would measure stays under the limit.
    expect(Y.encodeStateAsUpdate(doc).byteLength).toBeLessThan(limit);
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

describe("the document is checked again after reading", () => {
  it("applies nothing to a document that was replaced while the files were read", async () => {
    const doc = shareWith({ "a.txt": "a" });
    let finishRead = () => {};
    const file = new File(["late"], "late.txt");
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = () => resolve(new TextEncoder().encode("late").buffer as ArrayBuffer);
        }),
    });
    let current = true;
    const pending = importFiles(doc, [file], { isCurrent: () => current });
    await vi.waitFor(() => expect(finishRead).not.toEqual(expect.any(Number)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    current = false;
    finishRead();
    const result = await pending;
    expect(result.stale).toBe(true);
    expect(result.added).toBe(0);
    expect(result.firstId).toBeNull();
    expect(texts(doc)).toEqual({ "a.txt": "a" });
  });
});

describe("names in NFC", () => {
  const nfc = "과제1.py";
  const nfd = nfc.normalize("NFD");

  it("puts a path from macOS in NFC", () => {
    expect(nfd).not.toBe(nfc);
    expect(normalizeImportPath(`폴더/${nfd}`.normalize("NFD"))).toBe(`폴더/${nfc}`);
  });

  it("counts length on the NFC name, the one the share keeps", () => {
    const long = "가".repeat(MAX_PATH_LENGTH);
    expect(long.normalize("NFD").length).toBeGreaterThan(MAX_PATH_LENGTH);
    expect(normalizeImportPath(long.normalize("NFD"))).toBe(long);
  });

  it("sees the same name and text from macOS as the same file", async () => {
    const doc = shareWith({ [nfc]: "x" });
    const result = await importFiles(doc, [new File(["x"], nfd)]);
    expect(result.added).toBe(0);
    expect(result.duplicates).toEqual([nfc]);
    expect(readFiles(doc)).toHaveLength(1);
  });

  it("numbers different text under the same name instead of adding a look-alike", async () => {
    const doc = shareWith({ [nfc]: "x" });
    const result = await importFiles(doc, [new File(["y"], nfd)]);
    expect(result.addedPaths).toEqual(["과제1 (2).py"]);
  });

  it("matches a name already stored in NFD by an older version", async () => {
    const doc = shareWith({ [nfd]: "x" });
    const same = await importFiles(doc, [new File(["x"], nfc)]);
    expect(same.added).toBe(0);
    const other = await importFiles(doc, [new File(["y"], nfc)]);
    expect(other.addedPaths).toEqual(["과제1 (2).py"]);
  });
});

describe("the final path", () => {
  it("skips a file whose number would make its path longer than a share allows", async () => {
    const path = `${"a".repeat(MAX_PATH_LENGTH - 3)}.py`;
    const doc = shareWith({ [path]: "x" });
    const result = await importFiles(doc, [new File(["y"], path)]);
    expect(result.added).toBe(0);
    expect(result.skipped).toEqual([{ name: path, reason: "badPath" }]);
    expect(readFiles(doc)).toHaveLength(1);
  });
});

describe("a small share size limit", () => {
  it("still takes what fits: the room kept for typing shrinks with the limit", async () => {
    const doc = emptyShare();
    const used = Y.encodeStateAsUpdate(doc).byteLength;
    // Far under the 16 KiB a large share keeps free, and all of it fits this limit.
    const limit = 8192;
    expect(used).toBeLessThan(limit / 2);
    const result = await importFiles(doc, [new File(["print(1)\n"], "main.py")], {
      maxDocBytes: () => limit,
    });
    expect(result.addedPaths).toEqual(["main.py"]);
  });

  it("still refuses what does not fit it", async () => {
    const limit = 8192;
    const result = await importFiles(emptyShare(), [new File(["x".repeat(limit)], "big.txt")], {
      maxDocBytes: () => limit,
    });
    expect(result.added).toBe(0);
    expect(result.skipped).toEqual([{ name: "big.txt", reason: "shareFull" }]);
  });
});

describe("what a big drop costs before it is read", () => {
  /** A file that says how large it is, and counts how often it was really read. */
  function sized(name: string, size: number, content: Uint8Array = new Uint8Array(0)) {
    const file = new File([content as BlobPart], name);
    const read = vi.fn(async () => content.buffer as ArrayBuffer);
    Object.defineProperty(file, "size", { value: size });
    Object.defineProperty(file, "arrayBuffer", { value: read });
    return { file, read };
  }

  it("does not read a .zip over the size limit", async () => {
    const { file, read } = sized("huge.zip", MAX_ZIP_BYTES + 1);
    const result = await importFiles(shareWith({}), [file]);
    expect(read).not.toHaveBeenCalled();
    expect(result.skipped).toEqual([{ name: "huge.zip", reason: "zipTooBig" }]);
  });

  it("stops reading once the drop's input budget is used, across archives", async () => {
    const empty = zipSync({});
    const zips = Array.from({ length: 5 }, (_, n) => sized(`z${n}.zip`, MAX_ZIP_BYTES, empty));
    const result = await importFiles(
      shareWith({}),
      zips.map((zip) => zip.file),
    );
    const allowed = Math.floor(MAX_DROP_INPUT_BYTES / MAX_ZIP_BYTES);
    expect(zips.filter((zip) => zip.read.mock.calls.length > 0)).toHaveLength(allowed);
    expect(result.skipped.filter((skip) => skip.reason === "dropTooBig")).toHaveLength(
      zips.length - allowed,
    );
  });

  it("does not read loose files past what a drop may hold as text", async () => {
    const count = Math.ceil(MAX_DROP_TEXT_BYTES / MAX_FILE_BYTES) + 3;
    const body = new Uint8Array(MAX_FILE_BYTES).fill(97);
    const files = Array.from({ length: count }, (_, n) => {
      const file = new File([body], `f${n}.txt`);
      return { file, read: vi.spyOn(file, "arrayBuffer") };
    });
    // A share with no room, so the test holds no document of this size.
    const result = await importFiles(
      shareWith({}),
      files.map((entry) => entry.file),
      { maxDocBytes: () => 1 },
    );
    const allowed = Math.floor(MAX_DROP_TEXT_BYTES / MAX_FILE_BYTES);
    expect(files.filter((entry) => entry.read.mock.calls.length > 0)).toHaveLength(allowed);
    expect(result.skipped.filter((skip) => skip.reason === "dropTooBig")).toHaveLength(
      count - allowed,
    );
  });

  it("decides dependency folders and junk from the name, without reading them", async () => {
    const paths = ["node_modules/dep/index.js", "src/.DS_Store", "__MACOSX/a", ".venv/bin/python"];
    const picked = paths.map((path) => {
      const file = inFolder(path);
      return { file, read: vi.spyOn(file, "arrayBuffer") };
    });
    const result = await importFiles(
      shareWith({}),
      picked.map((entry) => entry.file),
    );
    for (const { read } of picked) expect(read).not.toHaveBeenCalled();
    expect(result.added).toBe(0);
  });

  it("caps a picked folder like a dropped one: files read, then entries looked at", async () => {
    const files = Array.from({ length: MAX_COLLECTED_FILES + 5 }, (_, n) => {
      const file = inFolder(`p/f${n}.txt`, `${n}`);
      return { file, read: vi.spyOn(file, "arrayBuffer") };
    });
    const capped = await importFiles(
      shareWith({}),
      files.map((entry) => entry.file),
    );
    expect(files.filter((entry) => entry.read.mock.calls.length > 0)).toHaveLength(
      MAX_COLLECTED_FILES,
    );
    expect(capped.skipped).toContainEqual({ name: "", reason: "tooMany", count: 5 });

    const junk = Array.from({ length: MAX_WALKED_ENTRIES + 5 }, () => inFolder("p/.DS_Store"));
    const stopped = await importFiles(shareWith({}), junk);
    expect(stopped.skipped).toEqual([{ name: "", reason: "notChecked", count: 0 }]);
  });
});

describe("reading for a new share", () => {
  const texts = (files: File[]) =>
    Promise.all(
      files.map(async (file) => [
        (file as File & { gachipadPath?: string }).gachipadPath,
        await file.text(),
      ]),
    );

  it("turns what the server would not take into normalised UTF-8", async () => {
    const utf16 = new File([bytes(0xff, 0xfe, 0x68, 0, 0x69, 0, 0x0d, 0, 0x0a, 0)], "wide.py");
    const cp949 = new File([bytes(0xc7, 0xd1, 0xb1, 0xdb)], "old.c");
    const bom = new File(["\ufeffa\r\nb\r\n"], "win.py");
    const { files } = await readForNewShare([utf16, cp949, bom]);
    expect(Object.fromEntries(await texts(files))).toEqual({
      "wide.py": "hi\n",
      "old.c": "한글",
      "win.py": "a\nb\n",
    });
  });

  it("gives the same skips, numbers and duplicates as adding to an open share", async () => {
    const { files, result } = await readForNewShare(
      [
        inFolder("p/a.py", "one"),
        new File(["one"], "a.py"),
        inFolder("p/a.py", "two"),
        inFolder("p/a.py", "one"),
        new File([bytes(0, 1, 2)], "image.bin"),
        inFolder("p/node_modules/dep/index.js"),
      ],
      { skipped: [{ name: "locked.txt", reason: "unreadable" }] },
    );
    expect(Object.fromEntries(await texts(files))).toEqual({
      "p/a.py": "one",
      "a.py": "one",
      "p/a (2).py": "two",
    });
    expect(result.duplicates).toEqual(["p/a.py"]);
    expect(result.renamed).toEqual([{ from: "p/a.py", to: "p/a (2).py" }]);
    expect(result.skipped).toEqual([
      { name: "locked.txt", reason: "unreadable" },
      { name: "image.bin", reason: "binary" },
      { name: "p/node_modules", reason: "excludedFolder" },
    ]);
  });

  it("filters before it counts: text files among many binaries make a share", async () => {
    const text = Array.from({ length: 15 }, (_, n) => new File([`${n}`], `f${n}.py`));
    const images = Array.from(
      { length: MAX_FILES_PER_SHARE },
      (_, n) => new File([bytes(0, n)], `i${n}.png`),
    );
    const { files, result } = await readForNewShare([...text, ...images]);
    expect(files).toHaveLength(text.length);
    expect(result.skipped).toHaveLength(images.length);
  });

  it("leaves out what would go over the share's limit", async () => {
    const limit = 8192;
    const { files, result } = await readForNewShare(
      [new File(["small"], "small.txt"), new File(["x".repeat(limit)], "big.txt")],
      { maxDocBytes: () => limit },
    );
    expect(files.map((file) => file.name)).toEqual(["small.txt"]);
    expect(result.skipped).toEqual([{ name: "big.txt", reason: "shareFull" }]);
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

  describe("that lie about themselves", () => {
    interface RawEntry {
      name: string;
      /** What the local record holds. */
      data?: Uint8Array;
      /** The sizes the directory declares, and where it says the data is. */
      size?: number;
      original?: number;
      method?: number;
      sameDataAs?: number;
    }

    /** An archive written by hand, so its directory can say what a real tool never would. */
    function rawZip(entries: RawEntry[], declaredCount = entries.length): Uint8Array {
      const parts: Uint8Array[] = [];
      let offset = 0;
      const push = (part: Uint8Array) => {
        parts.push(part);
        offset += part.length;
      };
      const record = (length: number, write: (view: DataView) => void) => {
        const part = new Uint8Array(length);
        write(new DataView(part.buffer));
        return part;
      };
      const located = entries.map((entry) => {
        if (entry.sameDataAs !== undefined) return undefined;
        const at = offset;
        const name = strToU8(entry.name);
        const data = entry.data ?? new Uint8Array(0);
        push(
          record(30, (view) => {
            view.setUint32(0, 0x04034b50, true);
            view.setUint16(8, entry.method ?? 0, true);
            view.setUint32(18, data.length, true);
            view.setUint32(22, data.length, true);
            view.setUint16(26, name.length, true);
          }),
        );
        push(name);
        push(data);
        return at;
      });
      const directory = offset;
      entries.forEach((entry, index) => {
        const name = strToU8(entry.name);
        const data = entry.data ?? entries[entry.sameDataAs ?? -1]?.data ?? new Uint8Array(0);
        const at = located[entry.sameDataAs ?? index] ?? 0;
        push(
          record(46, (view) => {
            view.setUint32(0, 0x02014b50, true);
            view.setUint16(10, entry.method ?? 0, true);
            view.setUint32(20, entry.size ?? data.length, true);
            view.setUint32(24, entry.original ?? data.length, true);
            view.setUint16(28, name.length, true);
            view.setUint32(42, at, true);
          }),
        );
        push(name);
      });
      const size = offset - directory;
      push(
        record(22, (view) => {
          view.setUint32(0, 0x06054b50, true);
          view.setUint16(8, declaredCount, true);
          view.setUint16(10, declaredCount, true);
          view.setUint32(12, size, true);
          view.setUint32(16, directory, true);
        }),
      );
      const all = new Uint8Array(offset);
      let at = 0;
      for (const part of parts) {
        all.set(part, at);
        at += part.length;
      }
      return all;
    }

    const asFile = (data: Uint8Array) => new File([data as BlobPart], "pack.zip");

    it("reads the archive it writes, so the rest of these mean something", async () => {
      const data = rawZip([{ name: "ok.txt", data: strToU8("fine") }]);
      expect(zipEntryCount(data)).toBe(1);
      const result = await importFiles(shareWith({}), [asFile(data)]);
      expect(result.addedPaths).toEqual(["ok.txt"]);
    });

    it("refuses a stored entry whose two sizes differ, and keeps the honest ones", async () => {
      const payload = new Uint8Array(1024).fill(97);
      const data = rawZip([
        { name: "evil.txt", data: payload, original: 4 },
        { name: "ok.txt", data: strToU8("fine") },
      ]);
      const result = await importFiles(shareWith({}), [asFile(data)]);
      expect(result.addedPaths).toEqual(["ok.txt"]);
      expect(result.skipped).toEqual([{ name: "evil.txt", reason: "unreadable" }]);
    });

    it("counts the larger size of an entry, so a small original cannot hide a big copy", async () => {
      const payload = new Uint8Array(MAX_FILE_BYTES + 1).fill(97);
      const data = rawZip([{ name: "big.txt", data: payload, method: 8, original: 4 }]);
      const result = await importFiles(shareWith({}), [asFile(data)]);
      expect(result.added).toBe(0);
      expect(result.skipped).toEqual([{ name: "big.txt", reason: "tooBig" }]);
    });

    it("pays for each entry that points at the same bytes", async () => {
      const payload = new Uint8Array(MAX_FILE_BYTES).fill(97);
      const count = Math.floor(MAX_ZIP_UNPACKED_BYTES / MAX_FILE_BYTES);
      const entries: RawEntry[] = [{ name: "f0.txt", data: payload }];
      for (let n = 1; n < count + 4; n++) entries.push({ name: `f${n}.txt`, sameDataAs: 0 });
      // A share with no room, so the test holds no document of this size.
      const result = await importFiles(shareWith({}), [asFile(rawZip(entries))], {
        maxDocBytes: () => 1,
      });
      expect(result.skipped.filter((skip) => skip.reason === "shareFull")).toHaveLength(count);
      expect(result.skipped).toContainEqual({ name: "pack.zip", reason: "zipTooBig" });
    });

    it("refuses a count larger than the archive can hold, without looping over it", async () => {
      const forged = rawZip([{ name: "a.txt", data: strToU8("a") }], 0xffff);
      expect(zipEntryCount(forged)).toBeNull();
      const result = await importFiles(shareWith({}), [asFile(forged)]);
      expect(result.skipped).toEqual([{ name: "pack.zip", reason: "zipBad" }]);
    });

    it("refuses a forged ZIP64 count, the one that reaches four billion", async () => {
      const plain = rawZip([{ name: "a.txt", data: strToU8("a") }]);
      const end = plain.length - 22;
      const forged = new Uint8Array(plain.length + 56 + 20);
      forged.set(plain.subarray(0, end));
      const view = new DataView(forged.buffer);
      view.setUint32(end, 0x06064b50, true);
      view.setUint32(end + 32, 0xffffffff, true);
      view.setUint32(end + 56, 0x07064b50, true);
      view.setUint32(end + 64, end, true);
      forged.set(plain.subarray(end), end + 76);
      expect(zipEntryCount(forged)).toBeNull();
      const result = await importFiles(shareWith({}), [asFile(forged)]);
      expect(result.skipped).toEqual([{ name: "pack.zip", reason: "zipBad" }]);
    });

    it("does not open an archive that really lists too many entries", async () => {
      const entries = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, n) => ({ name: `f${n}` }));
      const data = rawZip(entries);
      expect(zipEntryCount(data)).toBe(entries.length);
      const result = await importFiles(shareWith({}), [asFile(data)]);
      expect(result.added).toBe(0);
      expect(result.skipped).toEqual([{ name: "pack.zip", reason: "zipTooMany" }]);
    });

    it("holds the drop's text budget across several archives", async () => {
      const chunk = new Uint8Array(MAX_FILE_BYTES).fill(97);
      const count = Math.floor(MAX_ZIP_UNPACKED_BYTES / MAX_FILE_BYTES);
      const archive = (id: number) => {
        const entries: Record<string, Uint8Array> = {};
        for (let n = 0; n < count; n++) entries[`z${id}/f${n}.txt`] = chunk;
        return new File([zipSync(entries, { level: 0 })], `z${id}.zip`);
      };
      const archives = Math.ceil(MAX_DROP_TEXT_BYTES / (count * MAX_FILE_BYTES)) + 1;
      const result = await importFiles(
        shareWith({}),
        Array.from({ length: archives }, (_, id) => archive(id)),
        { maxDocBytes: () => 1 },
      );
      const taken = result.skipped.filter((skip) => skip.reason === "shareFull").length;
      expect(taken).toBeLessThanOrEqual(Math.floor(MAX_DROP_TEXT_BYTES / MAX_FILE_BYTES));
      expect(taken).toBeGreaterThan(count);
      expect(result.skipped.map((skip) => skip.reason)).toContain("zipTooBig");
    });
  });

  it("reports an archive that cannot be read", async () => {
    const doc = shareWith({ "a.txt": "a" });
    const result = await importFiles(doc, [new File(["not a zip at all"], "broken.zip")]);
    expect(result.added).toBe(0);
    expect(result.skipped).toEqual([{ name: "broken.zip", reason: "zipBad" }]);
  });
});
