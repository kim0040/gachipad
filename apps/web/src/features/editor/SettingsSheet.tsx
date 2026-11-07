import { EDITOR_THEMES, type ThemeId } from "@gachipad/highlight";
import {
  Button,
  Dialog,
  DialogContent,
  getStoredTheme,
  IconButton,
  Select,
  Sheet,
  SheetContent,
  Switch,
  setTheme,
  type ThemePreference,
  toast,
} from "@gachipad/ui";
import { useNavigate } from "@tanstack/react-router";
import { Minus, Plus } from "lucide-react";
import { useId, useState } from "react";
import {
  chooseOfflineCopy,
  forgetShare,
  hasUnsentEdits,
  isForgotten,
  signOut,
} from "../../lib/device";
import { useLocale, useT } from "../../lib/i18n";
import { promptInstall, useCanInstall } from "../../lib/install";
import { LICENSES_URL } from "../../lib/licenses";
import { notificationPermission, requestNotificationPermission } from "../../lib/notify";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  KEYMAPS,
  REMOTE_CURSOR_MODES,
  type RemoteCursorMode,
  resetPrefs,
  setPrefs,
  TAB_SIZES,
  usePrefs,
} from "../../lib/prefs";
import { useSession } from "../../lib/session";
import { requestTour } from "../tour/seen";
import { useEditor } from "./context";
import { DiagnosticsSection } from "./DiagnosticsSection";

/** Editor and app settings: stored on this device and applied live, no save button. */
export function SettingsSheet() {
  const t = useT();
  const ctx = useEditor();
  const open = ctx.panel.name === "settings";
  return (
    <Sheet open={open} onOpenChange={(next) => !next && ctx.closePanel()}>
      <SheetContent
        side="right"
        title={t("settings.title")}
        description={t("settings.deviceNote")}
        closeLabel={t("common.close")}
        footer={
          <Button
            onClick={() => {
              resetPrefs();
              toast({ title: t("toast.settingsReset"), tone: "neutral", duration: 2500 });
            }}
            data-testid="settings-reset"
          >
            {t("settings.resetAction")}
          </Button>
        }
      >
        <SettingsBody />
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 border-b border-line pb-5 last:border-b-0"
    >
      <h3 id={id} className="text-label font-medium text-fg-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={id} className="min-w-0 flex-1 text-body-sm">
        {label}
      </span>
      {/* One control column, so labels stay on one line and the controls line up. */}
      <div className="flex w-44 max-w-[60%] shrink-0 justify-end">{children}</div>
    </div>
  );
}

function SettingsBody() {
  const t = useT();
  const ctx = useEditor();
  const navigate = useNavigate();
  // Signing out only exists for a verified identity: an anonymous session cannot be signed back in.
  const identity = useSession().data?.identity;
  const [locale, setLocale] = useLocale();
  const prefs = usePrefs();
  const canInstall = useCanInstall();
  const [uiTheme, setUiTheme] = useState<ThemePreference>(getStoredTheme);
  // Forget or sign out was asked for while edits had not reached the server yet.
  const [confirming, setConfirming] = useState<"forget" | "signOut" | null>(null);
  const labelIds = { size: useId(), indent: useId() };

  const chooseUiTheme = (value: string) => {
    const next = value as ThemePreference;
    setUiTheme(next);
    setTheme(next);
  };

  const shareId = ctx.session.shareId;
  // Off when this share was forgotten here, even if copies are kept for others.
  const keepsCopy = prefs.offlineCopy === "yes" && !isForgotten(shareId);

  const chooseCopy = async (on: boolean) => {
    const ok = await chooseOfflineCopy(on ? "yes" : "no", shareId);
    if (!ok) toast({ title: t("toast.forgetFailed"), tone: "warning" });
  };

  // Leaving the share here: the editor closes and the start page shows how it went.
  const forget = async () => {
    const ok = await forgetShare(shareId);
    void navigate({ to: "/", replace: true });
    toast(
      ok
        ? { title: t("toast.forgotten"), tone: "success", duration: 3000 }
        : { title: t("toast.forgetFailed"), tone: "warning" },
    );
  };

  const leave = async () => {
    const ok = await signOut();
    if (ok) window.location.assign("/");
    else {
      void navigate({ to: "/", replace: true });
      toast({ title: t("toast.forgetFailed"), tone: "warning" });
    }
  };

  // Both throw away edits the server has not confirmed (in any tab): ask first.
  const askFirst = async (action: "forget" | "signOut") => {
    if (await hasUnsentEdits(action === "forget" ? shareId : undefined)) setConfirming(action);
    else void (action === "forget" ? forget() : leave());
  };
  const confirmLeave = () => {
    const action = confirming;
    setConfirming(null);
    void (action === "forget" ? forget() : leave());
  };

  const toggleNotifications = async (on: boolean) => {
    if (!on) {
      setPrefs({ notifications: false });
      return;
    }
    const permission = await requestNotificationPermission();
    if (permission === "granted") setPrefs({ notifications: true });
    else toast({ title: t("settings.notifications.blocked"), tone: "warning" });
  };

  // iOS Safari has no Notification API outside an app added to the Home Screen.
  const permission = notificationPermission();
  const notificationHint =
    permission === "unsupported"
      ? t("settings.notifications.unsupported")
      : permission === "denied"
        ? t("settings.notifications.blocked")
        : t("settings.notifications.hint");

  const themes = EDITOR_THEMES;
  const dark = themes.filter((theme) => theme.appearance === "dark");
  const light = themes.filter((theme) => theme.appearance === "light");

  return (
    <div className="flex flex-col gap-5">
      <Section title={t("settings.section.appearance")}>
        <Row label={t("settings.uiTheme.label")}>
          <Select
            size="sm"
            aria-label={t("settings.uiTheme.label")}
            value={uiTheme}
            onValueChange={chooseUiTheme}
            options={[
              { value: "system", label: t("settings.uiTheme.system") },
              { value: "light", label: t("settings.uiTheme.light") },
              { value: "dark", label: t("settings.uiTheme.dark") },
            ]}
          />
        </Row>
        <Row label={t("settings.uiLanguage.label")}>
          <Select
            size="sm"
            aria-label={t("settings.uiLanguage.label")}
            value={locale}
            onValueChange={(value) => setLocale(value as "ko" | "en")}
            options={[
              { value: "ko", label: t("locale.ko") },
              { value: "en", label: t("locale.en") },
            ]}
          />
        </Row>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body-sm">{t("settings.editorTheme.label")}</legend>
          <div className="flex flex-col gap-3">
            <ThemeGroup
              title={t("settings.editorTheme.groupDark")}
              themes={dark}
              current={prefs.editorTheme}
            />
            <ThemeGroup
              title={t("settings.editorTheme.groupLight")}
              themes={light}
              current={prefs.editorTheme}
            />
          </div>
        </fieldset>
        <div className="flex flex-col gap-2">
          <Row label={t("settings.fontSize.label")} id={labelIds.size}>
            <fieldset className="flex items-center gap-1" aria-labelledby={labelIds.size}>
              <IconButton
                aria-label={t("settings.fontSize.decrease")}
                variant="secondary"
                disabled={prefs.fontSize <= FONT_SIZE_MIN}
                onClick={() => setPrefs({ fontSize: prefs.fontSize - 1 })}
                data-testid="font-decrease"
              >
                <Minus />
              </IconButton>
              <output className="w-10 text-center text-body-sm tabular" data-testid="font-size">
                {prefs.fontSize}
              </output>
              <IconButton
                aria-label={t("settings.fontSize.increase")}
                variant="secondary"
                disabled={prefs.fontSize >= FONT_SIZE_MAX}
                onClick={() => setPrefs({ fontSize: prefs.fontSize + 1 })}
                data-testid="font-increase"
              >
                <Plus />
              </IconButton>
            </fieldset>
          </Row>
        </div>
      </Section>

      <Section title={t("settings.section.editing")}>
        <Row label={t("settings.tabSize.label")}>
          <Select
            size="sm"
            aria-label={t("settings.tabSize.label")}
            value={String(prefs.tabSize)}
            onValueChange={(value) => setPrefs({ tabSize: Number(value) })}
            options={TAB_SIZES.map((size) => ({
              value: String(size),
              label: t("settings.tabSize.spaces", { count: size }),
            }))}
          />
        </Row>
        <Row label={t("settings.indent.label")} id={labelIds.indent}>
          <Select
            size="sm"
            aria-label={t("settings.indent.label")}
            value={prefs.indentWithTabs ? "tabs" : "spaces"}
            onValueChange={(value) => setPrefs({ indentWithTabs: value === "tabs" })}
            options={[
              { value: "spaces", label: t("settings.indent.spaces") },
              { value: "tabs", label: t("settings.indent.tabs") },
            ]}
          />
        </Row>
        <Switch
          label={t("settings.wrap.label")}
          checked={prefs.wrap}
          onCheckedChange={(wrap) => setPrefs({ wrap })}
          data-testid="switch-wrap"
        />
        <Switch
          label={t("settings.lineNumbers.label")}
          checked={prefs.lineNumbers}
          onCheckedChange={(lineNumbers) => setPrefs({ lineNumbers })}
        />
        <Switch
          label={t("settings.smoothTyping.label")}
          description={t("settings.smoothTyping.hint")}
          checked={prefs.smoothTyping}
          onCheckedChange={(smoothTyping) => setPrefs({ smoothTyping })}
          data-testid="switch-smooth-typing"
        />
        <div className="flex flex-col gap-1">
          <Row label={t("settings.remoteCursors.label")}>
            <div className="w-full" data-testid="select-remote-cursors">
              <Select
                size="sm"
                aria-label={t("settings.remoteCursors.label")}
                value={prefs.remoteCursors}
                onValueChange={(value) => setPrefs({ remoteCursors: value as RemoteCursorMode })}
                options={REMOTE_CURSOR_MODES.map((mode) => ({
                  value: mode,
                  label: t(`settings.remoteCursors.${mode}`),
                }))}
              />
            </div>
          </Row>
          <p className="text-caption text-fg-3">{t("settings.remoteCursors.hint")}</p>
        </div>
        <Switch
          label={t("settings.codeCompletion.label")}
          checked={prefs.codeCompletion}
          onCheckedChange={(codeCompletion) => setPrefs({ codeCompletion })}
          data-testid="switch-code-completion"
        />
      </Section>

      <Section title={t("settings.section.keys")}>
        <Row label={t("settings.keymap.label")}>
          <Select
            size="sm"
            aria-label={t("settings.keymap.label")}
            value={prefs.keymap}
            onValueChange={(value) => setPrefs({ keymap: value as (typeof KEYMAPS)[number] })}
            options={KEYMAPS.map((keymap) => ({
              value: keymap,
              label: t(`settings.keymap.${keymap}`),
            }))}
          />
        </Row>
      </Section>

      <Section title={t("settings.section.device")}>
        <Switch
          label={t("settings.offlineCopy.label")}
          description={t("settings.offlineCopy.hint")}
          checked={keepsCopy}
          onCheckedChange={(on) => void chooseCopy(on)}
          data-testid="switch-offline-copy"
        />
        <div className="flex flex-col gap-1.5">
          <Button
            className="self-start"
            onClick={() => void askFirst("forget")}
            data-testid="forget-device"
          >
            {t("settings.forget.action")}
          </Button>
          <p className="text-caption text-fg-3">{t("settings.forget.hint")}</p>
        </div>
        {identity ? (
          <div className="flex flex-col gap-1.5">
            <Button
              className="self-start"
              onClick={() => void askFirst("signOut")}
              data-testid="sign-out"
            >
              {t("settings.signOut.action")}
            </Button>
            <p className="text-caption text-fg-3">{t("settings.signOut.hint")}</p>
          </div>
        ) : null}
        <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
          <DialogContent
            size="sm"
            title={t("settings.unsent.title")}
            description={t("settings.unsent.body")}
            closeLabel={t("common.close")}
            footer={
              <>
                <Button onClick={() => setConfirming(null)}>{t("common.cancel")}</Button>
                <Button variant="danger" onClick={confirmLeave} data-testid="unsent-leave">
                  {t("settings.unsent.leaveAction")}
                </Button>
              </>
            }
          />
        </Dialog>
      </Section>

      <DiagnosticsSection />

      <Section title={t("settings.section.misc")}>
        <Switch
          label={t("settings.notifications.label")}
          description={notificationHint}
          disabled={permission === "unsupported"}
          checked={prefs.notifications && permission !== "denied"}
          onCheckedChange={(on) => void toggleNotifications(on)}
        />
        <div className="flex flex-col gap-1.5">
          <Button
            className="self-start"
            onClick={() => {
              ctx.closePanel();
              requestTour();
            }}
            data-testid="replay-tour"
          >
            {t("tour.replay.action")}
          </Button>
          <p className="text-caption text-fg-3">{t("tour.replay.hint")}</p>
        </div>
        {canInstall ? (
          <Button className="self-start" onClick={() => void promptInstall()}>
            {t("settings.install.action")}
          </Button>
        ) : null}
        <a
          href={LICENSES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 items-center self-start text-body-sm text-accent-text underline underline-offset-2"
        >
          {t("settings.licenses.link")}
          <span className="sr-only">{t("a11y.opensInNewTab")}</span>
        </a>
      </Section>
    </div>
  );
}

function ThemeGroup({
  title,
  themes,
  current,
}: {
  title: string;
  themes: typeof EDITOR_THEMES;
  current: ThemeId | "auto";
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-fg-3">{title}</span>
      <div className="grid grid-cols-2 gap-2">
        {themes.map((theme) => {
          const checked = current === theme.id;
          return (
            <label
              key={theme.id}
              className="relative cursor-pointer"
              data-testid={`theme-${theme.id}`}
            >
              <input
                type="radio"
                name="editor-theme"
                value={theme.id}
                checked={checked}
                onChange={() => setPrefs({ editorTheme: theme.id })}
                className="peer sr-only"
              />
              <span className="flex flex-col gap-1.5 rounded-lg border border-line p-2 hover:border-fg-3 peer-checked:border-accent-text peer-checked:outline-2 peer-checked:outline-accent-text peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                <span
                  aria-hidden="true"
                  className="block rounded-md px-2 py-1.5 font-mono text-[0.6875rem] leading-tight"
                  style={{ backgroundColor: theme.background, color: theme.foreground }}
                >
                  <span style={{ color: theme.tokens.keyword }}>const</span> x ={" "}
                  <span style={{ color: theme.tokens.string }}>"a"</span>
                  <br />
                  <span style={{ color: theme.tokens.comment }}>{`// ${theme.id}`}</span>
                </span>
                <span className="text-caption">{t(`settings.editorTheme.${theme.id}`)}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
