import type { RemoteCursorMode } from "../../../lib/prefs";

/**
 * What a remote caret shows, as plain decisions: the CodeMirror layer in remote-cursors.ts feeds
 * them numbers from the document and from what it last drew, and reads nothing else.
 */

/** A file is crowded from this many distinct people on it, me included... */
export const CROWD_ENTER_PEOPLE = 6;
/** ...and stops being crowded at this many, so a class around the limit does not flap. */
export const CROWD_LEAVE_PEOPLE = 4;
/** In a crowded file only someone this many lines from my main cursor flashes a name. */
export const NEAR_CURSOR_LINES = 3;
/** A caret glides only over a short distance: about one line down or up... */
export const GLIDE_MAX_LINES = 1.5;
/** ...and about twenty characters along it. Anything further jumps. */
export const GLIDE_MAX_X_PX = 160;
/** How close the pointer must be to a caret, either side, to show that person's name. */
export const CARET_HIT_SLOP_PX = 5;

export function nextCrowded(crowded: boolean, people: number): boolean {
  return crowded ? people > CROWD_LEAVE_PEOPLE : people >= CROWD_ENTER_PEOPLE;
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

export type RemoteCursorDensity = "normal" | "crowded" | "carets";

export function densityOf(mode: RemoteCursorMode, crowded: boolean): RemoteCursorDensity {
  if (mode === "carets") return "carets";
  return mode === "auto" && crowded ? "crowded" : "normal";
}

export interface PeerRole {
  presenter: boolean;
  followed: boolean;
  /** Share owner or lab teacher, stamped by the server. */
  host: boolean;
}

/** Whether a person's name stays on with no animation. */
export function isPinned(mode: RemoteCursorMode, crowded: boolean, role: PeerRole): boolean {
  if (mode === "carets") return false;
  if (mode === "always") return true;
  return role.presenter || role.followed || (role.host && densityOf(mode, crowded) === "crowded");
}

/** Whether a peer who just did something flashes their name, `lines` away from my main cursor. */
export function flashesName(mode: RemoteCursorMode, crowded: boolean, lines: number): boolean {
  if (mode === "carets" || mode === "always") return false;
  return densityOf(mode, crowded) === "crowded" ? lines <= NEAR_CURSOR_LINES : true;
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
