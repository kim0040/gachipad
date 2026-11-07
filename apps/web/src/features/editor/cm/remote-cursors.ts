import { EditorSelection, Facet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, type LayerMarker, layer, RectangleMarker, ViewPlugin } from "@codemirror/view";
import { contrastRatio, PARTICIPANT_COLORS } from "@gachipad/highlight";
import type { AwarenessState } from "@gachipad/shared";
import * as Y from "yjs";
import type { DocSession } from "../../../lib/collab/session";
import type { RemoteCursorMode } from "../../../lib/prefs";
import {
  CARET_HIT_SLOP_PX,
  caretAt,
  type DrawnCaret,
  densityOf,
  flagHangsBelow,
  flashesName,
  isPinned,
  linesApart,
  movedChanged,
  nextCrowded,
  peopleOnFile,
  shouldGlide,
} from "./remote-cursor-rules";

/**
 * Remote cursors and selections drawn in CodeMirror layers instead of inline widgets. A layer
 * marker keeps its DOM element between updates, so moving a cursor only changes a CSS transform
 * and the browser animates it on the compositor (60 fps, no layout). The name flag fades in when
 * a person really did something (their `moved` count changed), never because their caret was
 * pushed, redrawn or scrolled back into view, and out again when they go idle. A caret pushed by
 * text moves with that text; only a short move of the person's own glides.
 */

export const refreshRemote = StateEffect.define<null>();

/** This device's setting, reconfigured live by EditorPane. */
export const remoteCursorMode = Facet.define<RemoteCursorMode, RemoteCursorMode>({
  combine: (values) => values[0] ?? "auto",
});

const setCrowded = StateEffect.define<boolean>();
const crowdedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setCrowded)) return effect.value;
    return value;
  },
});

const setSpotlight = StateEffect.define<string | null>();
const spotlightField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSpotlight)) return effect.value;
    return value;
  },
});

/** Highlights a person's carets (the participant list is on them), or none. */
export function spotlightRemote(view: EditorView | null, clientId: string | null): void {
  if (view && view.state.field(spotlightField, false) !== clientId) {
    view.dispatch({ effects: setSpotlight.of(clientId) });
  }
}

const INK = "#0a0c10";

const labelColors = new Map<string, string>();
/** Text colour for a flag filled with `hex`: from the palette, else whichever of white/ink reads. */
export function labelColorFor(hex: string): string {
  const key = hex.toLowerCase();
  const known = labelColors.get(key);
  if (known) return known;
  const fromPalette = PARTICIPANT_COLORS.find((c) => c.hex.toLowerCase() === key)?.label;
  const color =
    fromPalette ?? (contrastRatio("#ffffff", hex) >= contrastRatio(INK, hex) ? "#ffffff" : INK);
  labelColors.set(key, color);
  return color;
}

/** Match the full flag animation, including its fade; moving during the fade must not hide it. */
const FLAG_VISIBLE_MS = 3000;

interface Remote {
  awarenessId: number;
  clientId: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
  presenter: boolean;
  host: boolean;
}

function absolute(rel: unknown, doc: Y.Doc, ytext: Y.Text): number | null {
  if (!rel || typeof rel !== "object") return null;
  try {
    const position = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(rel),
      doc,
    );
    if (!position || position.type !== ytext) return null;
    return position.index;
  } catch {
    return null;
  }
}

export function collectRemotes(
  session: DocSession,
  ytext: Y.Text,
  fileId: string,
  length: number,
): Remote[] {
  const awareness = session.provider.awareness;
  if (!awareness) return [];
  const remotes: Remote[] = [];
  for (const [awarenessId, raw] of awareness.getStates()) {
    if (awarenessId === awareness.clientID) continue;
    const state = raw as Partial<AwarenessState>;
    if (!state.user || state.fileId !== fileId || !state.cursor) continue;
    const anchor = absolute(state.cursor.anchor, session.doc, ytext);
    const head = absolute(state.cursor.head, session.doc, ytext);
    if (anchor === null || head === null) continue;
    remotes.push({
      awarenessId,
      clientId: state.user.clientId,
      name: state.user.name,
      color: state.user.color,
      anchor: Math.min(anchor, length),
      head: Math.min(head, length),
      presenter: state.presenting === true,
      host: state.host === true,
    });
  }
  return remotes.sort((a, b) => a.awarenessId - b.awarenessId);
}

interface CaretLook {
  x: number;
  y: number;
  height: number;
  color: string;
  name: string;
  /** Counts this person's flashes, so a marker with a new one is never taken for the old one. */
  flashes: number;
  /** Flash the name now. */
  flash: boolean;
  /** The person's own move, not text pushing the caret: a short one glides. */
  active: boolean;
  /** The name stays on with no animation. */
  pinned: boolean;
  /** Hovered, or highlighted from the participant list: full strength and the name. */
  spot: boolean;
  /** The setting is carets only: a name that is still fading goes now. */
  quiet: boolean;
  /** Too close to the top of what is visible for the flag to fit above the caret. */
  below: boolean;
}

class CaretMarker implements LayerMarker {
  constructor(
    readonly id: number,
    readonly look: CaretLook,
  ) {}

  eq(other: CaretMarker): boolean {
    const a = this.look;
    const b = other.look;
    return (
      this.id === other.id &&
      a.x === b.x &&
      a.y === b.y &&
      a.height === b.height &&
      a.color === b.color &&
      a.name === b.name &&
      a.flashes === b.flashes &&
      a.pinned === b.pinned &&
      a.spot === b.spot &&
      a.quiet === b.quiet &&
      a.below === b.below
    );
  }

  draw(): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-remote-caret";
    root.dataset.peer = String(this.id);
    const bar = document.createElement("div");
    bar.className = "cm-remote-caret-bar";
    const flag = document.createElement("div");
    flag.className = "cm-remote-caret-flag";
    root.append(bar, flag);
    this.apply(root);
    if (this.look.flash) this.flash(root);
    return root;
  }

  update(dom: HTMLElement, old: LayerMarker): boolean {
    const previous = (old as CaretMarker).look;
    // The layer updates every marker when one of them changes; the others stay as they are.
    if (this.eq(old as CaretMarker)) return true;
    const { active, height, x, y } = this.look;
    if (previous.x !== x || previous.y !== y) {
      // In the same style pass as the transform: without it the caret lands in this frame and a
      // glide still under way ends here too.
      dom.toggleAttribute(
        "data-glide",
        shouldGlide(active, x - previous.x, y - previous.y, height),
      );
    }
    this.apply(dom);
    if (this.look.flash) this.flash(dom);
    return true;
  }

  private apply(root: HTMLElement) {
    const { x, y, height, color, name, pinned, spot, quiet, below } = this.look;
    root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    root.style.height = `${height}px`;
    root.style.setProperty("--rc", color);
    root.style.setProperty("--rc-fg", labelColorFor(color));
    // On the first visible rows the flag would be clipped above the editor, so it hangs below.
    root.classList.toggle("is-top", below);
    root.toggleAttribute("data-pinned", pinned);
    root.toggleAttribute("data-spot", spot);
    // Without the flash attributes no animation is left to start over when this ends.
    if (pinned || spot || quiet) {
      delete root.dataset.flag;
      delete root.dataset.flagFrom;
      delete root.dataset.flashed;
    }
    const flag = root.lastElementChild;
    if (flag && flag.textContent !== name) flag.textContent = name;
  }

  /**
   * Restarts the CSS animation that shows the name and fades it after a moment. A new animation
   * name restarts it without reading layout, so 50 moving carets cost no forced reflow; a flag
   * that is still showing stays opaque instead of fading in again on every keystroke.
   */
  private flash(root: HTMLElement) {
    const now = performance.now();
    const showing =
      now - Number(root.dataset.flashed ?? Number.NEGATIVE_INFINITY) < FLAG_VISIBLE_MS;
    root.dataset.flashed = String(now);
    const next = root.dataset.flag === "a" ? "b" : "a";
    root.dataset.flag = next;
    root.dataset.flagFrom = showing ? "shown" : "hidden";
  }
}

class TintMarker implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    readonly color: string,
  ) {}

  eq(other: TintMarker): boolean {
    return (
      this.left === other.left &&
      this.top === other.top &&
      this.width === other.width &&
      this.height === other.height &&
      this.color === other.color
    );
  }

  draw(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-remote-selection";
    this.apply(div);
    return div;
  }

  update(dom: HTMLElement): boolean {
    this.apply(dom);
    return true;
  }

  private apply(div: HTMLElement) {
    div.style.left = `${this.left}px`;
    div.style.top = `${this.top}px`;
    div.style.width = `${this.width}px`;
    div.style.height = `${this.height}px`;
    div.style.setProperty("--rc", this.color);
  }
}

interface KeyedMarker {
  key: string;
  marker: LayerMarker;
}

/**
 * CodeMirror matches layer markers by array index, not identity. Keep one group in each layer
 * and match its children by participant (and selection rectangle) so a join/leave never gives
 * another person's DOM, transition or flag animation to a surviving cursor.
 */
class MarkerGroup implements LayerMarker {
  private nodes = new Map<string, { marker: LayerMarker; dom: HTMLElement }>();

  constructor(readonly entries: KeyedMarker[]) {}

  eq(other: MarkerGroup): boolean {
    return (
      this.entries.length === other.entries.length &&
      this.entries.every((entry, i) => {
        const previous = other.entries[i];
        return previous?.key === entry.key && entry.marker.eq(previous.marker);
      })
    );
  }

  draw(): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-remote-markers";
    this.reconcile(root);
    return root;
  }

  update(root: HTMLElement, old: LayerMarker): boolean {
    this.nodes = (old as MarkerGroup).nodes;
    this.reconcile(root);
    return true;
  }

  private reconcile(root: HTMLElement) {
    const present = new Set<string>();
    for (const { key, marker } of this.entries) {
      present.add(key);
      const previous = this.nodes.get(key);
      if (previous) {
        if (!marker.eq(previous.marker) && !marker.update?.(previous.dom, previous.marker)) {
          const dom = marker.draw();
          previous.dom.replaceWith(dom);
          previous.dom = dom;
        }
        previous.marker = marker;
      } else {
        const dom = marker.draw();
        this.nodes.set(key, { marker, dom });
        root.appendChild(dom);
      }
    }
    for (const [key, node] of this.nodes) {
      if (present.has(key)) continue;
      node.dom.remove();
      this.nodes.delete(key);
    }
  }
}

function layerBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  const left =
    view.textDirection === 0 ? rect.left : rect.right - view.scrollDOM.clientWidth * view.scaleX;
  return {
    left: left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

function needsRedraw(update: import("@codemirror/view").ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.startState.facet(remoteCursorMode) !== update.state.facet(remoteCursorMode) ||
    update.startState.field(crowdedField) !== update.state.field(crowdedField) ||
    update.startState.field(spotlightField) !== update.state.field(spotlightField) ||
    update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshRemote)))
  );
}

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] };

export function remoteCursors(session: DocSession, ytext: Y.Text, fileId: string) {
  // Both layers draw from the same positions; resolving them is O(document) per cursor, so they
  // are resolved once per document state and awareness change, not once per layer.
  let version = 0;
  let cached: { doc: unknown; version: number; remotes: Remote[] } | null = null;
  const remotesOf = (view: EditorView): Remote[] => {
    if (cached?.doc !== view.state.doc || cached.version !== version) {
      cached = {
        doc: view.state.doc,
        version,
        remotes: collectRemotes(session, ytext, fileId, view.state.doc.length),
      };
    }
    return cached.remotes;
  };

  const selections = layer({
    above: false,
    class: "cm-remote-selections",
    update: needsRedraw,
    markers(view) {
      const markers: KeyedMarker[] = [];
      for (const remote of remotesOf(view)) {
        if (remote.anchor === remote.head) continue;
        const range = EditorSelection.range(remote.anchor, remote.head);
        const rectangles = RectangleMarker.forRange(view, "", range);
        for (const [i, rect] of rectangles.entries()) {
          markers.push({
            key: `${remote.awarenessId}:${i}`,
            marker: new TintMarker(rect.left, rect.top, rect.width ?? 0, rect.height, remote.color),
          });
        }
      }
      return [new MarkerGroup(markers)];
    },
  });

  const awareness = session.provider.awareness;
  const selfClientId = () =>
    (awareness?.getLocalState() as Partial<AwarenessState> | null)?.user?.clientId;
  const countPeople = () =>
    peopleOnFile(
      (awareness?.getStates().values() ?? []) as Iterable<Partial<AwarenessState>>,
      fileId,
      selfClientId(),
    );

  // Who did something since the last draw (their `moved` changed), and the count last seen. A peer
  // whose new position cannot be resolved yet (its text is still on the way) stays in `active`.
  const lastMoved = new Map<number, unknown>();
  const active = new Set<number>();
  const flashes = new Map<number, number>();
  let textChanged = false;
  let drawn: (DrawnCaret & { below: boolean })[] = [];
  let pointer: { x: number; y: number } | null = null;
  let hovered: number | null = null;
  // Escape hid this caret's name: it stays hidden until the pointer has left it.
  let dismissed: number | null = null;

  const hoverAt = (view: EditorView, base: { left: number; top: number }): number | null => {
    if (!pointer) return null;
    const hit = caretAt(
      drawn,
      (pointer.x - base.left) / view.scaleX,
      (pointer.y - base.top) / view.scaleY,
    );
    if (hit !== dismissed) dismissed = null;
    if (hit === null && hovered !== null && overFlag(view, hovered)) return hovered;
    return hit === dismissed ? null : hit;
  };

  // The name it opened counts as the caret, so it can be read and is not lost on the way there
  // (WCAG 1.4.13). The flag takes no pointer events, so this asks where it is: one read, only while
  // a name is open by hover.
  const overFlag = (view: EditorView, id: number): boolean => {
    if (!pointer) return false;
    const flag = view.dom.querySelector(
      `.cm-remote-caret[data-peer="${id}"] .cm-remote-caret-flag`,
    );
    if (!flag) return false;
    const rect = flag.getBoundingClientRect();
    return (
      pointer.x >= rect.left - CARET_HIT_SLOP_PX &&
      pointer.x <= rect.right + CARET_HIT_SLOP_PX &&
      pointer.y >= rect.top - CARET_HIT_SLOP_PX &&
      pointer.y <= rect.bottom + CARET_HIT_SLOP_PX
    );
  };

  const carets = layer({
    above: true,
    class: "cm-remote-carets",
    update: needsRedraw,
    markers(view) {
      const base = layerBase(view);
      const scrollTop = view.scrollDOM.scrollTop;
      const { doc, selection } = view.state;
      const mode = view.state.facet(remoteCursorMode);
      const crowded = view.state.field(crowdedField);
      const spotlight = view.state.field(spotlightField);
      const following = (awareness?.getLocalState() as Partial<AwarenessState> | null)?.following;
      const pushedByText = textChanged;
      textChanged = false;

      // Asked for at most once a draw, and only when someone's name depends on it.
      let myY: number | null | undefined;
      const mineAt = (): number | null => {
        if (myY === undefined) {
          const coords = view.coordsAtPos(selection.main.head);
          myY = coords ? (coords.top - base.top) / view.scaleY : null;
        }
        return myY;
      };

      const placed: {
        remote: Remote;
        caret: DrawnCaret & { below: boolean };
        wasActive: boolean;
      }[] = [];
      for (const remote of remotesOf(view)) {
        const wasActive = active.delete(remote.awarenessId);
        const coords = view.coordsAtPos(remote.head, remote.head > remote.anchor ? -1 : 1);
        if (!coords) continue;
        const y = Math.round(((coords.top - base.top) / view.scaleY) * 10) / 10;
        placed.push({
          remote,
          wasActive,
          caret: {
            id: remote.awarenessId,
            x: Math.round(((coords.left - base.left) / view.scaleX) * 10) / 10,
            y,
            height: Math.max(14, (coords.bottom - coords.top) / view.scaleY),
            below: flagHangsBelow(y, scrollTop),
          },
        });
      }
      drawn = placed.map((entry) => entry.caret);
      hovered = hoverAt(view, base);

      const markers: KeyedMarker[] = placed.map(({ remote, caret, wasActive }) => {
        const pinned = isPinned(mode, crowded, {
          presenter: remote.presenter,
          followed: remote.clientId === following,
          host: remote.host,
        });
        const spot = hovered === remote.awarenessId || spotlight === remote.clientId;
        // The other person may be far outside the rendered text, and then only lines can tell.
        const flash =
          wasActive &&
          !pinned &&
          !spot &&
          flashesName(
            mode,
            crowded,
            densityOf(mode, crowded) === "crowded"
              ? linesApart(
                  Math.abs(doc.lineAt(remote.head).number - doc.lineAt(selection.main.head).number),
                  caret.y,
                  mineAt(),
                  view.defaultLineHeight,
                )
              : 0,
          );
        const count = (flashes.get(remote.awarenessId) ?? 0) + (flash ? 1 : 0);
        if (flash) flashes.set(remote.awarenessId, count);
        return {
          key: String(remote.awarenessId),
          marker: new CaretMarker(remote.awarenessId, {
            x: caret.x,
            y: caret.y,
            height: caret.height,
            color: remote.color,
            name: remote.name,
            flashes: count,
            flash,
            active: wasActive && !pushedByText,
            pinned,
            spot,
            quiet: mode === "carets",
            below: caret.below,
          }),
        };
      });
      return [new MarkerGroup(markers)];
    },
  });

  // Awareness changes arrive outside CodeMirror's update cycle: poke the layers once per frame.
  const watcher = ViewPlugin.define((view) => {
    let frame = 0;
    let hoverFrame = 0;
    let scrollFrame = 0;
    const refresh = () => view.dispatch({ effects: refreshRemote.of(null) });
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const crowded = view.state.field(crowdedField);
        const next = nextCrowded(crowded, countPeople());
        view.dispatch({
          effects: [refreshRemote.of(null), ...(next === crowded ? [] : [setCrowded.of(next)])],
        });
      });
    };
    // Peers already here have a count to compare with: their first move after I open the file is
    // a move, not a first sighting.
    for (const [id, state] of awareness?.getStates() ?? []) {
      if (id !== awareness?.clientID) lastMoved.set(id, (state as Partial<AwarenessState>).moved);
    }
    const onChange = ({ added, updated, removed }: AwarenessChange) => {
      version++;
      for (const id of removed) {
        lastMoved.delete(id);
        active.delete(id);
        flashes.delete(id);
        if (dismissed === id) dismissed = null;
      }
      for (const id of [...added, ...updated]) {
        if (id === awareness?.clientID) continue;
        const state = awareness?.getStates().get(id) as Partial<AwarenessState> | undefined;
        if (!state) continue;
        if (state.fileId !== fileId) active.delete(id);
        else if (movedChanged(lastMoved.get(id), state.moved)) active.add(id);
        lastMoved.set(id, state.moved);
      }
      schedule();
    };
    const onMouseMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (!drawn.length && hovered === null) return;
        const hit = hoverAt(view, layerBase(view));
        if (hit === hovered) return;
        hovered = hit;
        refresh();
      });
    };
    const onMouseLeave = () => {
      pointer = null;
      dismissed = null;
      if (hovered === null) return;
      hovered = null;
      refresh();
    };
    // Scrolling inside the rendered text redraws nothing, so a caret reaching the top edge is
    // looked for here: one read a frame, from what the last draw stored.
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const scrollTop = view.scrollDOM.scrollTop;
        if (drawn.some((caret) => flagHangsBelow(caret.y, scrollTop) !== caret.below)) refresh();
      });
    };
    // Wherever focus is, seen on the way down and left alone: Vim mode and the search panel use
    // Escape too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || hovered === null) return;
      dismissed = hovered;
      hovered = null;
      refresh();
    };
    awareness?.on("change", onChange);
    view.scrollDOM.addEventListener("mousemove", onMouseMove, { passive: true });
    view.scrollDOM.addEventListener("mouseleave", onMouseLeave, { passive: true });
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
    return {
      update(update) {
        if (update.docChanged) textChanged = true;
      },
      destroy() {
        awareness?.off("change", onChange);
        view.scrollDOM.removeEventListener("mousemove", onMouseMove);
        view.scrollDOM.removeEventListener("mouseleave", onMouseLeave);
        view.scrollDOM.removeEventListener("scroll", onScroll);
        window.removeEventListener("keydown", onKeyDown, { capture: true });
        if (frame) cancelAnimationFrame(frame);
        if (hoverFrame) cancelAnimationFrame(hoverFrame);
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
      },
    };
  });

  return [
    crowdedField.init(() => nextCrowded(false, countPeople())),
    spotlightField,
    EditorView.editorAttributes.compute([remoteCursorMode, crowdedField], (state) => ({
      "data-remote-cursors": densityOf(state.facet(remoteCursorMode), state.field(crowdedField)),
    })),
    selections,
    carets,
    watcher,
    remoteCursorTheme,
  ];
}

const remoteCursorTheme = EditorView.baseTheme({
  ".cm-remote-selections, .cm-remote-carets": { pointerEvents: "none" },
});
