import type { LanguageSupport } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import { DEFAULT_THEME_ID, getEditorTheme, getLanguage, PLAIN_TEXT_ID } from "@gachipad/highlight";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { useAppearance } from "../../lib/appearance";
import { fileText, normalizeLineEndings } from "../../lib/collab/model";
import type { DocSession } from "../../lib/collab/session";
import { useT } from "../../lib/i18n";
import { usePrefs } from "../../lib/prefs";
import type { Store } from "../../lib/store";
import { awarenessBridge } from "./cm/awareness-bridge";
import { commentsExtension } from "./cm/comments-ext";
import { completionExtension } from "./cm/completion";
import "./cm/completion.css";
import {
  baseExtensions,
  EDITOR_HINT_ID,
  editingExtension,
  fontExtension,
  gutterExtension,
  keymapExtension,
  languageExtension,
  plainKeymap,
  readOnlyExtension,
  themeExtension,
} from "./cm/extensions";
import { editorFileDropHandlers, pastedFiles } from "./cm/file-drop";
import { remoteCursors } from "./cm/remote-cursors";
import { searchPhrases } from "./cm/search-phrases";
import { type EditorInfo, setInitialLength } from "./doc-info";
import "./editor.css";

export interface EditorPaneProps {
  session: DocSession;
  fileId: string;
  languageId: string;
  readOnly: boolean;
  viewRef: MutableRefObject<EditorView | null>;
  info: Store<EditorInfo>;
  /** Text just pasted into the editor, and whether the file was empty before. */
  onPaste: (text: string, wasEmpty: boolean) => void;
  /** A local, non-composition text input (not paste or remote Yjs content). */
  onType: () => void;
  onOpenComments: (ids: string[]) => void;
  /** Files pasted from a file manager's clipboard (not dropped: the page takes drops). */
  onPasteFiles: (files: File[]) => void;
  /** What the empty file says: type, paste or drop, depending on what this person can do. */
  emptyHint: string;
}

interface Compartments {
  theme: Compartment;
  font: Compartment;
  editing: Compartment;
  gutters: Compartment;
  language: Compartment;
  keymap: Compartment;
  readOnly: Compartment;
  completion: Compartment;
  hint: Compartment;
}

/** One CodeMirror view bound to a file of the shared document. */
export function EditorPane(props: EditorPaneProps) {
  const { session, fileId, languageId, readOnly, viewRef, info } = props;
  const t = useT();
  const prefs = usePrefs();
  const appearance = useAppearance();
  const themeId = prefs.editorTheme === "auto" ? DEFAULT_THEME_ID[appearance] : prefs.editorTheme;
  const theme = getEditorTheme(themeId);
  const hostRef = useRef<HTMLDivElement>(null);
  const compartments = useRef<Compartments | null>(null);
  const [ready, setReady] = useState(false);
  const [support, setSupport] = useState<LanguageSupport | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const generation = session.getState().generation;

  // The view: rebuilt when the document, its generation (after a resync) or the file changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: preferences are applied by the reconfigure effects below
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ytext = fileText(session.doc, fileId);
    // Before the undo manager exists, so undo never brings the "\r" characters back.
    if (!latest.current.readOnly) normalizeLineEndings(ytext);
    const undoManager = new Y.UndoManager(ytext);
    const parts: Compartments = {
      theme: new Compartment(),
      font: new Compartment(),
      editing: new Compartment(),
      gutters: new Compartment(),
      language: new Compartment(),
      keymap: new Compartment(),
      readOnly: new Compartment(),
      completion: new Compartment(),
      hint: new Compartment(),
    };
    compartments.current = parts;
    const current = latest.current;
    const initialPrefs = prefs;
    let sizeTimer = 0;
    const measureSize = (view: EditorView) => {
      window.clearTimeout(sizeTimer);
      sizeTimer = window.setTimeout(() => {
        const text = view.state.doc.toString();
        info.set((previous) => ({ ...previous, bytes: new TextEncoder().encode(text).length }));
      }, 250);
    };
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          parts.keymap.of(plainKeymap(initialPrefs.keymap)),
          baseExtensions(t("a11y.editor")),
          searchPhrases(t),
          parts.hint.of(placeholder(current.emptyHint)),
          yCollab(ytext, null, { undoManager }),
          parts.theme.of(themeExtension(themeId)),
          parts.font.of(fontExtension(initialPrefs.fontSize)),
          parts.editing.of(editingExtension(initialPrefs)),
          parts.gutters.of(gutterExtension(initialPrefs.lineNumbers)),
          parts.language.of(languageExtension(null)),
          parts.readOnly.of(readOnlyExtension(current.readOnly)),
          parts.completion.of(
            completionExtension(
              current.languageId,
              initialPrefs.codeCompletion,
              current.readOnly,
              theme,
            ),
          ),
          remoteCursors(session, ytext, fileId),
          awarenessBridge(session, fileId),
          commentsExtension({
            session,
            ytext,
            fileId,
            label: t("comment.title"),
            onOpen: (ids) => latest.current.onOpenComments(ids),
          }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const main = update.state.selection.main;
              const line = update.state.doc.lineAt(main.head);
              info.set({
                line: line.number,
                col: main.head - line.from + 1,
                selected: update.state.selection.ranges.reduce(
                  (sum, r) => sum + (r.to - r.from),
                  0,
                ),
                length: update.state.doc.length,
                bytes: info.get().bytes,
              });
            }
            if (update.docChanged) measureSize(update.view);
            if (
              update.docChanged &&
              !update.view.composing &&
              !latest.current.readOnly &&
              update.transactions.some((transaction) => transaction.isUserEvent("input.type"))
            ) {
              latest.current.onType();
            }
          }),
          EditorView.domEventHandlers({
            paste(event, view) {
              const files = pastedFiles(event.clipboardData);
              if (files.length > 0) {
                event.preventDefault();
                latest.current.onPasteFiles(files);
                return true;
              }
              const text = event.clipboardData?.getData("text/plain") ?? "";
              if (text) latest.current.onPaste(text, view.state.doc.length === 0);
              return false;
            },
            ...editorFileDropHandlers(),
          }),
        ],
      }),
    });
    viewRef.current = view;
    setInitialLength(info, view.state.doc.length);
    measureSize(view);
    setReady(true);
    return () => {
      window.clearTimeout(sizeTimer);
      viewRef.current = null;
      compartments.current = null;
      view.destroy();
      undoManager.destroy();
      setReady(false);
    };
  }, [session, generation, fileId]);

  // Live preference changes.
  useEffect(() => {
    const view = viewRef.current;
    const parts = compartments.current;
    if (!ready || !view || !parts) return;
    view.dispatch({
      effects: [
        parts.theme.reconfigure(themeExtension(themeId)),
        parts.font.reconfigure(fontExtension(prefs.fontSize)),
        parts.editing.reconfigure(editingExtension(prefs)),
        parts.gutters.reconfigure(gutterExtension(prefs.lineNumbers)),
      ],
    });
  }, [ready, themeId, prefs, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    const parts = compartments.current;
    if (!ready || !view || !parts) return;
    view.dispatch({
      effects: parts.completion.reconfigure(
        completionExtension(languageId, prefs.codeCompletion, readOnly, theme),
      ),
    });
  }, [ready, languageId, prefs.codeCompletion, readOnly, theme, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    const parts = compartments.current;
    if (!ready || !view || !parts) return;
    view.dispatch({ effects: parts.readOnly.reconfigure(readOnlyExtension(readOnly)) });
  }, [ready, readOnly, viewRef]);

  const { emptyHint } = props;
  useEffect(() => {
    const view = viewRef.current;
    const parts = compartments.current;
    if (!ready || !view || !parts) return;
    view.dispatch({ effects: parts.hint.reconfigure(placeholder(emptyHint)) });
  }, [ready, emptyHint, viewRef]);

  // Key bindings: vim and emacs load their own chunk.
  useEffect(() => {
    const view = viewRef.current;
    const parts = compartments.current;
    if (!ready || !view || !parts) return;
    let cancelled = false;
    void keymapExtension(prefs.keymap).then((extension) => {
      if (cancelled || viewRef.current !== view) return;
      view.dispatch({ effects: parts.keymap.reconfigure(extension) });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, prefs.keymap, viewRef]);

  // The grammar of the file's language, loaded when first needed.
  useEffect(() => {
    let cancelled = false;
    setSupport(null);
    const entry = languageId && languageId !== PLAIN_TEXT_ID ? getLanguage(languageId) : undefined;
    if (!entry || entry.engine === "none") return;
    entry
      .load()
      .then((loaded) => {
        if (!cancelled) setSupport(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [languageId]);

  useEffect(() => {
    const view = viewRef.current;
    const parts = compartments.current;
    if (!ready || !view || !parts) return;
    view.dispatch({ effects: parts.language.reconfigure(languageExtension(support)) });
  }, [ready, support, viewRef]);

  return (
    <>
      <p id={EDITOR_HINT_ID} className="sr-only">
        {t("a11y.editorHint")}
      </p>
      <div
        ref={hostRef}
        data-testid="editor"
        data-readonly={readOnly || undefined}
        className="cm-host"
        style={{ backgroundColor: theme.background }}
      />
    </>
  );
}
