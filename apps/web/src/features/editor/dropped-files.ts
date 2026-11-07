/**
 * Files from a drop, with folders expanded. Browsers hide folder contents behind
 * `webkitGetAsEntry`; each file gets `gachipadPath` so uploads keep their relative path.
 *
 * Reading never rejects: whatever cannot be read becomes a named `Skip`, so one bad file does not
 * lose the rest of the drop.
 */

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?(success: (file: File) => void, failure: (error: unknown) => void): void;
  createReader?(): {
    readEntries(success: (entries: FsEntry[]) => void, failure: (error: unknown) => void): void;
  };
}

/** Why something of a drop or a pick was left out. The summary words each of them. */
export type SkipReason =
  | "binary"
  | "tooBig"
  | "unreadable"
  | "folder"
  | "excludedFolder"
  | "tooMany"
  | "shareFull"
  | "badPath"
  | "zipTooMany"
  | "zipTooBig"
  | "zipBad"
  | "dropTooBig"
  | "notChecked";

export interface Skip {
  /** The file or folder as the person knows it (a relative path for files in folders). */
  name: string;
  reason: SkipReason;
  /** How many items this entry stands for; 1 when absent. */
  count?: number;
}

export interface DroppedFiles {
  files: File[];
  skipped: Skip[];
}

const JUNK_NAME = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\.localized|\._.*|~\$.*)$/i;
const JUNK_FOLDER = /(^|\/)(__MACOSX|\.Spotlight-V100|\.Trashes|\$RECYCLE\.BIN)(\/|$)/i;

/**
 * Dependency, build and tool folders. They are not read at all when dropped or picked, and are
 * reported as skipped: one project folder would otherwise fill the share's file limit with them.
 */
export const EXCLUDED_FOLDERS: ReadonlySet<string> = new Set([
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
]);

/** Most files read from one drop; the share holds 100, so this leaves room for the unreadable ones. */
export const MAX_COLLECTED_FILES = 400;
/** Directory entries looked at in one drop before the walk stops and leaves the rest unchecked. */
export const MAX_WALKED_ENTRIES = 5000;

/**
 * Files a file manager adds on its own (Finder's .DS_Store and ._ copies, Explorer's Thumbs.db and
 * desktop.ini, Office lock files). They would only show up as unreadable "binary" skips.
 */
export function isJunkFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return JUNK_NAME.test(name) || JUNK_FOLDER.test(path);
}

/**
 * The first folder of a path (not its file name) that is skipped by default, as the path up to and
 * including that folder, or null.
 */
export function excludedFolderIn(path: string): string | null {
  const parts = path.replace(/\\/g, "/").split("/");
  for (let index = 0; index < parts.length - 1; index++) {
    if (EXCLUDED_FOLDERS.has(parts[index] as string)) return parts.slice(0, index + 1).join("/");
  }
  return null;
}

interface Walk {
  files: File[];
  skipped: Skip[];
  /** Directory entries visited. */
  visited: number;
  /** Files seen past `MAX_COLLECTED_FILES`; they are counted, not read. */
  overflow: number;
  /** `MAX_WALKED_ENTRIES` was reached: nothing further is listed, at any level. */
  stopped: boolean;
  /** The file the browser handed over next to a top-level entry, for when the entry cannot read. */
  direct: Map<FsEntry, File>;
}

/** Counts one entry of the walk; false once the walk has seen as many as it may. */
function visit(walk: Walk): boolean {
  if (walk.stopped) return false;
  if (++walk.visited > MAX_WALKED_ENTRIES) walk.stopped = true;
  return !walk.stopped;
}

/** Names from macOS arrive in NFD; a share keeps one form, so the same name is the same name. */
const stripSlash = (path: string) => path.replace(/^\/+/, "").normalize("NFC");

async function readFile(entry: FsEntry, walk: Walk): Promise<void> {
  const path = stripSlash(entry.fullPath);
  if (isJunkFile(path)) return;
  if (walk.files.length >= MAX_COLLECTED_FILES) {
    walk.overflow++;
    return;
  }
  try {
    const file = await new Promise<File>((resolve, reject) => {
      if (entry.file) entry.file(resolve, reject);
      else reject(new Error("not readable"));
    });
    (file as File & { gachipadPath?: string }).gachipadPath = path;
    walk.files.push(file);
  } catch {
    // WebKit gives an entry to files with no path on disk, and it fails with "Path does not exist".
    const direct = walk.direct.get(entry);
    if (direct) {
      (direct as File & { gachipadPath?: string }).gachipadPath = path;
      walk.files.push(direct);
    } else walk.skipped.push({ name: path, reason: "unreadable" });
  }
}

async function readDirectory(entry: FsEntry, walk: Walk): Promise<void> {
  const path = stripSlash(entry.fullPath);
  if (EXCLUDED_FOLDERS.has(entry.name)) {
    walk.skipped.push({ name: path, reason: "excludedFolder" });
    return;
  }
  if (!entry.createReader) {
    walk.skipped.push({ name: path, reason: "unreadable" });
    return;
  }
  try {
    const reader = entry.createReader();
    // readEntries returns batches until it returns an empty one.
    while (!walk.stopped) {
      const batch = await new Promise<FsEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) {
        if (!visit(walk)) break;
        await readEntry(child, walk);
      }
    }
  } catch {
    walk.skipped.push({ name: path, reason: "unreadable" });
  }
}

async function readEntry(entry: FsEntry, walk: Walk): Promise<void> {
  if (entry.isFile) await readFile(entry, walk);
  else if (entry.isDirectory) await readDirectory(entry, walk);
}

type EntryItem = DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null };

/**
 * Collects the files of a drop. Everything that needs the `DataTransfer` (the items, their entries,
 * the file list) is read before the first `await`: the browser empties it when the drop event ends.
 */
export function collectDrop(transfer: DataTransfer): Promise<DroppedFiles> {
  const entries: FsEntry[] = [];
  const loose: File[] = [];
  const direct = new Map<FsEntry, File>();
  let withoutEntries = false;
  try {
    for (const item of Array.from(transfer.items ?? [])) {
      if (item.kind !== "file") continue;
      const entry = (item as EntryItem).webkitGetAsEntry?.() ?? null;
      if (entry) {
        entries.push(entry);
        const file = entry.isFile ? item.getAsFile() : null;
        if (file) direct.set(entry, file);
        continue;
      }
      if (typeof (item as EntryItem).webkitGetAsEntry !== "function") withoutEntries = true;
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
    if (entries.length === 0 && loose.length === 0) loose.push(...Array.from(transfer.files ?? []));
  } catch {
    // Fall through with whatever was read.
  }
  return finish(entries, loose, direct, withoutEntries);
}

async function finish(
  entries: FsEntry[],
  loose: File[],
  direct: Map<FsEntry, File>,
  withoutEntries: boolean,
): Promise<DroppedFiles> {
  const walk: Walk = { files: [], skipped: [], visited: 0, overflow: 0, stopped: false, direct };
  try {
    for (const entry of entries) {
      if (!visit(walk)) break;
      await readEntry(entry, walk);
    }
  } catch {
    walk.skipped.push({ name: "", reason: "unreadable" });
  }
  for (const file of loose) {
    if (!visit(walk)) break;
    if (isJunkFile(file.name)) continue;
    if (walk.files.length >= MAX_COLLECTED_FILES) {
      walk.overflow++;
      continue;
    }
    // A browser that cannot list folders hands one over as a file that fails on its first read.
    if (withoutEntries && !(await canRead(file))) {
      walk.skipped.push({ name: file.name, reason: "folder" });
      continue;
    }
    walk.files.push(file);
  }
  if (walk.overflow > 0) {
    walk.skipped.push({ name: "", reason: "tooMany", count: walk.overflow });
  }
  // How much is left is unknown: not listing it is the point, so it is not counted as a skip.
  if (walk.stopped) walk.skipped.push({ name: "", reason: "notChecked", count: 0 });
  return { files: walk.files, skipped: walk.skipped };
}

async function canRead(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/** Just the files, for callers that have no use for the skipped ones. */
export async function collectDroppedFiles(transfer: DataTransfer): Promise<File[]> {
  return (await collectDrop(transfer)).files;
}
