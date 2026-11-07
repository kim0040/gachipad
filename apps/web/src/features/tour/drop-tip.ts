/** localStorage key set once the "drag files in" tip has done its job. */
export const DROP_TIP_STORAGE_KEY = "gachipad.tip.drop";

/** Done in this page's lifetime; the only memory there is when storage is blocked. */
let doneHere = false;
const listeners = new Set<() => void>();

function storedDone(): boolean {
  try {
    return localStorage.getItem(DROP_TIP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** True once the tip was dismissed, or a file was added, in this browser (or this page). */
export function dropTipDone(): boolean {
  return doneHere || storedDone();
}

/** Dismiss and the first added file both end here: the tip never comes back. */
export function markDropTipDone(): void {
  doneHere = true;
  try {
    localStorage.setItem(DROP_TIP_STORAGE_KEY, "1");
  } catch {
    // Not persisted: it can show again next visit, once.
  }
  for (const listener of listeners) listener();
}

/** Follows the mark, set in this tab or in another one. */
export function subscribeDropTip(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DROP_TIP_STORAGE_KEY || event.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Forgets what this page remembered (tests). */
export function resetDropTipMemory(): void {
  doneHere = false;
}

export interface DropTipState {
  /** The person may add files (not a viewer, not locked out). */
  canAdd: boolean;
  done: boolean;
  /** The tour has been seen: the first visit shows the tour, not this. */
  tourSeen: boolean;
  /** Any dialog is open, the tour's own included. */
  dialogOpen: boolean;
  /** The device question (keep an offline copy?) is still open: one hint at a time. */
  deviceQuestion: boolean;
  /** A side panel (share, settings, comments, ...) is open. */
  panelOpen: boolean;
  /** The "you're the only one here" card is showing: one hint at a time. */
  aloneHintShown: boolean;
  /** This person typed in the editor since the page opened: the tip stays out of the way. */
  typed: boolean;
  /** The editor has been up for a moment. */
  settled: boolean;
}

/** One tip at a time, only for people who can add files, never over a dialog or while typing. */
export function showDropTip(state: DropTipState): boolean {
  return (
    state.canAdd &&
    !state.done &&
    state.tourSeen &&
    !state.dialogOpen &&
    !state.deviceQuestion &&
    !state.panelOpen &&
    !state.aloneHintShown &&
    !state.typed &&
    state.settled
  );
}

/** Dragging needs a mouse and room: on touch-only and narrow screens the tip points at the button. */
export function dropTipUsesButton(device: { touchOnly: boolean; narrow: boolean }): boolean {
  return device.touchOnly || device.narrow;
}

/**
 * Whether a file count that changed once the document was in means a file was added. The baseline
 * follows the count down (a deleted file is not "undone" by the next addition).
 */
export function fileWasAdded(baseline: number, count: number): boolean {
  return count > baseline;
}
