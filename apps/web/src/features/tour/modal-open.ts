import { useEffect, useState } from "react";

/**
 * Any open modal dialog except the tour's own (it carries `data-tour`). Radix marks a dialog's
 * content `role="dialog"` with `data-state="open"` for as long as it is shown, so this sees the
 * editor's naming and delete dialogs, the sheets and whatever comes later without a list.
 */
const OPEN_MODAL =
  '[role="dialog"][data-state="open"]:not([data-tour]), [role="alertdialog"][data-state="open"]';

/** Every open dialog, the tour's own included: what a hint that must stay out of the way waits for. */
export const ANY_DIALOG =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function modalIsOpen(selector: string = OPEN_MODAL): boolean {
  return document.querySelector(selector) !== null;
}

/** Whether a modal dialog is open, followed through DOM changes while `active`. */
export function useModalOpen(active: boolean, selector: string = OPEN_MODAL): boolean {
  const [open, setOpen] = useState(() => active && modalIsOpen(selector));
  useEffect(() => {
    if (!active) {
      setOpen(false);
      return;
    }
    const update = () => setOpen(modalIsOpen(selector));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    return () => observer.disconnect();
  }, [active, selector]);
  return open;
}
