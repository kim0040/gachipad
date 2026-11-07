import { MAX_PATH_LENGTH, NEARBY_PREVIEW_LINES } from "@gachipad/shared";

/**
 * Normalises an uploaded or client supplied path, into NFC so a name from macOS (NFD) is the same
 * name as one typed elsewhere; null when it could escape its root.
 */
export function sanitizePath(path: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are rejected on purpose
  if (/[\u0000-\u001f]/.test(path)) return null;
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  if (/^[A-Za-z]:$/.test(parts[0] as string)) return null;
  const clean = parts.join("/").normalize("NFC");
  return clean.length > MAX_PATH_LENGTH ? null : clean;
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Text files only: a NUL byte in the first 8 KB, or invalid UTF-8, marks binary content. */
export function decodeText(data: Uint8Array): string | null {
  const head = data.subarray(0, 8000);
  if (head.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

/** The first `lines` lines; the newline that ends a short text does not count as another line. */
export function firstLines(text: string, lines = NEARBY_PREVIEW_LINES): string {
  const parts = text.split("\n");
  const head = parts.slice(0, lines);
  if (parts.length <= lines && head[head.length - 1] === "") head.pop();
  return head.join("\n");
}

/** `Content-Disposition: attachment` with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function attachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const utf8Length = (text: string) => Buffer.byteLength(text, "utf8");
