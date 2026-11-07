import type { MessageKey } from "@gachipad/i18n";
import { toast } from "@gachipad/ui";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "../../lib/i18n";

/**
 * Dropping files on the page.
 *
 * One set of window listeners (`useFileDropGuard`, mounted by the app shell) serves every route:
 * - a file drop that misses every target never makes the browser open the file and leave the app;
 * - the page that wants the files (`useFileDrop`) shows an overlay while files are dragged over
 *   the window and receives the drop.
 *
 * The listeners run in the capture phase, before any target below sees the event, so there is
 * exactly one importer per drop. Targets that take drops themselves (a person to send a file to)
 * carry `data-file-drop-target`, and a modal dialog with drop handling of its own carries
 * `data-file-drop-modal`; those two get no overlay and no import from the page. Every other dialog,
 * sheet or the tour leaves the drop to the page, which takes it or says why it cannot.
 */

export const FILE_DROP_TARGET_ATTR = "data-file-drop-target";
const OPEN_DROP_MODAL = '[data-file-drop-modal][data-state="open"]';

/**
 * A drag that is still alive without events (Esc, the pointer left the window) ends after this. A
 * browser sends `dragover` about every 350 ms (HTML spec: 350 +/- 200) while the pointer holds
 * still, but this has only been seen under automation; a late end is harmless, a flicker is not.
 */
const STALE_MS = 4000;

export interface FileDropConfig {
  /** "add" puts the files into the open share, "create" starts a new share from them. */
  mode: "add" | "create";
  /** Why the files cannot be taken right now; the overlay says so and a drop shows a toast. */
  denied: MessageKey | null;
  /** A new share is being created: a drag says so, and a drop is ignored. */
  busy?: boolean;
  /** Keep the overlay up with no drag at all: the busy state is the result of a drop. */
  showBusy?: boolean;
  /** Called inside the drop event: read the `DataTransfer` before the first await. */
  onDrop: (transfer: DataTransfer) => void;
}

export interface FileDropView {
  mode: "add" | "create";
  denied: MessageKey | null;
  busy: boolean;
}

let page: { current: FileDropConfig } | null = null;
/** Files are being dragged somewhere inside the window, over a target or not. */
let dragging = false;
/** The pointer is over something that takes the drop itself, so the page stays out of the way. */
let suppressed = false;
let depth = 0;
let staleTimer = 0;
const listeners = new Set<() => void>();
let snapshot: FileDropView | null = null;

function publish() {
  const config = page?.current;
  const visible = Boolean(config && (config.showBusy || (dragging && !suppressed)));
  const next: FileDropView | null =
    config && visible
      ? { mode: config.mode, denied: config.denied, busy: Boolean(config.busy) }
      : null;
  const same =
    next === snapshot ||
    (next !== null &&
      snapshot !== null &&
      next.mode === snapshot.mode &&
      next.denied === snapshot.denied &&
      next.busy === snapshot.busy);
  if (same) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function endDrag() {
  window.clearTimeout(staleTimer);
  depth = 0;
  dragging = false;
  suppressed = false;
  publish();
}

/** An event of a drag inside the window: it is alive, and this is what the pointer is over. */
function continueDrag(overTarget: boolean) {
  window.clearTimeout(staleTimer);
  staleTimer = window.setTimeout(endDrag, STALE_MS);
  dragging = true;
  suppressed = overTarget;
  publish();
}

/** A drag that carries files from outside the page (not a text selection, not an internal tab). */
export function isExternalFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes("Files"));
}

function insideTarget(event: Event): boolean {
  return (
    event.target instanceof Element && event.target.closest(`[${FILE_DROP_TARGET_ATTR}]`) !== null
  );
}

export type DropDecision = "ignore" | "take" | "denied" | "busy";

/**
 * What the page does with a drag of files. It leaves the drag alone when no page wants files, when
 * a dialog with drop handling of its own is open (its drop zone or person list takes it) and over
 * an element that takes drops itself; otherwise the page is the only importer.
 */
export function decideDrop(state: {
  hasPage: boolean;
  modalOpen: boolean;
  inTarget: boolean;
  busy: boolean;
  denied: boolean;
}): DropDecision {
  if (!state.hasPage || state.modalOpen || state.inTarget) return "ignore";
  if (state.busy) return "busy";
  return state.denied ? "denied" : "take";
}

function onCapture(event: DragEvent) {
  if (!isExternalFileDrag(event)) return;
  const config = page?.current;
  if (event.type === "dragleave") {
    if (--depth <= 0) endDrag();
    else if (
      !event.relatedTarget &&
      (event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight)
    )
      endDrag();
    return;
  }
  // Every element entered counts, target or not: entering the next one comes before leaving the
  // last, so the count stays above zero for as long as the pointer is in the window.
  if (event.type === "dragenter") depth++;
  else if (event.type === "dragover" && depth < 1) depth = 1;
  const decision = decideDrop({
    hasPage: Boolean(config),
    modalOpen: document.querySelector(OPEN_DROP_MODAL) !== null,
    inTarget: insideTarget(event),
    busy: Boolean(config?.busy),
    denied: Boolean(config?.denied),
  });
  if (event.type === "drop") {
    endDrag();
    if (decision === "ignore" || !config) return;
    event.preventDefault();
    if (decision === "denied" && config.denied) deniedHandler?.(config.denied);
    else if (decision === "take" && event.dataTransfer) config.onDrop(event.dataTransfer);
    return;
  }
  // dragenter / dragover
  continueDrag(decision === "ignore");
  if (decision === "ignore") return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = decision === "take" ? "copy" : "none";
}

let deniedHandler: ((reason: MessageKey) => void) | null = null;

/** After the page's own listeners: a file drop that nobody took must not navigate. */
function onGuard(event: DragEvent) {
  if (!isExternalFileDrag(event) || event.defaultPrevented) return;
  if (event.target instanceof HTMLInputElement && event.target.type === "file") return;
  event.preventDefault();
  if (event.type === "dragover" && event.dataTransfer) event.dataTransfer.dropEffect = "none";
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && dragging) endDrag();
}

const TYPES = ["dragenter", "dragover", "dragleave", "drop"] as const;

/** Window-level drop handling for the whole app; mounted once by the app shell. */
export function useFileDropGuard() {
  useEffect(() => {
    for (const type of TYPES) window.addEventListener(type, onCapture, true);
    for (const type of ["dragenter", "dragover", "drop"] as const) {
      window.addEventListener(type, onGuard);
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", endDrag);
    return () => {
      for (const type of TYPES) window.removeEventListener(type, onCapture, true);
      for (const type of ["dragenter", "dragover", "drop"] as const) {
        window.removeEventListener(type, onGuard);
      }
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", endDrag);
      endDrag();
    };
  }, []);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Makes the calling page take file drops anywhere on it. Returns what the overlay should show
 * (null when nothing is dragged and nothing is pending). One hook for the share page and the
 * landing page.
 */
export function useFileDrop(config: FileDropConfig): FileDropView | null {
  const t = useT();
  const ref = useRef(config);
  ref.current = config;
  useEffect(() => {
    const entry = ref;
    page = entry;
    deniedHandler = (reason) => toast({ title: t(reason), tone: "warning" });
    publish();
    return () => {
      if (page === entry) {
        page = null;
        deniedHandler = null;
      }
      publish();
    };
  }, [t]);
  // Config changes (denied, busy) reach the overlay without waiting for the next drag event.
  useEffect(() => {
    if (page === ref) publish();
  });
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
}
