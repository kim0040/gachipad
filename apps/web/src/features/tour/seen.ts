import { createStore, useStore } from "../../lib/store";

/** Raise it when the tour changes enough that people who saw the old one should see it again. */
export const TOUR_VERSION = 2;
/** localStorage key holding the highest tour version this browser has seen. */
export const TOUR_STORAGE_KEY = "gachipad.tour";

/** Seen in this page's lifetime; the only memory there is when storage is blocked. */
let seenHere = 0;

function storedVersion(): number {
  try {
    const value = Number(localStorage.getItem(TOUR_STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** A tour of version `current` counts as seen by someone who saw `seen`: a bump shows it again. */
export const isVersionSeen = (seen: number, current: number = TOUR_VERSION) => seen >= current;

/** True once this browser (or, with blocked storage, this page) has seen the current tour. */
export function tourSeen(): boolean {
  return isVersionSeen(Math.max(storedVersion(), seenHere));
}

/** Skip and Done both end here. With blocked storage the tour just comes back next visit. */
export function markTourSeen(): void {
  seenHere = TOUR_VERSION;
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, String(TOUR_VERSION));
  } catch {
    // Not persisted: nothing else to do.
  }
}

/** Forgets what this page remembered (tests). */
export function resetTourMemory(): void {
  seenHere = 0;
}

const replays = createStore(0);

/** Settings > Replay tutorial: the mounted tour starts once the sheet is gone. */
export const requestTour = () => replays.set((count) => count + 1);
export const useTourRequests = () => useStore(replays);
