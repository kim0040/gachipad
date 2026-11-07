import { getLanguage, languageForFilename, PLAIN_TEXT_ID } from "@gachipad/highlight";
import { MAX_FILES_PER_SHARE, MAX_PATH_LENGTH } from "@gachipad/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  toast,
} from "@gachipad/ui";
import {
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  Folder,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addFile,
  buildTree,
  deleteFile,
  deleteFolder,
  type FileEntry,
  FileLimitError,
  renameFile,
  renameFolder,
  type TreeNode,
  uniquePath,
} from "../../lib/collab/model";
import { baseName } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { downloadFile } from "./actions";
import { useDocumentPermissions, useEditor } from "./context";
import { setFileDrag } from "./transfer";

/** Keeps the selected tab in view when the strip scrolls. */
function revealTab(element: HTMLElement | null) {
  element?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

type Target = { kind: "file"; file: FileEntry } | { kind: "folder"; path: string };

export interface FileOps {
  add: () => void;
  rename: (target: Target) => void;
  remove: (target: Target) => void;
  dialogs: ReactNode;
}

function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

/** Add, rename and delete for files and folders, with the dialogs they need. */
export function useFileOps(): FileOps {
  const t = useT();
  const ctx = useEditor();
  const canChangeFiles = useDocumentPermissions().files;
  const [naming, setNaming] = useState<{ mode: "add" } | { mode: "rename"; target: Target } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<Target | null>(null);
  useEffect(() => {
    if (!canChangeFiles) {
      setNaming(null);
      setDeleting(null);
    }
  }, [canChangeFiles]);

  const submitName = (name: string) => {
    const path = normalizePath(name);
    if (!path || !canChangeFiles) return;
    if (naming?.mode === "add") {
      try {
        const entry = languageForFilename(baseName(path));
        const id = addFile(ctx.doc, uniquePath(ctx.files, path), entry?.id ?? PLAIN_TEXT_ID);
        ctx.setActiveFileId(id);
      } catch (error) {
        if (error instanceof FileLimitError) {
          toast({ title: t("editor.files.limit", { max: MAX_FILES_PER_SHARE }), tone: "warning" });
        } else throw error;
      }
    } else if (naming?.mode === "rename") {
      const target = naming.target;
      if (target.kind === "file") renameFile(ctx.doc, target.file.id, path);
      else renameFolder(ctx.doc, target.path, path);
    }
    setNaming(null);
  };

  const confirmDelete = () => {
    if (!deleting || !canChangeFiles) return;
    if (deleting.kind === "file") deleteFile(ctx.doc, deleting.file.id);
    else deleteFolder(ctx.doc, deleting.path);
    setDeleting(null);
  };

  const initial =
    naming?.mode === "rename"
      ? naming.target.kind === "file"
        ? naming.target.file.path
        : naming.target.path
      : "";
  const deleteName = deleting
    ? deleting.kind === "file"
      ? deleting.file.path
      : deleting.path
    : "";

  return {
    add: () => setNaming({ mode: "add" }),
    rename: (target) => setNaming({ mode: "rename", target }),
    remove: (target) => setDeleting(target),
    dialogs: (
      <>
        <NameDialog
          open={naming !== null}
          initial={initial}
          title={naming?.mode === "rename" ? t("common.rename") : t("editor.files.newAction")}
          submitLabel={naming?.mode === "rename" ? t("common.rename") : t("common.add")}
          onClose={() => setNaming(null)}
          onSubmit={submitName}
        />
        <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent
            size="sm"
            title={t("editor.files.deleteTitle", { name: deleteName })}
            description={t("editor.files.deleteBody")}
            closeLabel={t("common.close")}
            footer={
              <>
                <Button onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
                <Button variant="danger" onClick={confirmDelete} data-testid="confirm-delete-file">
                  {t("editor.files.deleteAction")}
                </Button>
              </>
            }
          >
            <span className="sr-only">{deleteName}</span>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}

function NameDialog(props: {
  open: boolean;
  initial: string;
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(props.initial);
  useEffect(() => {
    if (props.open) setValue(props.initial);
  }, [props.open, props.initial]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit(value);
  };
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        size="sm"
        title={props.title}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button onClick={props.onClose}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              type="submit"
              form="file-name-form"
              disabled={!normalizePath(value)}
            >
              {props.submitLabel}
            </Button>
          </>
        }
      >
        <form id="file-name-form" onSubmit={submit}>
          <Field label={t("editor.files.nameLabel")}>
            <Input
              autoFocus
              value={value}
              maxLength={MAX_PATH_LENGTH}
              placeholder={t("editor.files.namePlaceholder")}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => {
                const dot = event.currentTarget.value.lastIndexOf(".");
                event.currentTarget.setSelectionRange(
                  0,
                  dot > 0 ? dot : event.currentTarget.value.length,
                );
              }}
              autoCapitalize="off"
              spellCheck={false}
              data-testid="file-name-input"
            />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FileMenu({ file, ops, label }: { file: FileEntry; ops: FileOps; label: string }) {
  const t = useT();
  const ctx = useEditor();
  const canChangeFiles = useDocumentPermissions().files;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={label} size="xs" className="shrink-0">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canChangeFiles ? (
          <DropdownMenuItem icon={<Pencil />} onSelect={() => ops.rename({ kind: "file", file })}>
            {t("common.rename")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem icon={<Download />} onSelect={() => downloadFile(ctx.doc, file)}>
          {t("editor.download.fileAction")}
        </DropdownMenuItem>
        {canChangeFiles && ctx.files.length > 1 ? (
          <DropdownMenuItem
            icon={<Trash2 />}
            destructive
            onSelect={() => ops.remove({ kind: "file", file })}
          >
            {t("editor.files.deleteAction")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Horizontal tab strip of the open share's files. */
export function FileTabs({
  ops,
  onToggleTree,
  treeOpen,
}: {
  ops: FileOps;
  onToggleTree: () => void;
  treeOpen: boolean;
}) {
  const t = useT();
  const ctx = useEditor();
  const canChangeFiles = useDocumentPermissions().files;
  const listRef = useRef<HTMLFieldSetElement>(null);
  const multi = ctx.files.length > 1;

  const onKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    const index = ctx.files.findIndex((file) => file.id === ctx.activeFile.id);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % ctx.files.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + ctx.files.length) % ctx.files.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ctx.files.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const file = ctx.files[next];
    if (!file) return;
    ctx.setActiveFileId(file.id);
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-file="${file.id}"]`)?.focus(),
    );
  };

  return (
    <div className="flex min-h-9 shrink-0 items-center gap-1 border-b border-line bg-panel px-1.5">
      <IconButton
        aria-label={t("editor.files.title")}
        pressed={treeOpen}
        size="sm"
        onClick={onToggleTree}
        data-testid="files-toggle"
      >
        <PanelLeft />
      </IconButton>
      <fieldset
        ref={listRef}
        aria-label={t("editor.files.title")}
        onKeyDown={onKeyDown}
        className="m-0 flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto p-0"
      >
        {ctx.files.map((file) => {
          const selected = file.id === ctx.activeFile.id;
          const language = getLanguage(file.language);
          return (
            <div
              key={file.id}
              className={`group flex shrink-0 items-center rounded-t-md border-x border-t ${
                selected
                  ? "border-line bg-bg text-fg"
                  : "border-transparent text-fg-2 hover:bg-fill-hover"
              }`}
            >
              <button
                type="button"
                data-file={file.id}
                aria-current={selected || undefined}
                title={file.path}
                ref={selected ? revealTab : undefined}
                draggable
                onDragStart={(event) => setFileDrag(event, file.id)}
                onClick={() => ctx.setActiveFileId(file.id)}
                // The strip scrolls sideways, which clips anything drawn outside it: ring inside.
                className="flex h-8 max-w-48 items-center gap-1.5 rounded-t-md ps-2.5 pe-1 text-body-sm focus-visible:-outline-offset-2 coarse:h-10"
                data-testid={`tab-${file.path}`}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: language?.color ?? "var(--fg-3)" }}
                />
                <span className="truncate">{baseName(file.path)}</span>
              </button>
              {multi || canChangeFiles ? (
                <FileMenu file={file} ops={ops} label={`${t("common.more")}: ${file.path}`} />
              ) : null}
            </div>
          );
        })}
      </fieldset>
      {canChangeFiles ? (
        <>
          <IconButton
            aria-label={t("editor.files.newAction")}
            size="sm"
            onClick={ops.add}
            data-testid="add-file"
          >
            <FilePlus2 />
          </IconButton>
          <IconButton
            aria-label={t("editor.files.uploadAction")}
            size="sm"
            onClick={() => ctx.openPanel("upload")}
            data-testid="upload-files"
          >
            <Upload />
          </IconButton>
        </>
      ) : null}
    </div>
  );
}

/** Folder tree of the share's files. */
export function FileTree({ ops }: { ops: FileOps }) {
  const t = useT();
  const ctx = useEditor();
  const canChangeFiles = useDocumentPermissions().files;
  const tree = useMemo(() => buildTree(ctx.files), [ctx.files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const row = (node: TreeNode, depth: number): ReactNode => {
    const pad = { paddingInlineStart: `${depth * 12 + 8}px` };
    if (node.file) {
      const file = node.file;
      const selected = file.id === ctx.activeFile.id;
      const language = getLanguage(file.language);
      return (
        <li key={file.id} className="group flex items-center">
          <button
            type="button"
            style={pad}
            aria-current={selected || undefined}
            title={file.path}
            draggable
            onDragStart={(event) => setFileDrag(event, file.id)}
            onClick={() => ctx.setActiveFileId(file.id)}
            className={`flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md pe-1 text-start text-body-sm coarse:h-10 ${
              selected ? "bg-fill-selected text-fg" : "text-fg-2 hover:bg-fill-hover"
            }`}
          >
            <FileText
              aria-hidden="true"
              className="size-3.5 shrink-0"
              style={{ color: language?.color }}
            />
            <span className="truncate">{node.name}</span>
          </button>
          <FileMenu file={file} ops={ops} label={`${t("common.more")}: ${file.path}`} />
        </li>
      );
    }
    const closed = collapsed.has(node.path);
    return (
      <li key={`dir:${node.path}`}>
        <div className="group flex items-center">
          <button
            type="button"
            style={pad}
            aria-expanded={!closed}
            title={node.path}
            onClick={() => toggle(node.path)}
            className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md pe-1 text-start text-body-sm text-fg-2 hover:bg-fill-hover coarse:h-10"
          >
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 transition-transform ${closed ? "" : "rotate-90"}`}
            />
            <Folder aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{node.name}</span>
          </button>
          {canChangeFiles ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={`${t("common.more")}: ${node.path}`} size="xs">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  icon={<Pencil />}
                  onSelect={() => ops.rename({ kind: "folder", path: node.path })}
                >
                  {t("common.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<Trash2 />}
                  destructive
                  onSelect={() => ops.remove({ kind: "folder", path: node.path })}
                >
                  {t("editor.files.deleteAction")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {closed ? null : <ul>{node.children.map((child) => row(child, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <nav
      aria-label={t("editor.files.title")}
      className="flex h-full min-h-0 flex-col"
      data-testid="file-tree"
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line ps-3 pe-1.5">
        <h2 className="text-label font-medium text-fg-2">{t("editor.files.title")}</h2>
        {canChangeFiles ? (
          <div className="flex items-center">
            <IconButton aria-label={t("editor.files.newAction")} size="sm" onClick={ops.add}>
              <FilePlus2 />
            </IconButton>
            <IconButton
              aria-label={t("editor.files.uploadAction")}
              size="sm"
              onClick={() => ctx.openPanel("upload")}
            >
              <Upload />
            </IconButton>
          </div>
        ) : null}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-gutter:stable]">
        {tree.map((node) => row(node, 0))}
      </ul>
    </nav>
  );
}
