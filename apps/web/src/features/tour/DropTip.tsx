import { Button, IconButton } from "@gachipad/ui";
import { FileUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useDragCapable, useIsNarrow } from "../../lib/appearance";
import { useT } from "../../lib/i18n";
import { usePrefs } from "../../lib/prefs";
import { useStore } from "../../lib/store";
import { useDocumentPermissions, useEditor } from "../editor/context";
import { showAloneHint } from "../editor/doc-info";
import {
  dropTipDone,
  dropTipUsesButton,
  fileWasAdded,
  markDropTipDone,
  showDropTip,
  subscribeDropTip,
} from "./drop-tip";
import { ANY_DIALOG, useModalOpen } from "./modal-open";
import { tourSeen } from "./seen";

/** The editor settles for a moment before a hint comes in. */
const SETTLE_MS = 2000;

/**
 * A one-time hint under the file tabs: files can be dragged onto the page. It is for people who
 * can add files, waits for the tour and for any dialog, gives way to the "only one here" card,
 * and ends for good when dismissed or when a file is added by any means.
 */
export function DropTip() {
  const t = useT();
  const ctx = useEditor();
  const canAdd = useDocumentPermissions().files;
  const narrow = useIsNarrow();
  const prefs = usePrefs();
  const dragCapable = useDragCapable();
  const done = useSyncExternalStore(subscribeDropTip, dropTipDone, () => true);
  const [settled, setSettled] = useState(false);
  const [typed, setTyped] = useState(false);
  const root = useRef<HTMLElement>(null);
  const baseline = useRef<number | null>(null);
  const length = useStore(ctx.info).length;
  const active = canAdd && !done;
  const dialogOpen = useModalOpen(active, ANY_DIALOG);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  // The first file added by any means (new, from a collaborator) ends the tip, also before it
  // shows; imports say so themselves, because the first one replaces the empty file and adds none.
  // What arrives with the first sync was there already, so counting starts after it.
  const count = ctx.files.length;
  const synced = ctx.state.synced;
  useEffect(() => {
    if (done) return;
    if (!synced) {
      baseline.current = null;
    } else if (baseline.current !== null && fileWasAdded(baseline.current, count)) {
      markDropTipDone();
    } else {
      baseline.current = count;
    }
  }, [synced, done, count]);

  // Only this person's own input counts: other people typing is no reason to hide a hint.
  useEffect(() => {
    if (!active) return;
    const onInput = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".cm-content")) setTyped(true);
    };
    document.addEventListener("beforeinput", onInput, true);
    return () => document.removeEventListener("beforeinput", onInput, true);
  }, [active]);

  const visible = showDropTip({
    canAdd,
    done,
    tourSeen: tourSeen(),
    dialogOpen,
    deviceQuestion: prefs.offlineCopy === "undecided",
    panelOpen: ctx.panel.name !== null,
    aloneHintShown: showAloneHint({
      participants: ctx.participants.length,
      length,
      readOnly: ctx.readOnly,
    }),
    typed,
    settled,
  });
  const viewRef = ctx.viewRef;
  const dismiss = useCallback(() => {
    // Focus was on the tip, which is about to go: hand it back to the editor.
    const hadFocus = root.current?.contains(document.activeElement) ?? false;
    markDropTipDone();
    if (hadFocus) viewRef.current?.focus();
  }, [viewRef]);

  // Outside the places that have their own Escape, and left for others to see too.
  useEffect(() => {
    if (!visible) return;
    // The Escape that closed the tour or a dialog can bring the tip in while it is still on its way
    // to this listener: that one was not meant for the tip.
    const shownAt = performance.now();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.timeStamp < shownAt) return;
      // There it closes the search panel, leaves Vim's insert mode or closes a menu: not about the tip.
      const target = event.target as Partial<Pick<Element, "closest">> | null;
      if (target?.closest?.('.cm-editor, [role="menu"], [role="dialog"], [role="listbox"]')) return;
      dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, dismiss]);

  if (!visible) return null;

  const useButton = dropTipUsesButton({ touchOnly: !dragCapable, narrow });

  // The button wording is for small screens: at the bottom, within reach and off the first lines.
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex justify-end px-3 ${useButton ? "bottom-2" : "top-2"}`}
    >
      <section
        ref={root}
        aria-label={t("tour.dropTip.label")}
        data-testid="drop-tip"
        className="ui-appear pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border border-line bg-panel p-3 shadow-2"
      >
        <FileUp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm" data-testid="drop-tip-text">
            {useButton ? t("tour.dropTip.touchBody") : t("tour.dropTip.body")}
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => {
              markDropTipDone();
              ctx.openPanel("upload");
            }}
            data-testid="drop-tip-open"
          >
            {t("tour.dropTip.openAction")}
          </Button>
        </div>
        <IconButton
          size="sm"
          aria-label={t("tour.dropTip.dismissAction")}
          onClick={dismiss}
          data-testid="drop-tip-dismiss"
        >
          <X />
        </IconButton>
      </section>
    </div>
  );
}
