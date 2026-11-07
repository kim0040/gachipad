/*
 * Numbers the guide quotes. Limits come from @gachipad/shared so a changed constant changes the
 * text; the editor preferences are written out here because importing lib/prefs would pull the
 * whole highlighter into the page, and facts.test.ts fails if they drift from it.
 */
import {
  defaultSettings,
  HISTORY_MAX_SNAPSHOTS,
  HISTORY_SNAPSHOT_INTERVAL_MS,
  MAX_FILES_PER_SHARE,
  MAX_NOTE_LENGTH,
  MAX_PIN_LENGTH,
  MAX_TAGS_PER_SHARE,
  MIN_PIN_LENGTH,
  NEARBY_PREVIEW_LINES,
  PIN_ATTEMPT_WINDOW_SECONDS,
  PIN_MAX_ATTEMPTS,
} from "@gachipad/shared";

const MB = 1024 * 1024;
const defaults = defaultSettings();

export const FACTS = {
  pinMin: MIN_PIN_LENGTH,
  pinMax: MAX_PIN_LENGTH,
  pinAttempts: PIN_MAX_ATTEMPTS,
  pinMinutes: PIN_ATTEMPT_WINDOW_SECONDS / 60,
  noteMax: MAX_NOTE_LENGTH,
  files: MAX_FILES_PER_SHARE,
  tags: MAX_TAGS_PER_SHARE,
  nearbyLines: NEARBY_PREVIEW_LINES,
  historySeconds: HISTORY_SNAPSHOT_INTERVAL_MS / 1000,
  historyMax: HISTORY_MAX_SNAPSHOTS,
  /** Admin-editable; these are the defaults, the page prefers the server's public values. */
  defaultHistoryDays: defaults.historyRetentionDays,
  defaultUploadMB: defaults.maxUploadMB,
  defaultDocMB: defaults.maxDocBytes / MB,
  defaultExpiryHours: defaults.anonymousTtlHours,
  /** Dropped or uploaded files: bigger than this is skipped (features/editor/import-files.ts). */
  importFileMB: 5,
  /** At this many people in one file, the "auto" remote-cursor mode dims carets and hides most names. */
  cursorCrowd: 6,
} as const;

/** Editor preferences (lib/prefs.ts). */
export const EDITOR_FACTS = {
  fontMin: 10,
  fontMax: 28,
  fontDefault: 14,
  tabSizes: [2, 3, 4, 8],
  keymaps: ["default", "vim", "emacs", "sublime"],
  editorThemes: ["slate", "graphite", "paper", "sand"],
} as const;
