import {
  type Comment,
  DEFAULT_FILE_ID,
  generateFileId,
  MAX_FILES_PER_SHARE,
  YDOC,
} from "@gachipad/shared";
import * as Y from "yjs";

/** Reading and changing the shared document model (docs/ARCHITECTURE.md §4). */

export interface FileEntry {
  id: string;
  path: string;
  language: string;
  order: number;
}

export interface DocMetaView {
  title: string;
  language: string;
}

export function readFiles(doc: Y.Doc): FileEntry[] {
  const files: FileEntry[] = [];
  for (const [id, entry] of doc.getMap<unknown>(YDOC.files).entries()) {
    if (!(entry instanceof Y.Map)) continue;
    files.push({
      id,
      path: String(entry.get("path") ?? id),
      language: String(entry.get("language") ?? ""),
      order: Number(entry.get("order") ?? 0),
    });
  }
  files.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return files;
}

export function readMeta(doc: Y.Doc): DocMetaView {
  const meta = doc.getMap<unknown>(YDOC.meta);
  return { title: String(meta.get("title") ?? ""), language: String(meta.get("language") ?? "") };
}

export function fileText(doc: Y.Doc, fileId: string): Y.Text {
  return doc.getText(YDOC.fileText(fileId));
}

export function setTitle(doc: Y.Doc, title: string): void {
  doc.getMap<unknown>(YDOC.meta).set("title", title);
}

export function setFileLanguage(doc: Y.Doc, fileId: string, language: string): void {
  doc.transact(() => {
    const entry = doc.getMap<Y.Map<unknown>>(YDOC.files).get(fileId);
    entry?.set("language", language);
    // The share-level language is the first file's, which is what nearby cards and lists show.
    if (fileId === DEFAULT_FILE_ID) doc.getMap<unknown>(YDOC.meta).set("language", language);
  });
}

export class FileLimitError extends Error {}

export function addFile(doc: Y.Doc, path: string, language: string, content = ""): string {
  const files = doc.getMap<Y.Map<unknown>>(YDOC.files);
  if (files.size >= MAX_FILES_PER_SHARE) throw new FileLimitError("too many files");
  let id = generateFileId();
  while (files.has(id)) id = generateFileId();
  doc.transact(() => {
    const order = readFiles(doc).reduce((max, file) => Math.max(max, file.order), -1) + 1;
    const entry = new Y.Map<unknown>();
    files.set(id, entry);
    entry.set("path", path);
    entry.set("language", language);
    entry.set("order", order);
    if (content) fileText(doc, id).insert(0, content);
  });
  return id;
}

export function renameFile(doc: Y.Doc, fileId: string, path: string): void {
  doc.getMap<Y.Map<unknown>>(YDOC.files).get(fileId)?.set("path", path);
}

/** Moves every file under `from/` to `to/` (a folder rename). */
export function renameFolder(doc: Y.Doc, from: string, to: string): void {
  doc.transact(() => {
    for (const file of readFiles(doc)) {
      if (file.path === from || file.path.startsWith(`${from}/`)) {
        renameFile(doc, file.id, to + file.path.slice(from.length));
      }
    }
  });
}

export function deleteFile(doc: Y.Doc, fileId: string): void {
  const files = doc.getMap<Y.Map<unknown>>(YDOC.files);
  if (files.size <= 1) return;
  doc.transact(() => {
    const text = fileText(doc, fileId);
    if (text.length > 0) text.delete(0, text.length);
    files.delete(fileId);
  });
}

/**
 * Turns "\r\n" and "\r" into "\n" in place. The editor counts a CRLF as one character while the
 * shared text counts two, so a file that arrived with Windows line endings would shift every
 * position after its first line. Only the "\r" characters are deleted, so two people doing this
 * at once delete the same characters and end up with the same text. Returns whether it changed.
 */
export function normalizeLineEndings(text: Y.Text, origin?: unknown): boolean {
  const value = text.toString();
  if (!value.includes("\r")) return false;
  const apply = () => {
    for (let index = value.length - 1; index >= 0; index--) {
      if (value[index] !== "\r") continue;
      text.delete(index, 1);
      if (value[index + 1] !== "\n") text.insert(index, "\n");
    }
  };
  if (text.doc) text.doc.transact(apply, origin);
  else apply();
  return true;
}

export function deleteFolder(doc: Y.Doc, folder: string): void {
  doc.transact(() => {
    for (const file of readFiles(doc)) {
      if (file.path.startsWith(`${folder}/`)) deleteFile(doc, file.id);
    }
  });
}

// comments ---------------------------------------------------------------

export function readComments(doc: Y.Doc): Comment[] {
  const seen = new Map<string, Comment>();
  for (const item of doc.getArray<Comment>(YDOC.comments).toArray()) {
    if (item && typeof item.id === "string") seen.set(item.id, item);
  }
  return [...seen.values()];
}

export function addComment(doc: Y.Doc, comment: Comment): void {
  doc.getArray<Comment>(YDOC.comments).push([comment]);
}

/** Comments are plain objects, so a change replaces the entry at the same place. */
export function updateComment(doc: Y.Doc, id: string, patch: Partial<Comment>): void {
  const array = doc.getArray<Comment>(YDOC.comments);
  doc.transact(() => {
    const items = array.toArray();
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item?.id !== id) continue;
      array.delete(index, 1);
      array.insert(index, [{ ...item, ...patch }]);
      return;
    }
  });
}

export function deleteComment(doc: Y.Doc, id: string): void {
  const array = doc.getArray<Comment>(YDOC.comments);
  doc.transact(() => {
    const items = array.toArray();
    for (let index = items.length - 1; index >= 0; index--) {
      if (items[index]?.id === id) array.delete(index, 1);
    }
  });
}

// tree --------------------------------------------------------------------

export interface TreeNode {
  name: string;
  /** Full path of a folder (`src/lib`), or of the file. */
  path: string;
  file?: FileEntry;
  children: TreeNode[];
}

/** Folders first, then files, each sorted by name. Paths use `/`. */
export function buildTree(files: readonly FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      // Folders merge. Files never do: two people can add the same path at the same moment, and
      // both files must stay visible so either can be opened or renamed.
      let child = isFile ? undefined : node.children.find((c) => c.name === part && !c.file);
      if (!child) {
        child = isFile
          ? { name: part, path, file, children: [] }
          : { name: part, path, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort(
      (a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name),
    );
    for (const node of nodes) sort(node.children);
  };
  sort(root.children);
  return root.children;
}

export function newCommentId(): string {
  return crypto.randomUUID();
}

/** Compared in NFC: older shares can hold names from macOS (NFD) that look the same. */
export function uniquePath(files: readonly FileEntry[], wanted: string): string {
  const taken = new Set(files.map((file) => file.path.normalize("NFC")));
  if (!taken.has(wanted.normalize("NFC"))) return wanted;
  const dot = wanted.lastIndexOf(".");
  const slash = wanted.lastIndexOf("/");
  const stem = dot > slash + 1 ? wanted.slice(0, dot) : wanted;
  const ext = dot > slash + 1 ? wanted.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.normalize("NFC"))) return candidate;
  }
}
