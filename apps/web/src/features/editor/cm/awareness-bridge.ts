import type { Transaction } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { ySyncAnnotation, ySyncFacet } from "y-codemirror.next";
import * as Y from "yjs";
import type { DocSession } from "../../../lib/collab/session";

/** Publishes my file, cursor and viewport (docs/ARCHITECTURE.md §4); `session.publish` throttles. */

export function visibleLines(view: EditorView): { fromLine: number; toLine: number } {
  const top = view.scrollDOM.scrollTop;
  const first = view.lineBlockAtHeight(top);
  const last = view.lineBlockAtHeight(top + view.scrollDOM.clientHeight);
  return {
    fromLine: view.state.doc.lineAt(first.from).number,
    toLine: view.state.doc.lineAt(Math.min(last.from, view.state.doc.length)).number,
  };
}

/**
 * Whether I moved the selection or edited. Text that came through Yjs carries `ySyncAnnotation`:
 * a remote edit, and also my own undo or redo, whose restored selection then follows as a plain
 * dispatch of its own and counts through that. Comparing relative positions cannot tell: they
 * anchor to the character after the cursor, so typing can leave them unchanged.
 */
export function isLocalActivity(transactions: readonly Transaction[]): boolean {
  return transactions.some(
    (tr) => (tr.docChanged || tr.selection !== undefined) && !tr.annotation(ySyncAnnotation),
  );
}

/** Per session, not per view: reopening a file must not look to the others like a new move. */
const movedCounts = new WeakMap<DocSession, number>();

export function awarenessBridge(session: DocSession, fileId: string) {
  return ViewPlugin.fromClass(
    class {
      private readonly onScroll: () => void;
      private sentCursor = "";
      private sentViewport = "";

      constructor(private readonly view: EditorView) {
        session.publish({ fileId, moved: movedCounts.get(session) ?? 0 });
        this.sendCursor(false);
        this.sendViewport();
        this.onScroll = () => this.sendViewport();
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      }

      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged) {
          this.sendCursor(isLocalActivity(update.transactions));
        }
        if (update.geometryChanged || update.viewportChanged) this.sendViewport();
      }

      /**
       * A remote edit may still correct my position (text inserted exactly at my caret), but
       * says nothing new when the position is the same: a class would otherwise answer every
       * keystroke with every client's cursor.
       */
      sendCursor(active: boolean) {
        const config = this.view.state.facet(ySyncFacet);
        const main = this.view.state.selection.main;
        const cursor = {
          anchor: Y.relativePositionToJSON(config.toYPos(main.anchor, main.assoc)),
          head: Y.relativePositionToJSON(config.toYPos(main.head, main.assoc)),
        };
        const sent = JSON.stringify(cursor);
        if (!active && sent === this.sentCursor) return;
        this.sentCursor = sent;
        if (!active) {
          session.publish({ cursor });
          return;
        }
        const moved = (movedCounts.get(session) ?? 0) + 1;
        movedCounts.set(session, moved);
        session.publish({ cursor, moved });
      }

      /** Layout may only be read in a measure phase, never inside an update. */
      sendViewport() {
        this.view.requestMeasure({
          key: this,
          read: () => visibleLines(this.view),
          write: (viewport) => {
            const sent = `${viewport.fromLine}:${viewport.toLine}`;
            if (sent === this.sentViewport) return;
            this.sentViewport = sent;
            session.publish({ viewport });
          },
        });
      }

      destroy() {
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        session.publish({ cursor: undefined, viewport: undefined });
      }
    },
  );
}
