import { languageForFilename, PLAIN_TEXT_ID } from "@gachipad/highlight";
import { MAX_FILES_PER_SHARE, MAX_PATH_LENGTH } from "@gachipad/shared";
import { unzipSync } from "fflate";
import * as Y from "yjs";
import { relativePathOf } from "../../lib/api";
import {
  addFile,
  type FileEntry,
  FileLimitError,
  fileText,
  readFiles,
  renameFile,
  setFileLanguage,
  uniquePath,
} from "../../lib/collab/model";
import { baseName } from "../../lib/format";
import { excludedFolderIn, isJunkFile, type Skip } from "./dropped-files";

/** Reads dropped or picked files as text and puts them into the open share. */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** A .zip larger than this is not opened. */
export const MAX_ZIP_BYTES = 64 * 1024 * 1024;
/** Files taken out of one archive; the share holds 100, the rest would only be skipped. */
export const MAX_ZIP_FILES = 1000;
/** Entries of an archive (folders included) looked at before the rest are ignored. */
const MAX_ZIP_ENTRIES = 10_000;
/** What one archive may unpack to, by the sizes it declares. */
export const MAX_ZIP_UNPACKED_BYTES = 32 * 1024 * 1024;
/** Share size left free for typing after an import. */
const BUDGET_HEADROOM = 16 * 1024;
/** What a new file costs in the encoded document besides its path and text. */
const FILE_OVERHEAD = 256;

export interface ImportResult {
  added: number;
  /** Paths the new files got, in order. */
  addedPaths: string[];
  /** Files whose name was taken by a different file: they were added under `to`. */
  renamed: { from: string; to: string }[];
  /** Paths of existing files that already held the same text; nothing was added for them. */
  duplicates: string[];
  skipped: Skip[];
  /** The file the editor should show afterwards. */
  firstId: string | null;
  /** Permission was withdrawn while the files were being read: nothing was applied. */
  refused: boolean;
}

interface Incoming {
  path: string;
  content: string;
}

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8192);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * Text of a file as saved on any desktop: UTF-16 with a byte order mark (Windows "Unicode"),
 * UTF-8, or else the legacy Korean Windows code page. Line endings become "\n" and a leading BOM
 * goes: the editor counts "\r\n" as one character where the shared text counts two, so CRLF would
 * put everyone's edits in the wrong place.
 */
export function decodeText(bytes: Uint8Array): string | null {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le").decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder("utf-16be").decode(bytes);
  else if (looksBinary(bytes)) return null;
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("euc-kr").decode(bytes);
    }
  }
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/**
 * A path a share accepts, or null: separators become "/", leading, doubled and "." parts go. A
 * path that could climb out of its folder (".."), starts with a drive letter, holds control
 * characters or is longer than the schema allows is refused. Same rules as the API's `sanitizePath`.
 */
export function normalizeImportPath(raw: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are rejected on purpose
  if (/[\u0000-\u001f]/.test(raw)) return null;
  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  if (/^[A-Za-z]:$/.test(parts[0] as string)) return null;
  const clean = parts.join("/");
  return clean.length > MAX_PATH_LENGTH ? null : clean;
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Reading {
  items: Incoming[];
  skipped: Skip[];
  /** Excluded folders met inside a picked folder or an archive: one skip each, however many files. */
  excluded: Set<string>;
}

function take(reading: Reading, rawPath: string, bytes: Uint8Array, size = bytes.length) {
  const slashed = rawPath.replace(/\\/g, "/");
  if (isJunkFile(slashed)) return;
  const path = normalizeImportPath(rawPath);
  if (!path) {
    reading.skipped.push({ name: slashed, reason: "badPath" });
    return;
  }
  const folder = excludedFolderIn(path);
  if (folder) {
    reading.excluded.add(folder);
    return;
  }
  if (size > MAX_FILE_BYTES) {
    reading.skipped.push({ name: path, reason: "tooBig" });
    return;
  }
  const content = decodeText(bytes);
  if (content === null) {
    reading.skipped.push({ name: path, reason: "binary" });
    return;
  }
  reading.items.push({ path, content });
}

/**
 * The text files of an archive. Its size, its entry count and what it declares to unpack to are
 * checked from the directory of the archive before anything is inflated, so a zip bomb costs a few
 * reads, not the tab.
 */
function readZip(reading: Reading, name: string, bytes: Uint8Array): void {
  if (bytes.length > MAX_ZIP_BYTES) {
    reading.skipped.push({ name, reason: "zipTooBig" });
    return;
  }
  let scanned = 0;
  let taken = 0;
  let unpacked = 0;
  let tooMany = false;
  let tooBig = false;
  try {
    const entries = unzipSync(bytes, {
      filter: (entry) => {
        if (++scanned > MAX_ZIP_ENTRIES) {
          tooMany = true;
          return false;
        }
        if (/[/\\]$/.test(entry.name)) return false;
        const path = entry.name.replace(/\\/g, "/");
        if (isJunkFile(path)) return false;
        if (entry.compression !== 0 && entry.compression !== 8) {
          reading.skipped.push({ name: path, reason: "unreadable" });
          return false;
        }
        const folder = excludedFolderIn(path);
        if (folder) {
          reading.excluded.add(folder);
          return false;
        }
        if (entry.originalSize > MAX_FILE_BYTES) {
          reading.skipped.push({ name: path, reason: "tooBig" });
          return false;
        }
        if (taken >= MAX_ZIP_FILES) {
          tooMany = true;
          return false;
        }
        if (unpacked + entry.originalSize > MAX_ZIP_UNPACKED_BYTES) {
          tooBig = true;
          return false;
        }
        taken++;
        unpacked += entry.originalSize;
        return true;
      },
    });
    for (const [path, data] of Object.entries(entries)) take(reading, path, data);
  } catch {
    reading.skipped.push({ name, reason: "zipBad" });
    return;
  }
  if (tooMany) reading.skipped.push({ name, reason: "zipTooMany" });
  if (tooBig) reading.skipped.push({ name, reason: "zipTooBig" });
}

async function readAll(
  files: readonly File[],
  skipped: Skip[],
  onProgress?: (done: number, total: number) => void,
): Promise<Incoming[]> {
  const reading: Reading = { items: [], skipped, excluded: new Set() };
  let done = 0;
  for (const file of files) {
    onProgress?.(done++, files.length);
    if (files.length > 1) await yieldToBrowser();
    const name = relativePathOf(file) ?? file.name;
    const isZip = /\.zip$/i.test(file.name);
    if (!isZip && file.size > MAX_FILE_BYTES) {
      take(reading, name, new Uint8Array(0), file.size);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      skipped.push({ name, reason: "unreadable" });
      continue;
    }
    if (isZip) readZip(reading, name, bytes);
    else take(reading, name, bytes);
  }
  for (const folder of reading.excluded) {
    skipped.push({ name: folder, reason: "excludedFolder" });
  }
  return reading.items;
}

/** Existing files that carry the wanted name: itself, or a copy numbered by `uniquePath`. */
function sameNameFiles(known: readonly FileEntry[], wanted: string): FileEntry[] {
  const dot = wanted.lastIndexOf(".");
  const slash = wanted.lastIndexOf("/");
  const stem = dot > slash + 1 ? wanted.slice(0, dot) : wanted;
  const ext = dot > slash + 1 ? wanted.slice(dot) : "";
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const numbered = new RegExp(`^${escapeRegExp(stem)} \\(\\d+\\)${escapeRegExp(ext)}$`);
  return known.filter((file) => file.path === wanted || numbered.test(file.path));
}

export interface ImportOptions {
  canChangeLanguage?: boolean | (() => boolean);
  /** Checked after the files are read, right before they are applied. */
  mayApply?: () => boolean;
  /** Bytes the share may hold, as the collab server counts them; unknown means no check. */
  maxDocBytes?: () => number | undefined;
  /** Skips found before this call (a folder that could not be read, ...). */
  skipped?: readonly Skip[];
  onProgress?: (done: number, total: number) => void;
}

/**
 * Reads the files and adds them to the share. Nothing is ever overwritten: a file whose name is
 * taken by a file with the same text is not added again (the existing one is shown), and one whose
 * name is taken by different text is added as `name (2).ext`. The file list, its texts and the room
 * left in the share are read from the document when the files are applied, not before they were
 * read, because others keep working while a large drop is read.
 */
export async function importFiles(
  doc: Y.Doc,
  files: readonly File[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const skipped: Skip[] = [...(options.skipped ?? [])];
  const items = await readAll(files, skipped, options.onProgress);
  const result: ImportResult = {
    added: 0,
    addedPaths: [],
    renamed: [],
    duplicates: [],
    skipped,
    firstId: null,
    refused: false,
  };
  if (options.mayApply && !options.mayApply()) {
    result.refused = true;
    return result;
  }
  const canChangeLanguage =
    typeof options.canChangeLanguage === "function"
      ? options.canChangeLanguage()
      : options.canChangeLanguage !== false;
  const maxBytes = options.maxDocBytes?.();
  // What is left of the share's room: the encoded document is what the collab server measures.
  let room =
    maxBytes === undefined
      ? Number.POSITIVE_INFINITY
      : maxBytes - BUDGET_HEADROOM - Y.encodeStateAsUpdate(doc).byteLength;

  doc.transact(() => {
    const known = readFiles(doc);
    let next = 0;
    const leftOut = (reason: "tooMany" | "shareFull") => {
      for (const item of items.slice(next)) result.skipped.push({ name: item.path, reason });
      next = items.length;
    };

    // A fresh, empty share takes the first file in place instead of keeping an empty "main".
    const only = known.length === 1 ? known[0] : undefined;
    const first = items[0];
    if (only && first && fileText(doc, only.id).length === 0) {
      const cost = utf8Length(first.content) + utf8Length(first.path);
      if (cost > room) {
        leftOut("shareFull");
        return;
      }
      next = 1;
      room -= cost;
      renameFile(doc, only.id, first.path);
      if (canChangeLanguage) {
        setFileLanguage(
          doc,
          only.id,
          languageForFilename(baseName(first.path))?.id ?? PLAIN_TEXT_ID,
        );
      }
      fileText(doc, only.id).insert(0, first.content);
      known[0] = { ...only, path: first.path };
      result.firstId = only.id;
      result.added++;
      result.addedPaths.push(first.path);
    }

    while (next < items.length) {
      const item = items[next] as Incoming;
      const twin = sameNameFiles(known, item.path).find(
        (file) => fileText(doc, file.id).toString() === item.content,
      );
      if (twin) {
        next++;
        result.duplicates.push(twin.path);
        result.firstId ??= twin.id;
        continue;
      }
      if (known.length >= MAX_FILES_PER_SHARE) {
        leftOut("tooMany");
        break;
      }
      const path = uniquePath(known, item.path);
      const cost = utf8Length(item.content) + utf8Length(path) + FILE_OVERHEAD;
      if (cost > room) {
        leftOut("shareFull");
        break;
      }
      const language = languageForFilename(baseName(path))?.id ?? PLAIN_TEXT_ID;
      let id: string;
      try {
        id = addFile(doc, path, language, item.content);
      } catch (error) {
        if (!(error instanceof FileLimitError)) throw error;
        leftOut("tooMany");
        break;
      }
      next++;
      room -= cost;
      known.push({ id, path, language, order: known.length });
      result.firstId ??= id;
      result.added++;
      result.addedPaths.push(path);
      if (path !== item.path) result.renamed.push({ from: item.path, to: path });
    }
  });
  return result;
}
