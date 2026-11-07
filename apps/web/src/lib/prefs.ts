import { isThemeId, type ThemeId } from "@gachipad/highlight";
import { useSyncExternalStore } from "react";
import { LEGACY_STORAGE_PREFIX, mirrorLegacy, readMigratedKey } from "./storage-migration";

/** Editor preferences, kept on this device (localStorage) and applied live. */

export const KEYMAPS = ["default", "vim", "emacs", "sublime"] as const;
export type Keymap = (typeof KEYMAPS)[number];

/** Keep offline copies on this device: not asked yet (no copy), yes, or no. */
export const OFFLINE_COPY_CHOICES = ["undecided", "yes", "no"] as const;
export type OfflineCopyChoice = (typeof OFFLINE_COPY_CHOICES)[number];

/** How other people's cursors show: by head count, on every move, names always on, or bars only. */
export const REMOTE_CURSOR_MODES = ["auto", "moving", "always", "carets"] as const;
export type RemoteCursorMode = (typeof REMOTE_CURSOR_MODES)[number];

export interface EditorPrefs {
  /** `auto` follows the app theme: Slate in dark, Paper in light. */
  editorTheme: ThemeId | "auto";
  fontSize: number;
  tabSize: number;
  indentWithTabs: boolean;
  wrap: boolean;
  lineNumbers: boolean;
  keymap: Keymap;
  /** The cursor glides as you type (none under `prefers-reduced-motion`). */
  smoothTyping: boolean;
  remoteCursors: RemoteCursorMode;
  /** Offer language-aware completions while editing. */
  codeCompletion: boolean;
  /** Show invites as system notifications while the tab is in the background. */
  notifications: boolean;
  /**
   * Keep an offline copy of each share in this browser (IndexedDB). Device-wide; nothing is
   * written while it is `undecided` (lib/device.ts).
   */
  offlineCopy: OfflineCopyChoice;
}

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 28;
export const TAB_SIZES = [2, 3, 4, 8] as const;

export const DEFAULT_PREFS: EditorPrefs = {
  editorTheme: "auto",
  fontSize: 14,
  tabSize: 2,
  indentWithTabs: false,
  wrap: true,
  lineNumbers: true,
  keymap: "default",
  smoothTyping: true,
  remoteCursors: "auto",
  codeCompletion: true,
  notifications: false,
  offlineCopy: "undecided",
};

const STORAGE_KEY = "gachipad.prefs";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Accepts anything that was stored and returns a complete, valid preference object. */
export function sanitizePrefs(input: unknown): EditorPrefs {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  const num = (key: string, fallback: number, min: number, max: number) =>
    typeof raw[key] === "number" && Number.isFinite(raw[key])
      ? clamp(raw[key] as number, min, max)
      : fallback;
  const bool = (key: string, fallback: boolean) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;
  const theme = raw.editorTheme;
  const keymap = raw.keymap;
  const offlineCopy = raw.offlineCopy;
  const remoteCursors = raw.remoteCursors;
  return {
    editorTheme: isThemeId(theme) ? theme : "auto",
    fontSize: num("fontSize", d.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
    tabSize: num("tabSize", d.tabSize, 1, 8),
    indentWithTabs: bool("indentWithTabs", d.indentWithTabs),
    wrap: bool("wrap", d.wrap),
    lineNumbers: bool("lineNumbers", d.lineNumbers),
    keymap: KEYMAPS.find((k) => k === keymap) ?? d.keymap,
    smoothTyping: bool("smoothTyping", d.smoothTyping),
    remoteCursors: REMOTE_CURSOR_MODES.find((m) => m === remoteCursors) ?? d.remoteCursors,
    codeCompletion: bool("codeCompletion", d.codeCompletion),
    notifications: bool("notifications", d.notifications),
    // Before the choice existed the setting was a boolean that defaulted to on without asking:
    // `true` was never a decision, `false` was.
    offlineCopy:
      offlineCopy === false
        ? "no"
        : (OFFLINE_COPY_CHOICES.find((c) => c === offlineCopy) ?? d.offlineCopy),
  };
}

function load(): EditorPrefs {
  try {
    const text = readMigratedKey(STORAGE_KEY);
    return sanitizePrefs(text ? JSON.parse(text) : {});
  } catch {
    return DEFAULT_PREFS;
  }
}

let current: EditorPrefs | null = null;
const listeners = new Set<() => void>();

export function getPrefs(): EditorPrefs {
  current ??= load();
  return current;
}

function emit() {
  for (const listener of listeners) listener();
}

/** False when the change could not be stored: it still applies until the tab closes. */
export function setPrefs(patch: Partial<EditorPrefs>): boolean {
  current = sanitizePrefs({ ...getPrefs(), ...patch });
  let stored = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    mirrorLegacy(STORAGE_KEY, JSON.stringify(current));
  } catch {
    stored = false;
  }
  emit();
  return stored;
}

/** Back to the defaults; the device choice about offline copies is not an editor preference and stays. */
export function resetPrefs(): void {
  setPrefs({ ...DEFAULT_PREFS, offlineCopy: getPrefs().offlineCopy });
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === `${LEGACY_STORAGE_PREFIX}prefs`) {
      current = load();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePrefs(): EditorPrefs {
  return useSyncExternalStore(subscribePrefs, getPrefs, () => DEFAULT_PREFS);
}
