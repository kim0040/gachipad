import type { EditorView } from "@codemirror/view";
import {
  detectLanguage,
  getLanguage,
  type LanguageEntry,
  languageForFilename,
  PLAIN_TEXT_ID,
} from "@gachipad/highlight";
import { Button, EmptyState, Sheet, SheetContent, toast } from "@gachipad/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bookmark,
  Copy,
  Download,
  FileArchive,
  GitFork,
  Hash,
  History,
  Keyboard,
  MessageSquare,
  Presentation,
  Replace,
  Search,
  Settings,
  Share2,
  TextSelect,
  Upload,
  UserRound,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useIsNarrow } from "../../lib/appearance";
import { setFileLanguage } from "../../lib/collab/model";
import { type Command, registerCommands } from "../../lib/commands";
import { useT } from "../../lib/i18n";
import { openShortcuts } from "../../lib/overlays";
import { getPrefs } from "../../lib/prefs";
import { shortcutKeys } from "../../lib/shortcuts";
import { useStore } from "../../lib/store";
import { useWindowShortcuts } from "../../lib/use-shortcuts";
import { FileDropOverlay } from "../app/FileDropOverlay";
import { useFileDrop } from "../app/file-drop";
import { DropTip } from "../tour/DropTip";
import { TourMount } from "../tour/TourMount";
import { copyAll, downloadFile, downloadZip, looksLikeSecret } from "./actions";
import { EditorBanners } from "./banners";
import { CommentsPanel } from "./CommentsPanel";
import { pastedFiles, pasteIsForPage } from "./cm/file-drop";
import { editorCommands } from "./cm/keymaps";
import { useDocumentPermissions, useEditor } from "./context";
import { showAloneHint } from "./doc-info";
import { useFilesDenial } from "./drop-permissions";
import { collectDrop } from "./dropped-files";
import { EditorPane } from "./EditorPane";
import { useEmptyHint } from "./empty-hint";
import { FileTabs, FileTree, useFileOps } from "./Files";
import { canFormat, formatCode, minimalChange } from "./format-code";
import { HistoryView } from "./HistoryView";
import { IdentityDialog } from "./IdentityDialog";
import { SettingsSheet } from "./SettingsSheet";
import { ShareDialog } from "./ShareDialog";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { UploadDialog, useImport } from "./UploadDialog";
import type { FollowResult } from "./use-follow";

/** Shown over an empty share nobody else has joined yet. */
function AloneHint() {
  const t = useT();
  const ctx = useEditor();
  const length = useStore(ctx.info).length;
  if (!showAloneHint({ participants: ctx.participants.length, length, readOnly: ctx.readOnly }))
    return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div className="ui-appear pointer-events-auto max-w-sm rounded-xl border border-line bg-panel p-3 shadow-2">
        <EmptyState
          size="sm"
          title={t("empty.alone.title")}
          description={t("empty.alone.body")}
          action={
            <Button
              size="sm"
              variant="primary"
              leading={<Share2 />}
              onClick={() => ctx.openPanel("share")}
            >
              {t("editor.top.shareAction")}
            </Button>
          }
        />
      </div>
    </div>
  );
}

function hasRecognizedCodeLanguage(path: string): boolean {
  const entry = languageForFilename(path);
  return Boolean(entry && entry.id !== PLAIN_TEXT_ID);
}

export function EditorShell({ follow }: { follow: FollowResult }) {
  const t = useT();
  const ctx = useEditor();
  const canImport = useDocumentPermissions().files;
  const canChangeLanguage = useDocumentPermissions().language;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const narrow = useIsNarrow();
  const ops = useFileOps();
  const importDropped = useImport();
  const [treeOpen, setTreeOpen] = useState(ctx.files.length > 1);
  const [secretWarning, setSecretWarning] = useState(false);
  const [languageSuggestion, setLanguageSuggestion] = useState<{
    fileId: string;
    language: LanguageEntry;
  } | null>(null);
  const detectionTimer = useRef<number | null>(null);
  const suggestedFiles = useRef(new Set<string>());
  const language = ctx.activeFile.language;
  const { viewRef } = ctx;

  const lastLanguage = useRef({
    fileId: ctx.activeFile.id,
    language,
    path: ctx.activeFile.path,
  });
  useEffect(() => {
    if (detectionTimer.current !== null) window.clearTimeout(detectionTimer.current);
    detectionTimer.current = null;
    const previous = lastLanguage.current;
    if (previous.fileId === ctx.activeFile.id && previous.language !== language) {
      suggestedFiles.current.delete(ctx.activeFile.id);
    }
    if (
      previous.fileId !== ctx.activeFile.id ||
      previous.language !== language ||
      previous.path !== ctx.activeFile.path
    ) {
      setLanguageSuggestion(null);
    }
    lastLanguage.current = {
      fileId: ctx.activeFile.id,
      language,
      path: ctx.activeFile.path,
    };
  }, [ctx.activeFile.id, ctx.activeFile.path, language]);

  useEffect(
    () => () => {
      if (detectionTimer.current !== null) window.clearTimeout(detectionTimer.current);
    },
    [],
  );

  // ── actions ──────────────────────────────────────────────────────
  const actions = useRef({
    copyAll: async () => {},
    downloadFile: () => {},
    downloadZip: () => {},
    format: async () => {},
    toggleSaved: async () => {},
    fork: async () => {},
  });

  actions.current = {
    copyAll: async () => {
      const ok = await copyAll(ctx.doc, ctx.activeFile);
      toast({
        title: ok ? t("toast.allCopied") : t("toast.copyFailed"),
        tone: ok ? "success" : "danger",
        duration: 2500,
      });
    },
    downloadFile: () => {
      downloadFile(ctx.doc, ctx.activeFile);
      toast({ title: t("toast.downloadStarted"), tone: "neutral", duration: 2000 });
    },
    downloadZip: () => {
      downloadZip(ctx.doc, ctx.files, ctx.meta.title);
      toast({ title: t("toast.downloadStarted"), tone: "neutral", duration: 2000 });
    },
    format: async () => {
      const view = ctx.viewRef.current;
      if (!view || ctx.readOnly || !canFormat(language)) return;
      const before = view.state.doc.toString();
      const prefs = getPrefs();
      try {
        const after = await formatCode(before, language, {
          tabWidth: prefs.tabSize,
          useTabs: prefs.indentWithTabs,
        });
        if (view.state.doc.toString() !== before) return;
        const change = minimalChange(before, after);
        if (change) view.dispatch({ changes: change });
        toast({ title: t("toast.formatted"), tone: "success", duration: 2000 });
      } catch {
        toast({ title: t("toast.formatFailed"), tone: "danger" });
      }
    },
    toggleSaved: async () => {
      const next = !ctx.share.saved;
      try {
        if (next) await api.saveShare(ctx.share.id);
        else await api.unsaveShare(ctx.share.id);
        const share = await api.getShare(ctx.share.id);
        queryClient.setQueryData(["share", ctx.share.id], share);
        void queryClient.invalidateQueries({ queryKey: ["shares"] });
        toast({
          title: next ? t("toast.saved") : t("toast.unsaved"),
          tone: "success",
          duration: 2500,
        });
      } catch {
        toast({ title: t("error.generic"), tone: "danger" });
      }
    },
    fork: async () => {
      try {
        const copy = await api.forkShare(ctx.share.id);
        toast({ title: t("toast.forked"), tone: "success", duration: 2500 });
        void queryClient.invalidateQueries({ queryKey: ["shares"] });
        void navigate({ to: "/$id", params: { id: copy.id } });
      } catch {
        toast({ title: t("error.generic"), tone: "danger" });
      }
    },
  };

  const topActions = {
    copyAll: () => void actions.current.copyAll(),
    downloadFile: () => actions.current.downloadFile(),
    downloadZip: () => actions.current.downloadZip(),
    format: () => void actions.current.format(),
    toggleSaved: () => void actions.current.toggleSaved(),
    fork: () => void actions.current.fork(),
  };

  const topActionsRef = useRef(topActions);
  topActionsRef.current = topActions;

  // ── keyboard shortcuts ───────────────────────────────────────────
  useWindowShortcuts(["share", "settings", "history", "comments", "copyAll", "format"], (id) => {
    switch (id) {
      case "share":
        ctx.openPanel("share");
        return true;
      case "settings":
        ctx.openPanel("settings");
        return true;
      case "history":
        // Only the owner has a history: for everyone else the key keeps its browser meaning.
        if (!ctx.isOwner) return false;
        ctx.openPanel("history");
        return true;
      case "comments":
        ctx.openPanel("comments");
        return true;
      case "copyAll":
        topActionsRef.current.copyAll();
        return true;
      case "format":
        topActionsRef.current.format();
        return true;
    }
  });

  // ── command palette entries ──────────────────────────────────────
  useEffect(() => {
    const group = t("editor.top.menu");
    // The palette is also how Linux desktops that keep Ctrl+Alt+↑/↓ (workspace switching) reach
    // the multi-cursor commands. Focus goes back to the editor first, then the command runs.
    const inEditor = (command: (view: EditorView) => boolean) => () => {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      command(view);
    };
    const commands: Command[] = [
      {
        id: "share",
        label: t("editor.top.shareAction"),
        group,
        icon: <Share2 />,
        shortcut: shortcutKeys("share"),
        run: () => ctx.openPanel("share"),
      },
      {
        id: "settings",
        label: t("editor.top.settingsAction"),
        group,
        icon: <Settings />,
        shortcut: shortcutKeys("settings"),
        run: () => ctx.openPanel("settings"),
      },
      {
        id: "comments",
        label: t("editor.top.commentsAction"),
        group,
        icon: <MessageSquare />,
        shortcut: shortcutKeys("comments"),
        run: () => ctx.openPanel("comments"),
      },
      {
        id: "history",
        label: t("editor.top.historyAction"),
        group,
        icon: <History />,
        disabled: !ctx.isOwner,
        shortcut: shortcutKeys("history"),
        run: () => ctx.openPanel("history"),
      },
      {
        id: "copy-all",
        label: t("editor.top.copyAllAction"),
        group,
        icon: <Copy />,
        shortcut: shortcutKeys("copyAll"),
        run: () => topActionsRef.current.copyAll(),
      },
      {
        id: "download",
        label: t("editor.download.fileAction"),
        group,
        icon: <Download />,
        run: () => topActionsRef.current.downloadFile(),
      },
      {
        id: "zip",
        label: t("editor.download.zipAction"),
        group,
        icon: <FileArchive />,
        disabled: ctx.files.length < 2,
        run: () => topActionsRef.current.downloadZip(),
      },
      {
        id: "format",
        label: t("editor.top.formatAction"),
        group,
        icon: <Wand2 />,
        disabled: ctx.readOnly || !canFormat(language),
        shortcut: shortcutKeys("format"),
        run: () => topActionsRef.current.format(),
      },
      {
        id: "find",
        label: t("shortcuts.item.find"),
        group,
        icon: <Search />,
        shortcut: shortcutKeys("find"),
        run: inEditor(editorCommands.find),
      },
      {
        id: "replace",
        label: t("shortcuts.item.replace"),
        group,
        icon: <Replace />,
        disabled: ctx.readOnly,
        shortcut: shortcutKeys("replace"),
        run: inEditor(editorCommands.replace),
      },
      {
        id: "go-to-line",
        label: t("shortcuts.item.goToLine"),
        group,
        icon: <Hash />,
        shortcut: shortcutKeys("goToLine"),
        run: inEditor(editorCommands.goToLine),
      },
      {
        id: "add-cursor-above",
        label: t("shortcuts.item.addCursorAbove"),
        group,
        icon: <ArrowUpToLine />,
        disabled: ctx.readOnly,
        shortcut: shortcutKeys("addCursorAbove"),
        run: inEditor(editorCommands.addCursorAbove),
      },
      {
        id: "add-cursor-below",
        label: t("shortcuts.item.addCursorBelow"),
        group,
        icon: <ArrowDownToLine />,
        disabled: ctx.readOnly,
        shortcut: shortcutKeys("addCursorBelow"),
        run: inEditor(editorCommands.addCursorBelow),
      },
      {
        id: "select-matches",
        label: t("shortcuts.item.selectMatches"),
        group,
        icon: <TextSelect />,
        shortcut: shortcutKeys("selectMatches"),
        run: inEditor(editorCommands.selectMatches),
      },
      {
        id: "save",
        label: ctx.share.saved ? t("editor.top.unsaveAction") : t("editor.top.saveAction"),
        group,
        icon: <Bookmark />,
        run: () => topActionsRef.current.toggleSaved(),
      },
      {
        id: "fork",
        label: t("editor.top.forkAction"),
        group,
        icon: <GitFork />,
        run: () => topActionsRef.current.fork(),
      },
      {
        id: "upload",
        label: t("upload.title"),
        group,
        icon: <Upload />,
        disabled: !canImport,
        run: () => ctx.openPanel("upload"),
      },
      {
        id: "identity",
        label: t("identity.editAction"),
        group,
        icon: <UserRound />,
        run: () => ctx.openPanel("identity"),
      },
      {
        id: "present",
        label: ctx.presenting ? t("editor.present.stopAction") : t("editor.present.action"),
        group,
        icon: <Presentation />,
        disabled: !ctx.isOwner,
        run: () => ctx.setPresenting(!ctx.presenting),
      },
      {
        id: "shortcuts",
        label: t("editor.top.shortcutsAction"),
        group,
        icon: <Keyboard />,
        shortcut: shortcutKeys("shortcuts"),
        run: openShortcuts,
      },
    ];
    return registerCommands("editor", commands);
  }, [
    t,
    canImport,
    ctx.isOwner,
    ctx.readOnly,
    ctx.presenting,
    ctx.share.saved,
    ctx.files.length,
    language,
    ctx.openPanel,
    ctx.setPresenting,
    viewRef,
  ]);

  // ── paste: detect the language of an empty file, warn about secrets ─
  const onPaste = useCallback(
    (text: string, wasEmpty: boolean) => {
      if (looksLikeSecret(text)) setSecretWarning(true);
      if (!canChangeLanguage || !wasEmpty || (language && language !== PLAIN_TEXT_ID)) return;
      const result = detectLanguage({ filename: ctx.activeFile.path, content: text });
      if (result.language && result.confidence >= 0.5) {
        setFileLanguage(ctx.doc, ctx.activeFile.id, result.language.id);
        toast({
          title: t("status.language.changed", {
            language: getLanguage(result.language.id)?.name ?? "",
          }),
          tone: "neutral",
          duration: 2500,
        });
      }
    },
    [canChangeLanguage, ctx.activeFile.id, ctx.activeFile.path, ctx.doc, language, t],
  );

  const onType = useCallback(() => {
    const fileId = ctx.activeFile.id;
    const path = ctx.activeFile.path;
    if (
      ctx.readOnly ||
      language !== PLAIN_TEXT_ID ||
      hasRecognizedCodeLanguage(path) ||
      suggestedFiles.current.has(fileId)
    ) {
      return;
    }
    if (detectionTimer.current !== null) window.clearTimeout(detectionTimer.current);
    detectionTimer.current = window.setTimeout(() => {
      detectionTimer.current = null;
      const view = viewRef.current;
      if (
        !view ||
        ctx.readOnly ||
        ctx.activeFile.id !== fileId ||
        ctx.activeFile.language !== PLAIN_TEXT_ID ||
        hasRecognizedCodeLanguage(ctx.activeFile.path)
      ) {
        return;
      }
      const result = detectLanguage({ content: view.state.doc.toString() });
      if (!result.language || result.confidence < 0.7) return;
      suggestedFiles.current.add(fileId);
      setLanguageSuggestion({ fileId, language: result.language });
    }, 1000);
  }, [
    ctx.activeFile.id,
    ctx.activeFile.language,
    ctx.activeFile.path,
    ctx.readOnly,
    language,
    viewRef,
  ]);

  const useLanguageSuggestion = useCallback(() => {
    if (!languageSuggestion || languageSuggestion.fileId !== ctx.activeFile.id || ctx.readOnly)
      return;
    setFileLanguage(ctx.doc, languageSuggestion.fileId, languageSuggestion.language.id);
    setLanguageSuggestion(null);
  }, [ctx.activeFile.id, ctx.doc, ctx.readOnly, languageSuggestion]);

  const dismissLanguageSuggestion = useCallback(() => setLanguageSuggestion(null), []);

  // Files dropped anywhere on the page (and pasted from a file manager) go through one importer.
  const importRef = useRef(importDropped);
  importRef.current = importDropped;
  const denial = useFilesDenial();
  const dropOverlay = useFileDrop({
    mode: "add",
    denied: denial,
    // Read the transfer now, in the event: the browser empties it afterwards.
    onDrop: (transfer) => void collectDrop(transfer).then((dropped) => importRef.current(dropped)),
  });
  const onPasteFiles = useCallback((files: File[]) => void importRef.current(files), []);
  // Focus can be anywhere when files are pasted: on a tab, on a button, or on nothing at all.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !pasteIsForPage(event.target)) return;
      const files = pastedFiles(event.clipboardData);
      // A screenshot pasted while focus is outside the editor was never meant to be a file here.
      if (files.length === 0 || files.every((file) => file.type.startsWith("image/"))) return;
      event.preventDefault();
      void importRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  const emptyHint = useEmptyHint({ readOnly: ctx.readOnly, canImport });

  const tree = <FileTree ops={ops} />;
  const showSidebar = treeOpen && !narrow;

  return (
    <div className="screen-fill flex flex-col bg-bg text-fg">
      <TopBar actions={topActions} />
      <EditorBanners
        secretWarning={secretWarning}
        onKeepSecret={() => setSecretWarning(false)}
        onStopFollow={follow.stop}
      />

      <main id="main" className="flex min-h-0 flex-1">
        {showSidebar ? (
          <aside className="hidden w-56 shrink-0 border-e border-line bg-panel md:block">
            {tree}
          </aside>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {ctx.panel.name === "history" && ctx.isOwner ? (
            <HistoryView />
          ) : (
            <>
              <div className="shrink-0" data-tour="files">
                <FileTabs
                  ops={ops}
                  treeOpen={treeOpen || (narrow && ctx.panel.name === "files")}
                  onToggleTree={() =>
                    narrow ? ctx.openPanel("files") : setTreeOpen((open) => !open)
                  }
                />
              </div>
              <div className="relative min-h-0 flex-1">
                <EditorPane
                  key={`${ctx.activeFile.id}`}
                  session={ctx.session}
                  fileId={ctx.activeFile.id}
                  languageId={language}
                  readOnly={ctx.readOnly}
                  viewRef={ctx.viewRef}
                  info={ctx.info}
                  onPaste={onPaste}
                  onType={onType}
                  onOpenComments={(ids) => ctx.openPanel("comments", ids[0])}
                  onPasteFiles={onPasteFiles}
                  emptyHint={emptyHint}
                />
                <AloneHint />
                <DropTip />
              </div>
            </>
          )}
        </div>
      </main>

      <StatusBar
        suggestedLanguage={
          languageSuggestion?.fileId === ctx.activeFile.id ? languageSuggestion.language : null
        }
        onUseSuggestion={useLanguageSuggestion}
        onDismissSuggestion={dismissLanguageSuggestion}
      />

      <FileDropOverlay view={dropOverlay} />
      {ops.dialogs}
      <ShareDialog />
      <SettingsSheet />
      <CommentsPanel />
      <UploadDialog />
      <IdentityDialog />
      <TourMount />
      <Sheet
        open={narrow && ctx.panel.name === "files"}
        onOpenChange={(open) => !open && ctx.closePanel()}
      >
        <SheetContent
          side="left"
          title={t("editor.files.title")}
          hideTitle
          closeLabel={t("common.close")}
        >
          {tree}
        </SheetContent>
      </Sheet>
    </div>
  );
}
