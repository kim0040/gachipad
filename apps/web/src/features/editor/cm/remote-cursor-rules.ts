import type { RemoteCursorMode } from "../../../lib/prefs";

/**
 * What a remote caret shows, as plain decisions: the CodeMirror layer in remote-cursors.ts feeds
 * them numbers from the document and from what it last drew, and reads nothing else.
 */

/** A file is busy from this many distinct people on it, me included... */
export const BUSY_ENTER_PEOPLE = 4;
/** ...and stops being busy at this many, so a class around the limit does not flap. */
export const BUSY_LEAVE_PEOPLE = 2;
/** It is crowded from this many... */
export const CROWDED_ENTER_PEOPLE = 8;
/** ...and drops to busy at this many. */
export const CROWDED_LEAVE_PEOPLE = 6;
/** In a busy file a name flashes only for someone who starts after being quiet this long. */
export const ACTIVITY_QUIET_MS = 10_000;
/** In a busy file at most this many names flash at once. */
export const MAX_BUSY_NAMES = 2;
/** A caret glides only over a short distance: about one line down or up... */
export const GLIDE_MAX_LINES = 1.5;
/** ...and about twenty characters along it. Anything further jumps. */
export const GLIDE_MAX_X_PX = 160;
/** How close the pointer must be to a caret, either side, to show that person's name. */
export const CARET_HIT_SLOP_PX = 5;
/** A flag above a caret needs this much of the visible editor over the caret, or it hangs below. */
export const FLAG_ROOM_PX = 22;

export type CrowdLevel = "few" | "busy" | "crowded";

/** The level for `people` on a file, given the level it was at: enter at the upper limit, leave at the lower. */
export function nextCrowdLevel(level: CrowdLevel, people: number): CrowdLevel {
  const crowded =
    level === "crowded" ? people > CROWDED_LEAVE_PEOPLE : people >= CROWDED_ENTER_PEOPLE;
  if (crowded) return "crowded";
  const busy = level === "few" ? people >= BUSY_ENTER_PEOPLE : people > BUSY_LEAVE_PEOPLE;
  return busy ? "busy" : "few";
}

/** Distinct people on a file; two tabs of one person count once, and I am always on my own file. */
export function peopleOnFile(
  states: Iterable<{ user?: { clientId: string }; fileId?: string }>,
  fileId: string,
  self: string | undefined,
): number {
  const people = new Set<string>();
  if (self !== undefined) people.add(self);
  for (const state of states) {
    if (state.user && state.fileId === fileId) people.add(state.user.clientId);
  }
  return people.size;
}

/**
 * Whether a peer really did something. A first sighting (a join, or a redraw that lost track of
 * them) and a tab too old to send `moved` have nothing to compare, so they never count.
 */
export function movedChanged(previous: unknown, next: unknown): boolean {
  return typeof previous === "number" && typeof next === "number" && previous !== next;
}

export function shouldGlide(active: boolean, dx: number, dy: number, lineHeight: number): boolean {
  return active && Math.abs(dy) <= lineHeight * GLIDE_MAX_LINES && Math.abs(dx) <= GLIDE_MAX_X_PX;
}

export type RemoteCursorDensity = "normal" | "busy" | "crowded" | "carets";

export function densityOf(mode: RemoteCursorMode, level: CrowdLevel): RemoteCursorDensity {
  if (mode === "carets") return "carets";
  return mode === "auto" && level !== "few" ? level : "normal";
}

/** Whether a person's own move may glide; with many people a caret lands at once. */
export function glidesIn(density: RemoteCursorDensity): boolean {
  return density === "normal" || density === "carets";
}

export interface PeerRole {
  presenter: boolean;
  followed: boolean;
  /** Share owner or lab teacher, stamped by the server. */
  host: boolean;
}

/** Whether a person's name stays on with no animation. */
export function isPinned(mode: RemoteCursorMode, level: CrowdLevel, role: PeerRole): boolean {
  if (mode === "carets") return false;
  if (mode === "always") return true;
  const density = densityOf(mode, level);
  return (
    role.presenter || role.followed || (role.host && (density === "busy" || density === "crowded"))
  );
}

/**
 * Whether this activity began after the person had been quiet: their previous activity was at
 * least `ACTIVITY_QUIET_MS` ago, or never seen.
 */
export function startedAfterQuiet(previousAt: number | undefined, now: number): boolean {
  return previousAt === undefined || now - previousAt >= ACTIVITY_QUIET_MS;
}

/**
 * Whether a peer who just did something flashes their name. `started` is whether it began after a
 * quiet spell; `namesShowing` is how many flashed names are still on screen.
 */
export function flashesName(
  density: RemoteCursorDensity,
  started: boolean,
  namesShowing: number,
): boolean {
  if (density === "normal") return true;
  if (density === "busy") return started && namesShowing < MAX_BUSY_NAMES;
  return false;
}

/** Whether a caret's flag would be clipped above the visible part of the editor. */
export function flagHangsBelow(y: number, scrollTop: number): boolean {
  return y - scrollTop < FLAG_ROOM_PX;
}

export interface DrawnCaret {
  id: number;
  x: number;
  y: number;
  height: number;
}

/** The caret under a point, in the same coordinates as `carets`; the nearest one when they overlap. */
export function caretAt(carets: readonly DrawnCaret[], x: number, y: number): number | null {
  let best: number | null = null;
  let bestDistance = CARET_HIT_SLOP_PX;
  for (const caret of carets) {
    const distance = Math.abs(caret.x - x);
    if (distance > bestDistance || y < caret.y || y > caret.y + caret.height) continue;
    best = caret.id;
    bestDistance = distance;
  }
  return best;
}
