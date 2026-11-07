import { Button, Dialog, DialogContent, toast } from "@gachipad/ui";
import { CloudOff, Eye, HardDrive, Presentation, ShieldAlert, Wifi, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { chooseOfflineCopy } from "../../lib/device";
import { copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { usePrefs } from "../../lib/prefs";
import { useEditor } from "./context";

type Tone = "info" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  info: "bg-info-soft text-info-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
};

function Banner(props: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  body?: string;
  actions?: ReactNode;
  testId?: string;
  live?: "polite" | "assertive";
}) {
  return (
    <div
      role={props.live === "assertive" ? "alert" : "status"}
      data-testid={props.testId}
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-body-sm ${TONES[props.tone]} [&_svg]:size-4 [&_svg]:shrink-0`}
    >
      {props.icon}
      <span className="min-w-0 flex-1 basis-60">
        <span className="font-medium">{props.title}</span>
        {props.body ? <span className="ms-2 opacity-90">{props.body}</span> : null}
      </span>
      {props.actions}
    </div>
  );
}

/** Everything the editor wants to say about the connection and the permission, in one stack. */
export function EditorBanners({
  secretWarning,
  onKeepSecret,
  onStopFollow,
}: {
  secretWarning: boolean;
  onKeepSecret: () => void;
  onStopFollow: () => void;
}) {
  const t = useT();
  const ctx = useEditor();
  const prefs = usePrefs();
  const { status, tooLarge, copyKept } = ctx.state;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const followTarget = ctx.following
    ? ctx.participants.find((person) => person.clientId === ctx.following)
    : undefined;

  return (
    <>
      <UnsentTextRecovery />
      {status === "offline" || (offline && status !== "connected") ? (
        <Banner
          tone="warning"
          icon={<CloudOff />}
          title={t("conn.offline.title")}
          body={t(copyKept ? "conn.offline.body" : "conn.offline.bodyMemory")}
          testId="banner-offline"
        />
      ) : status === "reconnecting" || status === "connecting" ? (
        ctx.state.synced ? (
          <Banner
            tone="warning"
            icon={<Wifi />}
            title={t("conn.reconnecting.title")}
            body={t(copyKept ? "conn.reconnecting.body" : "conn.reconnecting.bodyMemory")}
            testId="banner-reconnecting"
          />
        ) : null
      ) : status === "disconnected" ? (
        <Banner
          tone="danger"
          live="assertive"
          icon={<CloudOff />}
          title={t("conn.disconnected.title")}
          body={t("conn.disconnected.body")}
          testId="banner-disconnected"
          actions={
            <Button size="sm" onClick={() => void ctx.session.reconnect()}>
              {t("conn.retryNowAction")}
            </Button>
          }
        />
      ) : null}

      {tooLarge !== null ? (
        <Banner
          tone="danger"
          live="assertive"
          icon={<ShieldAlert />}
          title={t("error.too_large")}
          body={t("error.too_large.hint")}
        />
      ) : null}

      {ctx.readOnly ? (
        <Banner
          tone="info"
          icon={<Eye />}
          title={ctx.state.locked ? t("conn.locked.title") : t("conn.readOnly.title")}
          body={ctx.state.locked ? t("conn.locked.body") : t("conn.readOnly.body")}
          testId="banner-readonly"
        />
      ) : null}

      {secretWarning ? (
        <Banner
          tone="warning"
          live="assertive"
          icon={<ShieldAlert />}
          title={t("editor.secret.title")}
          body={t("editor.secret.body")}
          testId="banner-secret"
          actions={
            <Button size="sm" onClick={onKeepSecret}>
              {t("editor.secret.keepAction")}
            </Button>
          }
        />
      ) : null}

      {ctx.presenting ? (
        <Banner
          tone="info"
          icon={<Presentation />}
          title={t("editor.present.active")}
          testId="banner-presenting"
          actions={
            <Button size="sm" onClick={() => ctx.setPresenting(false)}>
              {t("editor.present.stopAction")}
            </Button>
          }
        />
      ) : followTarget ? (
        <Banner
          tone="info"
          icon={<Presentation />}
          title={t("editor.present.following", { name: followTarget.name })}
          testId="banner-following"
          actions={
            <Button size="sm" leading={<X />} onClick={onStopFollow}>
              {t("editor.top.followStopAction")}
            </Button>
          }
        />
      ) : null}

      {prefs.offlineCopy === "undecided" ? <DeviceChoice shareId={ctx.session.shareId} /> : null}
    </>
  );
}

function UnsentTextRecovery() {
  const t = useT();
  const { session, state } = useEditor();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // New text to rescue opens it; a newer copy of a file already listed only updates the banner, or
  // every keystroke refused by a full share would take the keyboard away again.
  const listed = useRef(0);
  useEffect(() => {
    const count = state.unsentText.length;
    if (count > listed.current) {
      setOpen(true);
      setCopied(false);
    }
    listed.current = count;
  }, [state.unsentText]);
  if (!state.unsentText.length) return null;
  return (
    <>
      <Banner
        tone="warning"
        icon={<ShieldAlert />}
        title={t("perm.unsentTitle")}
        testId="unsent-text-banner"
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            {t("perm.copyUnsent")}
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("perm.unsentTitle")}
          description={t("perm.unsentBody")}
          closeLabel={t("common.close")}
          data-testid="unsent-text-dialog"
          footer={
            <>
              <Button
                onClick={() => {
                  session.dismissUnsentText();
                  setOpen(false);
                }}
              >
                {t("perm.discardUnsent")}
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const text = state.unsentText
                    .map((file) => `${file.path}\n${file.text}`)
                    .join("\n\n");
                  setCopied(await copyText(text));
                }}
              >
                {t("perm.copyUnsent")}
              </Button>
            </>
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            {state.unsentText.map((file) => (
              <label key={file.id} className="flex min-w-0 flex-col gap-1 text-body-sm">
                <span className="break-all">{file.path}</span>
                <textarea
                  readOnly
                  value={file.text}
                  rows={4}
                  className="w-full min-w-0 rounded-md border border-line bg-panel p-2 font-mono text-body-sm"
                />
              </label>
            ))}
            {copied && <p role="status">{t("perm.unsentCopied")}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Asked once per device, without blocking the editor; Settings can change the answer later. */
function DeviceChoice({ shareId }: { shareId: string }) {
  const t = useT();
  const choose = async (choice: "yes" | "no") => {
    if (!(await chooseOfflineCopy(choice, shareId))) {
      toast({ title: t("toast.forgetFailed"), tone: "warning" });
    }
  };
  return (
    <Banner
      tone="info"
      icon={<HardDrive />}
      title={t("editor.deviceCopy.title")}
      body={t("editor.deviceCopy.body")}
      testId="device-choice"
      actions={
        <span className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void choose("yes")} data-testid="device-choice-keep">
            {t("editor.deviceCopy.keepAction")}
          </Button>
          <Button size="sm" onClick={() => void choose("no")} data-testid="device-choice-skip">
            {t("editor.deviceCopy.skipAction")}
          </Button>
        </span>
      }
    />
  );
}
