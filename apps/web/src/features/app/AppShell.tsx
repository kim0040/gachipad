import { Toaster, toast } from "@gachipad/ui";
import { type ReactNode, useEffect } from "react";
import { onLeftovers } from "../../lib/device";
import { retainEvents } from "../../lib/events";
import { useT } from "../../lib/i18n";
import { openPalette, openShortcuts } from "../../lib/overlays";
import { PLATFORM } from "../../lib/platform";
import { useWindowShortcuts } from "../../lib/use-shortcuts";
import { TemplatePicker } from "../start/TemplatePicker";
import { CommandPalette } from "./CommandPalette";
import { EventToasts } from "./EventToasts";
import { useFileDropGuard } from "./file-drop";
import { ShortcutSheet } from "./ShortcutSheet";
import { UpdatePrompt } from "./UpdatePrompt";
import "./app.css";

// Set before the first paint: app.css styles scrollbars by platform.
document.documentElement.dataset.platform = PLATFORM;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** App-wide pieces: the event stream, toasts, the update prompt, the command palette and the shortcut sheet. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();

  useEffect(() => retainEvents(), []);
  // A file dropped on no target must not make the browser open it and leave the app.
  useFileDropGuard();
  // A cleanup that ran on its own (start, another account, a denial) may have left copies behind.
  useEffect(
    () => onLeftovers(() => toast({ title: t("toast.forgetFailed"), tone: "warning" })),
    [t],
  );

  useWindowShortcuts(["palette", "shortcuts"], (id, event) => {
    if (id === "palette") {
      openPalette();
      return true;
    }
    // "?" is a character: let it through where it is being typed.
    if (isTypingTarget(event.target)) return false;
    openShortcuts();
    return true;
  });

  return (
    <>
      <a
        href="#main"
        className="sr-only z-(--z-toast) rounded-md bg-accent px-3 py-2 text-body-sm text-accent-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t("a11y.skipToContent")}
      </a>
      {children}
      <Toaster label={t("a11y.toastRegion")} closeLabel={t("a11y.dismissToast")} />
      <EventToasts />
      <UpdatePrompt />
      <CommandPalette />
      <ShortcutSheet />
      <TemplatePicker />
    </>
  );
}
