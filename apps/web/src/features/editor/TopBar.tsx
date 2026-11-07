import { MAX_TITLE_LENGTH } from "@gachipad/shared";
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  isImeKey,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@gachipad/ui";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Command as CommandIcon,
  Copy,
  Download,
  Eye,
  FileArchive,
  GitFork,
  History,
  Keyboard,
  MessageSquare,
  MoreHorizontal,
  Presentation,
  Settings,
  Share2,
  UserRound,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Participant, useComments } from "../../lib/collab/hooks";
import { setTitle } from "../../lib/collab/model";
import { useT } from "../../lib/i18n";
import { openPalette, openShortcuts } from "../../lib/overlays";
import { shortcutKeys } from "../../lib/shortcuts";
import { labelColorFor, spotlightRemote } from "./cm/remote-cursors";
import { useDocumentPermissions, useEditor } from "./context";
import { canFormat } from "./format-code";
import { useTransferTarget } from "./transfer";

export interface TopBarActions {
  copyAll: () => void;
  downloadFile: () => void;
  downloadZip: () => void;
  format: () => void;
  toggleSaved: () => void;
  fork: () => void;
}

export function TopBar({ actions }: { actions: TopBarActions }) {
  const t = useT();
  const ctx = useEditor();
  const comments = useComments(ctx.doc);
  const openComments = comments.filter((comment) => !comment.resolved).length;
  const canEdit = !ctx.readOnly;
  const formattable = canEdit && canFormat(ctx.activeFile.language);

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2 py-1.5 sm:gap-2 sm:px-3">
      <Tooltip content={t("editor.top.back")}>
        <Link
          to="/"
          aria-label={t("editor.top.back")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-2 hover:bg-fill-hover hover:text-fg coarse:size-11"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
      </Tooltip>

      <TitleField />

      {ctx.readOnly ? (
        <Badge tone={ctx.state.locked ? "warning" : "neutral"} className="shrink-0 max-sm:hidden">
          <Eye aria-hidden="true" className="size-3" />
          {ctx.state.locked ? t("status.locked") : t("status.readOnly")}
        </Badge>
      ) : null}

      <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
        <People />

        <Tooltip content={t("editor.top.commentsAction")} shortcut={shortcutKeys("comments")}>
          <span className="relative inline-flex">
            <IconButton
              aria-label={t("editor.top.commentsAction")}
              pressed={ctx.panel.name === "comments"}
              onClick={() =>
                ctx.panel.name === "comments" ? ctx.closePanel() : ctx.openPanel("comments")
              }
              data-testid="comments-button"
            >
              <MessageSquare />
            </IconButton>
            {openComments > 0 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-semibold leading-4 text-accent-fg"
              >
                {openComments}
              </span>
            ) : null}
          </span>
        </Tooltip>

        {ctx.isOwner ? (
          <Tooltip content={t("editor.top.historyAction")} shortcut={shortcutKeys("history")}>
            <IconButton
              aria-label={t("editor.top.historyAction")}
              pressed={ctx.panel.name === "history"}
              onClick={() =>
                ctx.panel.name === "history" ? ctx.closePanel() : ctx.openPanel("history")
              }
              className="max-sm:hidden"
              data-testid="history-button"
            >
              <History />
            </IconButton>
          </Tooltip>
        ) : null}

        <Tooltip content={t("editor.top.settingsAction")} shortcut={shortcutKeys("settings")}>
          <IconButton
            aria-label={t("editor.top.settingsAction")}
            onClick={() => ctx.openPanel("settings")}
            className="max-sm:hidden"
            data-testid="settings-button"
          >
            <Settings />
          </IconButton>
        </Tooltip>

        <Button
          variant="primary"
          size="sm"
          leading={<Share2 />}
          onClick={() => ctx.openPanel("share")}
          data-testid="share-button"
          data-tour="share"
        >
          <span className="hidden sm:inline">{t("editor.top.shareAction")}</span>
          <span className="sr-only sm:hidden">{t("editor.top.shareAction")}</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t("editor.top.menu")}
              data-testid="menu-button"
              data-tour="menu"
            >
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              icon={<CommandIcon />}
              shortcut={shortcutKeys("palette")}
              onSelect={openPalette}
            >
              {t("editor.top.commandAction")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Copy />}
              shortcut={shortcutKeys("copyAll")}
              onSelect={actions.copyAll}
            >
              {t("editor.top.copyAllAction")}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Download />} onSelect={actions.downloadFile}>
              {t("editor.download.fileAction")}
            </DropdownMenuItem>
            {ctx.files.length > 1 ? (
              <DropdownMenuItem icon={<FileArchive />} onSelect={actions.downloadZip}>
                {t("editor.download.zipAction")}
              </DropdownMenuItem>
            ) : null}
            {formattable ? (
              <DropdownMenuItem
                icon={<Wand2 />}
                shortcut={shortcutKeys("format")}
                onSelect={actions.format}
              >
                {t("editor.top.formatAction")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={ctx.share.saved ? <BookmarkCheck /> : <Bookmark />}
              onSelect={actions.toggleSaved}
            >
              {ctx.share.saved ? t("editor.top.unsaveAction") : t("editor.top.saveAction")}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<GitFork />} onSelect={actions.fork}>
              {t("editor.top.forkAction")}
            </DropdownMenuItem>
            {ctx.isOwner ? (
              <DropdownMenuItem
                icon={<Presentation />}
                onSelect={() => ctx.setPresenting(!ctx.presenting)}
              >
                {ctx.presenting ? t("editor.present.stopAction") : t("editor.present.action")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Settings />}
              shortcut={shortcutKeys("settings")}
              onSelect={() => ctx.openPanel("settings")}
            >
              {t("editor.top.settingsAction")}
            </DropdownMenuItem>
            {ctx.isOwner ? (
              <DropdownMenuItem
                icon={<History />}
                shortcut={shortcutKeys("history")}
                onSelect={() => ctx.openPanel("history")}
              >
                {t("editor.top.historyAction")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem icon={<UserRound />} onSelect={() => ctx.openPanel("identity")}>
              {t("identity.editAction")}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Keyboard />}
              shortcut={shortcutKeys("shortcuts")}
              onSelect={openShortcuts}
            >
              {t("editor.top.shortcutsAction")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/** The share title: edited in place, committed to the Y.Doc on Enter or blur. */
function TitleField() {
  const t = useT();
  const ctx = useEditor();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? ctx.meta.title;
  const editable = useDocumentPermissions().rename;
  const tooLong = value.length > MAX_TITLE_LENGTH;

  useEffect(() => {
    if (draft !== null && draft === ctx.meta.title) setDraft(null);
  }, [draft, ctx.meta.title]);
  useEffect(() => {
    if (!editable) setDraft(null);
  }, [editable]);

  const commit = () => {
    if (draft === null || !editable) return;
    const next = draft.trim();
    if (next.length <= MAX_TITLE_LENGTH && next !== ctx.meta.title) setTitle(ctx.doc, next);
    setDraft(null);
  };

  if (!editable) {
    return (
      <h1
        className="min-w-0 flex-1 truncate px-2 text-body-sm font-semibold sm:max-w-md sm:flex-none"
        data-testid="title"
        title={t("perm.ownerOnly")}
      >
        {ctx.meta.title || t("editor.top.titlePlaceholder")}
      </h1>
    );
  }
  return (
    <div className="min-w-0 flex-1 sm:max-w-md sm:flex-none sm:basis-80">
      <h1 className="sr-only">{ctx.meta.title || t("editor.top.titlePlaceholder")}</h1>
      <input
        value={value}
        aria-label={t("editor.top.titleLabel")}
        aria-invalid={tooLong || undefined}
        aria-describedby={tooLong ? "title-error" : undefined}
        placeholder={t("editor.top.titlePlaceholder")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (isImeKey(event.nativeEvent)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        data-testid="title"
        className="h-8 w-full truncate rounded-md border border-transparent bg-transparent px-2 text-body-sm font-semibold text-fg placeholder:font-normal placeholder:text-fg-3 hover:border-line focus:border-accent-text focus:bg-bg coarse:h-11 coarse:text-base"
      />
      {tooLong ? (
        <p id="title-error" role="alert" className="sr-only">
          {t("editor.top.titleTooLong", { max: MAX_TITLE_LENGTH })}
        </p>
      ) : null}
    </div>
  );
}

/** Avatars of everyone in the share. Each one takes a dragged file tab to send that file. */
function People() {
  const t = useT();
  const ctx = useEditor();
  const people = ctx.participants;
  const shown = people.slice(0, 4);
  const hidden = people.length - shown.length;
  return (
    <fieldset className="me-1 flex items-center" data-testid="people" data-tour="people">
      <legend className="sr-only">{t("editor.top.participantsLabel")}</legend>
      {shown.map((person, index) => (
        <PersonAvatar key={person.clientId} person={person} overlap={index > 0} />
      ))}
      {hidden > 0 ? (
        <Popover>
          <PopoverTrigger
            aria-label={t("editor.top.moreParticipants", { count: hidden })}
            data-testid="people-more"
            className="-ms-1.5 inline-grid size-6 place-items-center rounded-full bg-fill-active text-caption font-semibold text-fg-2 ring-2 ring-panel hover:bg-fill-hover coarse:size-11"
          >
            +{hidden}
          </PopoverTrigger>
          <PopoverContent align="end">
            <ul className="flex max-h-72 flex-col overflow-y-auto" data-testid="people-more-list">
              {people.slice(shown.length).map((person) => (
                <li key={person.clientId}>
                  <PersonRow person={person} />
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </fieldset>
  );
}

/** Hovering or focusing a person highlights their caret in the file, if it is drawn. */
function useCaretSpotlight(clientId: string) {
  const { viewRef } = useEditor();
  const lit = useRef(false);
  const light = (on: boolean) => {
    lit.current = on;
    spotlightRemote(viewRef.current, on ? clientId : null);
  };
  // A person who leaves takes their row away while it is lit, with no event to end it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the unmount matters
  useEffect(
    () => () => {
      if (lit.current) spotlightRemote(viewRef.current, null);
    },
    [],
  );
  return {
    onMouseEnter: () => light(true),
    onMouseLeave: () => light(false),
    onFocus: () => light(true),
    onBlur: () => light(false),
  };
}

function PersonRow({ person }: { person: Participant }) {
  const t = useT();
  const ctx = useEditor();
  const spotlight = useCaretSpotlight(person.clientId);
  const isFollowed = ctx.following === person.clientId;
  return (
    <button
      type="button"
      aria-pressed={isFollowed}
      aria-label={
        isFollowed
          ? t("editor.top.followStopAction")
          : `${t("editor.top.followAction")}: ${person.name}`
      }
      onClick={() => ctx.setFollowing(isFollowed ? null : person.clientId)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-body-sm hover:bg-fill-hover coarse:min-h-11"
      {...spotlight}
    >
      <Avatar
        name={person.name}
        slot={1}
        size="sm"
        style={{ backgroundColor: person.color, color: labelColorFor(person.color) }}
        className={isFollowed ? "ring-2 ring-accent-text" : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{person.name}</span>
    </button>
  );
}

function PersonAvatar({ person, overlap }: { person: Participant; overlap: boolean }) {
  const t = useT();
  const ctx = useEditor();
  const transfer = useTransferTarget(ctx.session.shareId, person.clientId, person.name);
  const spotlight = useCaretSpotlight(person.clientId);
  const isFollowed = ctx.following === person.clientId;
  const name = person.isSelf ? `${person.name} (${t("common.you")})` : person.name;
  const interactive = !person.isSelf;
  const content = (
    <Avatar
      // Initials come from the name alone: "Kim (you)" would otherwise show "K(".
      name={person.name}
      slot={1}
      size="sm"
      style={{ backgroundColor: person.color, color: labelColorFor(person.color) }}
      className={isFollowed ? "ring-2 ring-accent-text" : undefined}
    />
  );
  return (
    <Tooltip content={isFollowed ? t("editor.top.following", { name: person.name }) : name}>
      {interactive ? (
        <button
          type="button"
          aria-pressed={isFollowed}
          aria-label={
            isFollowed
              ? t("editor.top.followStopAction")
              : `${t("editor.top.followAction")}: ${person.name}`
          }
          onClick={() => ctx.setFollowing(isFollowed ? null : person.clientId)}
          data-drop-over={transfer.over || undefined}
          className={`ui-appear-fade inline-flex rounded-full ring-2 ring-panel ${overlap ? "-ms-1.5" : ""} coarse:p-1`}
          {...transfer.props}
          {...spotlight}
        >
          {content}
        </button>
      ) : (
        <button
          type="button"
          aria-label={`${name}. ${t("identity.editAction")}`}
          onClick={() => ctx.openPanel("identity")}
          className={`inline-flex rounded-full ring-2 ring-panel ${overlap ? "-ms-1.5" : ""} coarse:p-1`}
        >
          {content}
        </button>
      )}
    </Tooltip>
  );
}
