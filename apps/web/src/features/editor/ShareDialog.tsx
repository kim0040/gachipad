import { formatDuration } from "@gachipad/i18n";
import {
  MAX_NOTE_LENGTH,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  type PatchShareBody,
} from "@gachipad/shared";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  IconButton,
  Input,
  isImeKey,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@gachipad/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Expand, Radio, Send, UserMinus, Users, X } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { removeAwarenessStates } from "y-protocols/awareness";
import { api } from "../../lib/api";
import { usePresence } from "../../lib/events";
import { copyText, groupCode, shareUrl } from "../../lib/format";
import {
  exitFullscreen,
  FULLSCREEN_CHANGE_EVENTS,
  fullscreenElement,
  requestFullscreen,
} from "../../lib/fullscreen";
import { useLocale, useT } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { labelColorFor } from "./cm/remote-cursors";
import { useEditor } from "./context";
import { useTransferTarget } from "./transfer";

type Tab = "join" | "send" | "access";

export function ShareDialog() {
  const t = useT();
  const ctx = useEditor();
  const open = ctx.panel.name === "share";
  const tab = (ctx.panel.arg as Tab | undefined) ?? "join";
  const [current, setCurrent] = useState<Tab>(tab);
  const [projector, setProjector] = useState(false);
  const exitProjector = useCallback(() => setProjector(false), []);

  useEffect(() => {
    if (open) setCurrent(tab);
  }, [open, tab]);

  return (
    <>
      <Dialog open={open && !projector} onOpenChange={(next) => !next && ctx.closePanel()}>
        <DialogContent
          size="lg"
          title={t("share.dialog.title")}
          description={t("share.dialog.description")}
          closeLabel={t("common.close")}
          data-file-drop-modal=""
        >
          <Tabs value={current} onValueChange={(value) => setCurrent(value as Tab)}>
            <TabsList aria-label={t("share.dialog.title")}>
              <TabsTrigger value="join">{t("share.dialog.tab.join")}</TabsTrigger>
              <TabsTrigger value="send">{t("share.dialog.tab.send")}</TabsTrigger>
              {ctx.isOwner ? (
                <TabsTrigger value="access">{t("share.dialog.tab.access")}</TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="join" className="pt-4">
              <JoinTab onProjector={() => setProjector(true)} />
            </TabsContent>
            <TabsContent value="send" className="pt-4">
              <SendTab />
            </TabsContent>
            {ctx.isOwner ? (
              <TabsContent value="access" className="pt-4">
                <AccessTab />
              </TabsContent>
            ) : null}
          </Tabs>
        </DialogContent>
      </Dialog>
      {open && projector ? <Projector onExit={exitProjector} /> : null}
    </>
  );
}

/**
 * The join QR as vector art: every module stays a sharp square at 125 % or 150 % display scaling
 * and on a projector, where a bitmap scaled by a fraction blurs and gets harder to scan.
 */
function useQr(url: string, size: number): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: size,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((svg) => {
        if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);
  return src;
}

function CopyButton({
  text,
  label,
  doneLabel,
  testId,
}: {
  text: string;
  label: string;
  doneLabel: string;
  testId?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button
      size="sm"
      leading={done ? <Check /> : <Copy />}
      data-testid={testId}
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1800);
        }
      }}
    >
      <span aria-live="polite">{done ? doneLabel : label}</span>
    </Button>
  );
}

function JoinTab({ onProjector }: { onProjector: () => void }) {
  const t = useT();
  const ctx = useEditor();
  const code = ctx.share.joinCode;
  const access = ctx.share.access;
  const [useEditLink, setUseEditLink] = useState(false);
  const showBoth = ctx.isOwner && access?.default === "view" && Boolean(access.editKey);
  const url = shareUrl(ctx.share.id, showBoth && useEditLink ? access?.editKey : undefined);
  const qr = useQr(url, 320);

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-label font-medium text-fg-2">{t("share.dialog.code.label")}</span>
          <div className="flex flex-wrap items-center gap-3">
            <output
              data-testid="join-code"
              aria-label={`${t("share.dialog.code.label")}: ${code.split("").join(" ")}`}
              className="font-mono text-[2.25rem] font-semibold leading-none tracking-[0.12em] tabular"
            >
              {groupCode(code)}
            </output>
            <CopyButton
              text={code}
              label={t("share.dialog.code.copyAction")}
              doneLabel={t("common.copied")}
              testId="copy-code"
            />
          </div>
          <p className="text-caption text-fg-3">
            {t("share.dialog.code.hint", { address: window.location.host })}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          {showBoth ? (
            <fieldset className="flex gap-1">
              <legend className="sr-only">{t("share.dialog.link.label")}</legend>
              <Button
                size="sm"
                variant={useEditLink ? "ghost" : "soft"}
                onClick={() => setUseEditLink(false)}
              >
                {t("share.dialog.access.viewLink")}
              </Button>
              <Button
                size="sm"
                variant={useEditLink ? "soft" : "ghost"}
                onClick={() => setUseEditLink(true)}
              >
                {t("share.dialog.access.editLink")}
              </Button>
            </fieldset>
          ) : (
            <span className="text-label font-medium text-fg-2">{t("share.dialog.link.label")}</span>
          )}
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              aria-label={t("share.dialog.link.label")}
              onFocus={(event) => event.currentTarget.select()}
              className="h-8 min-w-0 flex-1 rounded-md border border-line-control bg-panel px-2 font-mono text-caption text-fg-2 coarse:h-11"
              data-testid="share-link"
            />
            <CopyButton
              text={url}
              label={t("share.dialog.link.copyAction")}
              doneLabel={t("common.copied")}
              testId="copy-link"
            />
          </div>
        </div>

        <Button
          leading={<Expand />}
          onClick={onProjector}
          data-testid="projector-button"
          className="self-start"
        >
          {t("share.dialog.projector.action")}
        </Button>
        <p className="-mt-2 text-caption text-fg-3">{t("share.dialog.projector.hint")}</p>
      </div>

      <figure className="mx-auto flex shrink-0 flex-col items-center gap-1.5 sm:mx-0">
        <div className="grid size-40 place-items-center overflow-hidden rounded-lg bg-white p-1.5">
          {qr ? (
            <img
              src={qr}
              alt={t("share.dialog.qr.alt")}
              width={148}
              height={148}
              data-testid="qr"
            />
          ) : (
            <Spinner label={t("a11y.loading")} />
          )}
        </div>
        <figcaption className="text-caption text-fg-3">{t("share.dialog.qr.hint")}</figcaption>
      </figure>
    </div>
  );
}

/** Large code and QR for a classroom screen; fullscreen when the browser allows it. */
function Projector({ onExit }: { onExit: () => void }) {
  const t = useT();
  const ctx = useEditor();
  const root = useRef<HTMLDivElement>(null);
  const requested = useRef(false);
  const active = useRef(false);
  const url = shareUrl(ctx.share.id);
  const qr = useQr(url, 720);

  useEffect(() => {
    const element = root.current;
    active.current = true;
    element?.focus();
    // One request per opening, including React StrictMode's setup/cleanup/setup replay.
    if (element && !requested.current) {
      requested.current = true;
      void requestFullscreen(element).then((entered) => {
        if (entered && !active.current && fullscreenElement() === element) void exitFullscreen();
      });
    }
    // Esc leaves element fullscreen on its own (browsers do not pass that key to the page there),
    // and ⌘⌃F or F11 only changes the window, which the overlay already fills.
    const onChange = () => {
      if (!fullscreenElement()) onExit();
    };
    for (const name of FULLSCREEN_CHANGE_EVENTS) document.addEventListener(name, onChange);
    const onKey = (event: KeyboardEvent) => {
      // Escape that cancels an IME composition is not a request to leave.
      if (event.key === "Escape" && !isImeKey(event)) onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      active.current = false;
      for (const name of FULLSCREEN_CHANGE_EVENTS) document.removeEventListener(name, onChange);
      window.removeEventListener("keydown", onKey);
      // The replay remounts synchronously; a real close releases only our fullscreen element.
      queueMicrotask(() => {
        if (!active.current && fullscreenElement() === element) void exitFullscreen();
      });
    };
  }, [onExit]);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t("share.dialog.projector.caption")}
      tabIndex={-1}
      data-testid="projector"
      className="fixed inset-0 z-(--z-modal) flex flex-col items-center justify-center gap-[4vmin] bg-bg p-[4vmin] text-fg outline-none"
    >
      <p className="text-[clamp(1.25rem,4vmin,2.5rem)] text-fg-2">
        {t("share.dialog.projector.caption")}
      </p>
      <div className="flex flex-col items-center gap-[5vmin] md:flex-row">
        <output
          aria-label={ctx.share.joinCode.split("").join(" ")}
          className="font-mono text-[clamp(3.5rem,18vmin,14rem)] font-semibold leading-none tracking-[0.1em] tabular"
        >
          {groupCode(ctx.share.joinCode)}
        </output>
        <div className="grid aspect-square w-[clamp(10rem,38vmin,28rem)] place-items-center rounded-2xl bg-white p-[2vmin]">
          {qr ? (
            <img src={qr} alt={t("share.dialog.qr.alt")} className="size-full" />
          ) : (
            <Spinner label={t("a11y.loading")} />
          )}
        </div>
      </div>
      <p className="font-mono text-[clamp(0.875rem,2.4vmin,1.5rem)] text-fg-3">
        {window.location.host}
      </p>
      <Button
        onClick={onExit}
        data-testid="projector-exit"
        className="absolute end-4 top-4"
        leading={<X />}
      >
        {t("share.dialog.projector.exitAction")}
      </Button>
    </div>
  );
}

function SendTab() {
  const t = useT();
  const ctx = useEditor();
  const presence = usePresence();
  const session = useSession();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const selfId = session.data?.clientId;
  const room = session.data?.room;

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return presence.filter(
      (person) => person.clientId !== selfId && (!q || person.name.toLowerCase().includes(q)),
    );
  }, [presence, query, selfId]);

  const broadcast = useMutation({
    mutationFn: () =>
      api.invite({ to: "net", shareId: ctx.share.id, note: note.trim() || undefined }),
    onSuccess: () => toast({ title: t("toast.broadcastSent"), tone: "success" }),
    onError: () => toast({ title: t("error.generic"), tone: "danger" }),
  });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3" aria-labelledby="send-title">
        <div>
          <h3 id="send-title" className="text-body-sm font-semibold">
            {t("share.dialog.send.title")}
          </h3>
          <p className="text-caption text-fg-3">{t("share.dialog.send.description")}</p>
        </div>
        <Field
          label={t("share.dialog.send.noteLabel")}
          hint={t("share.dialog.send.noteMax", { max: MAX_NOTE_LENGTH })}
        >
          <Input
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            placeholder={t("share.dialog.send.notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
            data-testid="send-note"
          />
        </Field>
        <Field label={t("share.dialog.send.searchLabel")}>
          <Input
            type="search"
            value={query}
            placeholder={t("share.dialog.send.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        {people.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Users />}
            title={t("share.dialog.send.empty")}
            description={t("share.dialog.send.emptyHint")}
          />
        ) : (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto" data-testid="presence-list">
            {people.map((person) => (
              <PersonRow
                key={person.clientId}
                clientId={person.clientId}
                name={person.name}
                color={person.color}
                note={note}
              />
            ))}
          </ul>
        )}
      </section>

      {ctx.isOwner ? (
        <section
          className="flex flex-col gap-2 border-t border-line pt-4"
          aria-labelledby="broadcast-title"
        >
          <h3 id="broadcast-title" className="text-body-sm font-semibold">
            {t("share.dialog.broadcast.title")}
          </h3>
          <p className="text-caption text-fg-3">
            {room ? t("share.dialog.broadcast.room", { room }) : t("share.dialog.broadcast.net")}
          </p>
          {confirmBroadcast ? (
            <div
              role="alertdialog"
              aria-label={t("share.dialog.broadcast.confirmTitle")}
              className="flex flex-col gap-2 rounded-lg border border-line bg-fill-hover p-3"
            >
              <p className="text-body-sm font-medium">{t("share.dialog.broadcast.confirmTitle")}</p>
              <p className="text-caption text-fg-2">{t("share.dialog.broadcast.confirmBody")}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setConfirmBroadcast(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={broadcast.isPending}
                  loadingLabel={t("common.loading")}
                  data-testid="broadcast-confirm"
                  onClick={() =>
                    broadcast.mutate(undefined, { onSettled: () => setConfirmBroadcast(false) })
                  }
                >
                  {t("share.dialog.broadcast.action")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              leading={<Radio />}
              className="self-start"
              onClick={() => setConfirmBroadcast(true)}
              data-testid="broadcast-button"
            >
              {t("share.dialog.broadcast.action")}
            </Button>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PersonRow({
  clientId,
  name,
  color,
  note,
}: {
  clientId: string;
  name: string;
  color: string;
  note: string;
}) {
  const t = useT();
  const ctx = useEditor();
  const transfer = useTransferTarget(ctx.share.id, clientId, name);
  const send = useMutation({
    mutationFn: () =>
      api.invite({ to: clientId as never, shareId: ctx.share.id, note: note.trim() || undefined }),
    onSuccess: () => toast({ title: t("toast.sent", { name }), tone: "success" }),
    onError: () => toast({ title: t("error.generic"), tone: "danger" }),
  });
  return (
    <li
      {...transfer.props}
      data-drop-over={transfer.over || undefined}
      data-testid={`presence-${name}`}
      className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"
    >
      <Avatar
        name={name}
        slot={1}
        size="sm"
        style={{ backgroundColor: color, color: labelColorFor(color) }}
      />
      <span className="min-w-0 flex-1 truncate text-body-sm">{name}</span>
      <Button
        size="sm"
        leading={<Send />}
        loading={send.isPending}
        loadingLabel={t("common.loading")}
        onClick={() => send.mutate()}
      >
        {t("share.dialog.send.action")}
      </Button>
    </li>
  );
}

function AccessTab() {
  const t = useT();
  const [locale] = useLocale();
  const ctx = useEditor();
  const queryClient = useQueryClient();
  const access = ctx.share.access;
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [removing, setRemoving] = useState<{ clientId: string; name: string; ban: boolean } | null>(
    null,
  );

  const patch = useMutation({
    mutationFn: (body: PatchShareBody) => api.patchShare(ctx.share.id, body),
    onSuccess: (share) => queryClient.setQueryData(["share", ctx.share.id], share),
    onError: () => toast({ title: t("error.generic"), tone: "danger" }),
  });
  const pending = useMutation({
    mutationFn: ({ clientId, approve }: { clientId: string; approve: boolean }) =>
      api.resolvePending(ctx.share.id, clientId, approve),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["pending", ctx.share.id] });
      toast({ title: vars.approve ? t("toast.approved") : t("toast.denied"), tone: "success" });
    },
  });
  const kick = useMutation({
    mutationFn: (v: { clientId: string; ban: boolean }) => api.kick(ctx.share.id, v as never),
    onSuccess: (_d, v) => {
      // The server drops them from the document at once; their awareness entry would otherwise
      // linger in this list until it times out.
      const gone = ctx.participants.find((person) => person.clientId === v.clientId);
      if (gone) removeAwarenessStates(ctx.session.awareness, gone.awarenessIds, "kick");
      toast({ title: v.ban ? t("toast.banned") : t("toast.kicked"), tone: "success" });
    },
    onError: () => toast({ title: t("error.generic"), tone: "danger" }),
  });
  const pendingList = useQueryPending(ctx.share.id, Boolean(access?.requireApproval));

  if (!access) return null;
  const setLevel = (level: "edit" | "view") => patch.mutate({ access: { default: level } });
  const expiry = ctx.share.expiresAt ? new Date(ctx.share.expiresAt).getTime() - Date.now() : null;

  const submitPin = () => {
    if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
      setPinError(true);
      return;
    }
    setPinError(false);
    patch.mutate({ access: { pin } }, { onSuccess: () => setPin("") });
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-labelledby="access-default">
        <h3 id="access-default" className="text-body-sm font-semibold">
          {t("share.dialog.access.default")}
        </h3>
        <fieldset aria-labelledby="access-default" className="grid gap-2 sm:grid-cols-2">
          {(["edit", "view"] as const).map((level) => {
            const checked = access.default === level;
            return (
              <label
                key={level}
                className="relative cursor-pointer"
                data-testid={`access-${level}`}
              >
                <input
                  type="radio"
                  name="access-default"
                  value={level}
                  checked={checked}
                  onChange={() => setLevel(level)}
                  className="peer sr-only"
                />
                <span className="flex h-full flex-col gap-0.5 rounded-lg border border-line p-3 text-start hover:bg-fill-hover peer-checked:border-accent-text peer-checked:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                  <span className="text-body-sm font-medium">
                    {t(level === "edit" ? "share.dialog.access.edit" : "share.dialog.access.view")}
                  </span>
                  <span className="text-caption text-fg-3">
                    {t(
                      level === "edit"
                        ? "share.dialog.access.editHint"
                        : "share.dialog.access.viewHint",
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </section>

      <section className="flex flex-col gap-2">
        <Field
          label={t("share.dialog.access.pin")}
          hint={t("share.dialog.access.pinHint", { min: MIN_PIN_LENGTH, max: MAX_PIN_LENGTH })}
          error={
            pinError
              ? t("share.dialog.access.pinHint", { min: MIN_PIN_LENGTH, max: MAX_PIN_LENGTH })
              : undefined
          }
        >
          <div className="flex items-center gap-2">
            <Input
              type="password"
              autoComplete="new-password"
              value={pin}
              maxLength={MAX_PIN_LENGTH}
              onChange={(event) => setPin(event.target.value)}
              placeholder={access.hasPin ? "••••" : ""}
              data-testid="pin-set-input"
            />
            <Button size="sm" onClick={submitPin} data-testid="pin-set">
              {t("share.dialog.access.pinSetAction")}
            </Button>
            {access.hasPin ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => patch.mutate({ access: { pin: null } })}
              >
                {t("share.dialog.access.pinRemoveAction")}
              </Button>
            ) : null}
          </div>
        </Field>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="access-permissions">
        <h3 id="access-permissions" className="text-body-sm font-semibold">
          {t("share.dialog.access.permissions")}
        </h3>
        <p className="text-caption text-fg-3">{t("share.dialog.access.permissionsHint")}</p>
        {(
          [
            ["allowParticipantRename", "share.dialog.access.allowRename"],
            ["allowParticipantFiles", "share.dialog.access.allowFiles"],
            ["allowParticipantLanguage", "share.dialog.access.allowLanguage"],
          ] as const
        ).map(([field, label]) => (
          <Switch
            key={field}
            label={t(label)}
            checked={access[field] ?? false}
            disabled={patch.isPending}
            onCheckedChange={(checked) => patch.mutate({ access: { [field]: checked } })}
            data-testid={`switch-${field}`}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <Switch
          label={t("share.dialog.access.approval")}
          description={t("share.dialog.access.approvalHint")}
          checked={access.requireApproval}
          onCheckedChange={(checked) => patch.mutate({ access: { requireApproval: checked } })}
          data-testid="switch-approval"
        />
        <Switch
          label={t("share.dialog.access.nearby")}
          description={t("share.dialog.access.nearbyHint")}
          checked={access.nearby}
          onCheckedChange={(checked) => patch.mutate({ access: { nearby: checked } })}
          data-testid="switch-nearby"
        />
        {ctx.share.labId ? (
          <p className="text-caption text-fg-3">{t("perm.labLock")}</p>
        ) : (
          <Switch
            label={t("share.dialog.access.lock")}
            description={t("share.dialog.access.lockHint")}
            checked={ctx.share.locked}
            onCheckedChange={(checked) => patch.mutate({ locked: checked })}
            data-testid="switch-lock"
          />
        )}
      </section>

      <p className="text-caption text-fg-3">
        <span className="font-medium text-fg-2">{t("share.dialog.expiry.label")}: </span>
        {ctx.share.saved || expiry === null
          ? t("share.dialog.expiry.never")
          : t("share.dialog.expiry.in", { time: formatDuration(locale, Math.max(0, expiry)) })}
        {!ctx.share.saved ? ` · ${t("share.dialog.expiry.saveHint")}` : ""}
      </p>

      {pendingList.length > 0 ? (
        <section
          className="flex flex-col gap-2"
          aria-label={t("approval.waiting", { count: pendingList.length })}
        >
          <h3 className="text-body-sm font-semibold">
            {t("approval.waiting", { count: pendingList.length })}
          </h3>
          <ul className="flex flex-col gap-1">
            {pendingList.map((entry) => (
              <li
                key={entry.clientId}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-body-sm">{entry.name}</span>
                <Button
                  size="sm"
                  onClick={() => pending.mutate({ clientId: entry.clientId, approve: false })}
                >
                  {t("approval.denyAction")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => pending.mutate({ clientId: entry.clientId, approve: true })}
                >
                  {t("approval.approveAction")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="people-title">
        <h3 id="people-title" className="text-body-sm font-semibold">
          {t("share.dialog.people.title")}
        </h3>
        <ul className="flex flex-col gap-1" data-testid="people-list">
          {ctx.participants.map((person) => (
            <li
              key={person.clientId}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
            >
              <Avatar
                name={person.name}
                slot={1}
                size="sm"
                style={{ backgroundColor: person.color, color: labelColorFor(person.color) }}
              />
              <span className="min-w-0 flex-1 truncate text-body-sm">
                {person.name} {person.isSelf ? t("share.dialog.people.you") : ""}
              </span>
              {person.isSelf ? (
                <Badge tone="accent">{t("share.dialog.people.roleOwner")}</Badge>
              ) : (
                <>
                  <IconButton
                    aria-label={`${t("share.dialog.people.kickAction")}: ${person.name}`}
                    size="sm"
                    onClick={() =>
                      setRemoving({ clientId: person.clientId, name: person.name, ban: false })
                    }
                  >
                    <UserMinus />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <DialogContent
          size="sm"
          title={
            removing?.ban
              ? t("share.dialog.people.banTitle", { name: removing.name })
              : t("share.dialog.people.kickTitle", { name: removing?.name ?? "" })
          }
          description={
            removing?.ban ? t("share.dialog.people.banBody") : t("share.dialog.people.kickBody")
          }
          closeLabel={t("common.close")}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
              {removing && !removing.ban ? (
                <Button variant="danger" onClick={() => setRemoving({ ...removing, ban: true })}>
                  {t("share.dialog.people.banAction")}
                </Button>
              ) : null}
              <Button
                variant="danger"
                onClick={() => {
                  if (removing) kick.mutate({ clientId: removing.clientId, ban: removing.ban });
                  setRemoving(null);
                }}
                data-testid="confirm-kick"
              >
                {removing?.ban
                  ? t("share.dialog.people.banAction")
                  : t("share.dialog.people.kickAction")}
              </Button>
            </>
          }
        >
          <span className="sr-only">{removing?.name}</span>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function useQueryPending(shareId: string, enabled: boolean) {
  const [list, setList] = useState<{ clientId: string; name: string }[]>([]);
  useEffect(() => {
    if (!enabled) {
      setList([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      void api
        .listPending(shareId)
        .then((entries) => {
          if (!cancelled) setList(entries);
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [shareId, enabled]);
  return list;
}
