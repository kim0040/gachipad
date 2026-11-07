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
import {
  excludedFolderIn,
  isJunkFile,
  MAX_COLLECTED_FILES,
  MAX_WALKED_ENTRIES,
  type Skip,
} from "./dropped-files";

/** Reads dropped or picked files as text and puts them into the open share. */

const MIB = 1024 * 1024;
export const MAX_FILE_BYTES = 5 * MIB;
/** A .zip larger than this is not opened, or read. */
export const MAX_ZIP_BYTES = 64 * MIB;
/** Files taken out of the archives of one drop; the share holds 100, the rest would only be skipped. */
export const MAX_ZIP_FILES = 1000;
/** Entries an archive may list (folders included); more than this and it is not opened. */
export const MAX_ZIP_ENTRIES = 10_000;
/** What one archive may unpack to, by the larger of the sizes each entry declares. */
export const MAX_ZIP_UNPACKED_BYTES = 32 * MIB;
/** What one drop may read from disk, archives included. Past this, files are not read at all. */
export const MAX_DROP_INPUT_BYTES = 128 * MIB;
/** Text one drop may hold while it is read, whatever the share's room turns out to be. */
export const MAX_DROP_TEXT_BYTES = 64 * MIB;
/** Share size left free for typing after an import, at most; a small share keeps a part of itself. */
const BUDGET_HEADROOM = 16 * 1024;
const HEADROOM_SHARE = 8;
/** What a new file costs in the encoded document besides its path and text. */
const FILE_OVERHEAD = 256;
/** Reading hands the page back after this long, so a big drop never freezes it. */
const YIELD_AFTER_MS = 16;

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
  /** The document was replaced or closed while the files were being read: nothing was applied. */
  stale: boolean;
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

/** How common binary formats start. Many of them hold no NUL in their first bytes, or at all. */
const BINARY_SIGNATURES: readonly (readonly number[])[] = [
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF8
  [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  [0x50, 0x4b, 0x03, 0x04], // ZIP, and everything built on it
  [0x50, 0x4b, 0x05, 0x06], // ZIP, empty
  [0x1f, 0x8b], // gzip
  [0x42, 0x5a, 0x68], // bzip2
  [0xfd, 0x37, 0x7a, 0x58, 0x5a], // xz
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], // RAR
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xca, 0xfe, 0xba, 0xbe], // Java class, Mach-O
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
  [0x4f, 0x67, 0x67, 0x53], // OggS
  [0x66, 0x4c, 0x61, 0x43], // fLaC
  [0x77, 0x4f, 0x46, 0x46], // wOFF
  [0x77, 0x4f, 0x46, 0x32], // wOF2
];

function hasBinarySignature(bytes: Uint8Array): boolean {
  return BINARY_SIGNATURES.some((signature) => signature.every((byte, i) => bytes[i] === byte));
}

/**
 * Whether decoded text is really binary: any NUL, or more than 1 in 100 characters being a control
 * character no text file has. Tab, line breaks, form feed, backspace, escape (coloured logs) and
 * Ctrl-Z (old DOS files) are all at home in text.
 */
function hasBinaryControls(text: string): boolean {
  let controls = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) return true;
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    if (control && ![0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1a, 0x1b].includes(code)) controls++;
  }
  return controls * 100 > text.length;
}

/**
 * Text of a file as saved on any desktop: UTF-16 with a byte order mark (Windows "Unicode"),
 * UTF-8, or else the legacy Korean Windows code page. Every decoder is strict: bytes that are none
 * of these are binary, not text with replacement characters in it. Line endings become "\n" and a
 * leading BOM goes: the editor counts "\r\n" as one character where the shared text counts two, so
 * CRLF would put everyone's edits in the wrong place.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (hasBinarySignature(bytes)) return null;
  let text: string;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
    } else if (looksBinary(bytes)) return null;
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("euc-kr", { fatal: true }).decode(bytes);
      }
    }
  } catch {
    return null;
  }
  if (hasBinaryControls(text)) return null;
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/**
 * A path a share accepts, or null: separators become "/", leading, doubled and "." parts go, and it
 * is put in NFC so a name from macOS (NFD) is the same name as one typed elsewhere. A path that
 * could climb out of its folder (".."), starts with a drive letter, holds control characters or is
 * longer than the schema allows is refused. Same rules as the API's `sanitizePath`.
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
  const clean = parts.join("/").normalize("NFC");
  return clean.length > MAX_PATH_LENGTH ? null : clean;
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Reading {
  items: Incoming[];
  skipped: Skip[];
  /** Excluded folders met inside a picked folder or an archive: one skip each, however many files. */
  excluded: Set<string>;
  /** Bytes read from disk so far in this drop. */
  input: number;
  /** Bytes of text held so far in this drop. */
  text: number;
  /** Files taken out of archives so far in this drop. */
  zipFiles: number;
}

/** The path of a file or entry worth looking at, or null when it was dealt with by its name alone. */
function admit(reading: Reading, rawPath: string): string | null {
  const slashed = rawPath.replace(/\\/g, "/");
  if (isJunkFile(slashed)) return null;
  const path = normalizeImportPath(rawPath);
  if (!path) {
    reading.skipped.push({ name: slashed, reason: "badPath" });
    return null;
  }
  const folder = excludedFolderIn(path);
  if (folder) {
    reading.excluded.add(folder);
    return null;
  }
  return path;
}

function take(reading: Reading, rawPath: string, bytes: Uint8Array) {
  const path = admit(reading, rawPath);
  if (!path) return;
  if (bytes.length > MAX_FILE_BYTES) {
    reading.skipped.push({ name: path, reason: "tooBig" });
    return;
  }
  const content = decodeText(bytes);
  if (content === null) {
    reading.skipped.push({ name: path, reason: "binary" });
    return;
  }
  reading.text += bytes.length;
  reading.items.push({ path, content });
}

/** A central directory entry takes at least this many bytes, so a count can be held to the file. */
const ZIP_ENTRY_MIN_BYTES = 46;
const ZIP_END_MAX_DISTANCE = 65_558;

const uint16 = (data: Uint8Array, at: number) => (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
const uint32 = (data: Uint8Array, at: number) =>
  (uint16(data, at) | (uint16(data, at + 2) << 16)) >>> 0;

/**
 * How many entries an archive declares, read the way `unzipSync` reads them, or null when it has no
 * end record or declares more than its size can hold. `unzipSync` loops that many times with no way
 * to stop it, and a forged ZIP64 count goes up to four billion.
 */
export function zipEntryCount(data: Uint8Array): number | null {
  let end = data.length - 22;
  for (; uint32(data, end) !== 0x06054b50; end--) {
    if (end <= 0 || data.length - end > ZIP_END_MAX_DISTANCE) return null;
  }
  let count = uint16(data, end + 8);
  let directory = uint32(data, end + 16);
  if (uint32(data, end - 20) === 0x07064b50) {
    const zip64 = uint32(data, end - 12);
    if (uint32(data, zip64) === 0x06064b50) {
      // Only the low half is read by `unzipSync`; a high half means nothing real anyway.
      if (uint32(data, zip64 + 36) !== 0) return null;
      count = uint32(data, zip64 + 32);
      directory = uint32(data, zip64 + 48);
    }
  }
  if (count === 0) return 0;
  return directory + count * ZIP_ENTRY_MIN_BYTES > data.length ? null : count;
}

/**
 * The text files of an archive. Its entry count is checked before it is opened, and what each entry
 * would really take before it is unpacked: a stored entry is copied by its compressed size and an
 * inflated one allocated by its original size, whatever the other says, so the larger of the two is
 * what counts, and entries that overlap on the same bytes each pay again. A zip bomb costs a few
 * reads, not the tab.
 */
function readZip(reading: Reading, name: string, bytes: Uint8Array): void {
  const count = zipEntryCount(bytes);
  if (count === null) {
    reading.skipped.push({ name, reason: "zipBad" });
    return;
  }
  if (count > MAX_ZIP_ENTRIES) {
    reading.skipped.push({ name, reason: "zipTooMany" });
    return;
  }
  let unpacked = 0;
  let tooMany = false;
  let tooBig = false;
  let malformed = false;
  try {
    const entries = unzipSync(bytes, {
      filter: (entry) => {
        if (/[/\\]$/.test(entry.name)) return false;
        if (entry.name === "") {
          malformed = true;
          return false;
        }
        const path = entry.name.replace(/\\/g, "/");
        if (isJunkFile(path)) return false;
        const stored = entry.compression === 0;
        if ((!stored && entry.compression !== 8) || (stored && entry.size !== entry.originalSize)) {
          reading.skipped.push({ name: path, reason: "unreadable" });
          return false;
        }
        const folder = excludedFolderIn(path);
        if (folder) {
          reading.excluded.add(folder);
          return false;
        }
        const cost = Math.max(entry.size, entry.originalSize);
        if (cost > MAX_FILE_BYTES) {
          reading.skipped.push({ name: path, reason: "tooBig" });
          return false;
        }
        if (reading.zipFiles >= MAX_ZIP_FILES) {
          tooMany = true;
          return false;
        }
        if (
          unpacked + cost > MAX_ZIP_UNPACKED_BYTES ||
          reading.text + unpacked + cost > MAX_DROP_TEXT_BYTES
        ) {
          tooBig = true;
          return false;
        }
        reading.zipFiles++;
        unpacked += cost;
        return true;
      },
    });
    for (const [path, data] of Object.entries(entries)) take(reading, path, data);
  } catch {
    reading.skipped.push({ name, reason: "zipBad" });
    return;
  }
  if (malformed) reading.skipped.push({ name, reason: "zipBad" });
  if (tooMany) reading.skipped.push({ name, reason: "zipTooMany" });
  if (tooBig) reading.skipped.push({ name, reason: "zipTooBig" });
}

async function readAll(
  files: readonly File[],
  skipped: Skip[],
  onProgress?: (done: number, total: number) => void,
): Promise<Incoming[]> {
  const reading: Reading = {
    items: [],
    skipped,
    excluded: new Set(),
    input: 0,
    text: 0,
    zipFiles: 0,
  };
  let done = 0;
  let collected = 0;
  let overflow = 0;
  let lastYield = performance.now();
  for (const file of files) {
    onProgress?.(done, files.length);
    // The same limits as walking a dropped folder: a picked one arrives as a flat list.
    if (++done > MAX_WALKED_ENTRIES) {
      skipped.push({ name: "", reason: "notChecked", count: 0 });
      break;
    }
    // Decided from the name alone: a picked node_modules costs no reads and no waiting.
    const name = admit(reading, relativePathOf(file) ?? file.name);
    if (!name) continue;
    if (collected >= MAX_COLLECTED_FILES) {
      overflow++;
      continue;
    }
    collected++;
    const isZip = /\.zip$/i.test(file.name);
    if (file.size > (isZip ? MAX_ZIP_BYTES : MAX_FILE_BYTES)) {
      skipped.push({ name, reason: isZip ? "zipTooBig" : "tooBig" });
      continue;
    }
    if (
      reading.input + file.size > MAX_DROP_INPUT_BYTES ||
      (!isZip && reading.text + file.size > MAX_DROP_TEXT_BYTES)
    ) {
      skipped.push({ name, reason: "dropTooBig" });
      continue;
    }
    reading.input += file.size;
    if (performance.now() - lastYield > YIELD_AFTER_MS) {
      await yieldToBrowser();
      lastYield = performance.now();
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
  if (overflow > 0) skipped.push({ name: "", reason: "tooMany", count: overflow });
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
  return known.filter((file) => {
    const path = file.path.normalize("NFC");
    return path === wanted || numbered.test(path);
  });
}

export interface ImportOptions {
  canChangeLanguage?: boolean | (() => boolean);
  /** Checked after the files are read, right before they are applied. */
  mayApply?: () => boolean;
  /** Also checked then: this document is still the one the share is working on. */
  isCurrent?: () => boolean;
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
    stale: false,
  };
  if (options.isCurrent && !options.isCurrent()) {
    result.stale = true;
    return result;
  }
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
      : maxBytes -
        Math.min(BUDGET_HEADROOM, Math.floor(maxBytes / HEADROOM_SHARE)) -
        Y.encodeStateAsUpdate(doc).byteLength;

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
      // The number can push a path that just fit past what the schema allows.
      if (path.length > MAX_PATH_LENGTH) {
        next++;
        result.skipped.push({ name: item.path, reason: "badPath" });
        continue;
      }
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

export interface NewShareFiles {
  /** Normalised UTF-8 files, each with the path it should get. */
  files: File[];
  result: ImportResult;
}

/**
 * The files a new share should start with: the same reader, skips, numbering and limits as adding
 * to an open share, because they are applied to an empty scratch document the same way.
 */
export async function readForNewShare(
  files: readonly File[],
  options: Pick<ImportOptions, "maxDocBytes" | "skipped"> = {},
): Promise<NewShareFiles> {
  const scratch = new Y.Doc();
  try {
    const result = await importFiles(scratch, files, options);
    const prepared = readFiles(scratch).map((entry) => {
      const file = new File([fileText(scratch, entry.id).toString()], baseName(entry.path), {
        type: "text/plain",
      });
      (file as File & { gachipadPath?: string }).gachipadPath = entry.path;
      return file;
    });
    return { files: prepared, result };
  } finally {
    scratch.destroy();
  }
}
