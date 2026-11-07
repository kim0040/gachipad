/** Files arriving in the editor by drop or paste. The page takes them; the editor must not. */

export function transferHasFiles(
  transfer: Pick<DataTransfer, "types"> | null | undefined,
): boolean {
  return Boolean(transfer && Array.from(transfer.types).includes("Files"));
}

/**
 * CodeMirror's own drop handler reads dropped files and inserts their text at the pointer. The
 * page-level handler imports them as files, so this one only claims the event (returning true
 * stops CodeMirror) and never imports: a drop on the editor adds each file exactly once.
 */
export function editorFileDropHandlers() {
  return {
    dragover(event: Pick<DragEvent, "dataTransfer" | "preventDefault">): boolean {
      if (!transferHasFiles(event.dataTransfer)) return false;
      event.preventDefault();
      return true;
    },
    drop(event: Pick<DragEvent, "dataTransfer" | "preventDefault">): boolean {
      if (!transferHasFiles(event.dataTransfer)) return false;
      event.preventDefault();
      return true;
    },
  };
}

interface Clipboard {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<DataTransferItem> | null;
  types?: ArrayLike<string> | null;
  getData(format: string): string;
}

/** The file name in a clipboard line: the line itself, or the end of a path or a file:// URI. */
function pastedName(line: string): string {
  let path = line;
  if (/^file:\/\//i.test(line)) {
    try {
      path = decodeURIComponent(new URL(line).pathname);
    } catch {
      return line.normalize("NFC");
    }
  }
  return (path.replace(/\\/g, "/").split("/").pop() ?? path).normalize("NFC");
}

/**
 * The files of a paste that copied files (Finder, Explorer, Linux file managers), or an empty list
 * when it is text. A clipboard from a file manager holds the files plus their names, paths or
 * file:// URIs as text; anything else as text (cells copied from a spreadsheet come with an image
 * of them) and anything with HTML (copied from a page or a document) is an ordinary paste.
 */
export function pastedFiles(clipboard: Clipboard | null | undefined): File[] {
  if (!clipboard) return [];
  let files = Array.from(clipboard.files ?? []);
  if (files.length === 0) {
    for (const item of Array.from(clipboard.items ?? [])) {
      const file = item.kind === "file" ? item.getAsFile() : null;
      if (file) files.push(file);
    }
  }
  files = files.filter(Boolean);
  if (files.length === 0) return [];
  if (Array.from(clipboard.types ?? []).includes("text/html")) return [];
  const names = new Set(files.map((file) => file.name.normalize("NFC")));
  const lines = clipboard
    .getData("text/plain")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.every((line) => names.has(pastedName(line))) ? files : [];
}

/** A paste outside the editor that is the page's: not typing in a field, and not the editor's own. */
export function pasteIsForPage(target: EventTarget | null): boolean {
  const element = target as Partial<Pick<Element, "closest">> | null;
  return !element?.closest?.(
    'input, textarea, [contenteditable=""], [contenteditable="true"], .cm-editor',
  );
}
