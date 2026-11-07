import { DEFAULT_FILE_ID, MAX_FILES_PER_SHARE, YDOC } from "@gachipad/shared";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addComment,
  addFile,
  buildTree,
  deleteComment,
  deleteFile,
  deleteFolder,
  type FileEntry,
  FileLimitError,
  fileText,
  normalizeLineEndings,
  readComments,
  readFiles,
  readMeta,
  renameFile,
  renameFolder,
  setFileLanguage,
  setTitle,
  uniquePath,
  updateComment,
} from "./model";

function file(path: string, order = 0): FileEntry {
  return { id: path, path, language: "plaintext", order };
}

/** A document the way the collab server creates it: one default file. */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  const entry = new Y.Map<unknown>();
  doc.getMap<Y.Map<unknown>>(YDOC.files).set(DEFAULT_FILE_ID, entry);
  entry.set("path", "main.txt");
  entry.set("language", "plaintext");
  entry.set("order", 0);
  return doc;
}

describe("uniquePath", () => {
  it("keeps a free name", () => {
    expect(uniquePath([file("a.ts")], "b.ts")).toBe("b.ts");
  });

  it("numbers a taken name before the extension", () => {
    expect(uniquePath([file("a.ts")], "a.ts")).toBe("a (2).ts");
    expect(uniquePath([file("a.ts"), file("a (2).ts")], "a.ts")).toBe("a (3).ts");
  });

  it("handles names without an extension and dots in folders", () => {
    expect(uniquePath([file("Makefile")], "Makefile")).toBe("Makefile (2)");
    expect(uniquePath([file("v1.2/readme")], "v1.2/readme")).toBe("v1.2/readme (2)");
  });
});

describe("buildTree", () => {
  it("keeps both files when two have the same path, so either can be opened", () => {
    const entry = (id: string, path: string) => ({ id, path, language: "text", order: 0 });
    const tree = buildTree([entry("a", "src/same.py"), entry("b", "src/same.py"), entry("c", "x")]);
    const folder = tree.find((node) => node.name === "src");
    expect(tree.filter((node) => node.name === "src")).toHaveLength(1);
    expect(folder?.children.map((node) => node.file?.id).sort()).toEqual(["a", "b"]);
  });

  it("lists folders before files, each sorted by name", () => {
    const tree = buildTree([
      file("z.ts"),
      file("src/lib/b.ts"),
      file("src/a.ts"),
      file("README.md"),
      file("src/lib/a.ts"),
    ]);
    expect(tree.map((node) => node.name)).toEqual(["src", "README.md", "z.ts"]);
    const src = tree[0];
    expect(src?.file).toBeUndefined();
    expect(src?.children.map((node) => node.name)).toEqual(["lib", "a.ts"]);
    expect(src?.children[0]?.children.map((node) => node.path)).toEqual([
      "src/lib/a.ts",
      "src/lib/b.ts",
    ]);
  });

  it("returns nothing for no files", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("files in the document", () => {
  it("adds files in order and reads them back", () => {
    const doc = newDoc();
    const id = addFile(doc, "util.py", "python", "x = 1");
    expect(readFiles(doc).map((entry) => entry.path)).toEqual(["main.txt", "util.py"]);
    expect(fileText(doc, id).toString()).toBe("x = 1");
  });

  it("refuses more files than a share may hold", () => {
    const doc = newDoc();
    for (let n = 1; n < MAX_FILES_PER_SHARE; n++) addFile(doc, `f${n}.txt`, "plaintext");
    expect(() => addFile(doc, "one-too-many.txt", "plaintext")).toThrow(FileLimitError);
  });

  it("renames a file and a whole folder", () => {
    const doc = newDoc();
    const a = addFile(doc, "src/a.ts", "typescript");
    addFile(doc, "src/deep/b.ts", "typescript");
    addFile(doc, "srcs/c.ts", "typescript");
    renameFile(doc, a, "src/alpha.ts");
    renameFolder(doc, "src", "lib");
    expect(
      readFiles(doc)
        .map((entry) => entry.path)
        .sort(),
    ).toEqual(["lib/alpha.ts", "lib/deep/b.ts", "main.txt", "srcs/c.ts"]);
  });

  it("deletes a file with its text, but never the last one", () => {
    const doc = newDoc();
    const id = addFile(doc, "tmp.txt", "plaintext", "scratch");
    deleteFile(doc, id);
    expect(readFiles(doc)).toHaveLength(1);
    deleteFile(doc, DEFAULT_FILE_ID);
    expect(readFiles(doc)).toHaveLength(1);
  });

  it("deletes a folder and everything in it", () => {
    const doc = newDoc();
    addFile(doc, "build/a.js", "javascript");
    addFile(doc, "build/x/b.js", "javascript");
    addFile(doc, "builder.js", "javascript");
    deleteFolder(doc, "build");
    expect(readFiles(doc).map((entry) => entry.path)).toEqual(["main.txt", "builder.js"]);
  });

  it("mirrors the first file's language into the share language", () => {
    const doc = newDoc();
    const second = addFile(doc, "b.py", "python");
    setFileLanguage(doc, second, "ruby");
    expect(readMeta(doc).language).toBe("");
    setFileLanguage(doc, DEFAULT_FILE_ID, "go");
    expect(readMeta(doc).language).toBe("go");
  });

  it("sets the title through the document", () => {
    const doc = newDoc();
    setTitle(doc, "Homework");
    expect(readMeta(doc).title).toBe("Homework");
  });
});

describe("comments", () => {
  const base = {
    id: "c1",
    fileId: DEFAULT_FILE_ID,
    author: "Ana",
    body: "why?",
    createdAt: new Date(0).toISOString(),
    resolved: false,
  } as never;

  it("adds, updates in place and deletes", () => {
    const doc = newDoc();
    addComment(doc, base);
    addComment(doc, { ...(base as object), id: "c2" } as never);
    updateComment(doc, "c1", { resolved: true } as never);
    expect(
      readComments(doc).map((comment) => [
        comment.id,
        (comment as never as { resolved: boolean }).resolved,
      ]),
    ).toEqual([
      ["c1", true],
      ["c2", false],
    ]);
    deleteComment(doc, "c1");
    expect(readComments(doc).map((comment) => comment.id)).toEqual(["c2"]);
  });

  it("collapses a comment that two people updated at once", () => {
    const left = newDoc();
    addComment(left, base);
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    updateComment(left, "c1", { resolved: true } as never);
    updateComment(right, "c1", { body: "edited" } as never);
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    expect(readComments(left)).toHaveLength(1);
    expect(readComments(left)).toEqual(readComments(right));
  });
});

describe("normalizeLineEndings", () => {
  it("turns CRLF and lone CR into LF", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    text.insert(0, "a\r\nb\rc\n");
    expect(normalizeLineEndings(text)).toBe(true);
    expect(text.toString()).toBe("a\nb\nc\n");
    expect(normalizeLineEndings(text)).toBe(false);
  });

  it("converges when two people normalise the same text at once", () => {
    const a = new Y.Doc();
    a.getText("t").insert(0, "one\r\ntwo\r\n");
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    normalizeLineEndings(a.getText("t"));
    normalizeLineEndings(b.getText("t"));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText("t").toString()).toBe("one\ntwo\n");
    expect(b.getText("t").toString()).toBe("one\ntwo\n");
  });
});
