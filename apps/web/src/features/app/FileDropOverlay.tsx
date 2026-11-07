import { Spinner } from "@gachipad/ui";
import { Ban, FilePlus2, FolderPlus } from "lucide-react";
import { createPortal } from "react-dom";
import { useT } from "../../lib/i18n";
import type { FileDropView } from "./file-drop";

/**
 * Covers the window while files are dragged over it, and says what dropping will do. It never
 * takes the pointer (`pointer-events-none`), so the targets below it keep working, and it only
 * fades in, so it is as calm with reduced motion as without.
 */
export function FileDropOverlay({ view }: { view: FileDropView | null }) {
  const t = useT();
  if (!view) return null;
  const reason = view.denied;
  const denied = reason !== null;
  const title = view.busy
    ? t("upload.drop.pending")
    : reason !== null
      ? t(reason)
      : t(view.mode === "create" ? "upload.drop.new" : "upload.drop.add");
  const body = view.busy ? null : denied ? t("upload.drop.deniedBody") : t("upload.drop.formats");
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="file-drop-overlay"
      data-mode={view.busy ? "busy" : denied ? "denied" : view.mode}
      className="ui-appear-fade pointer-events-none fixed inset-0 z-(--z-modal) flex items-center justify-center bg-bg/90 p-3"
    >
      <div
        className={`flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 text-center ${
          denied ? "border-line-strong" : "border-accent-text"
        }`}
      >
        <span
          aria-hidden="true"
          className={`flex size-14 items-center justify-center rounded-full [&_svg]:size-6 ${
            denied ? "bg-fill-active text-fg-2" : "bg-accent-soft text-accent-text"
          }`}
        >
          {view.busy ? (
            <Spinner label={title} />
          ) : denied ? (
            <Ban />
          ) : view.mode === "create" ? (
            <FolderPlus />
          ) : (
            <FilePlus2 />
          )}
        </span>
        <p className="max-w-sm text-title-sm font-semibold text-fg">{title}</p>
        {body ? <p className="max-w-sm text-body-sm text-fg-2">{body}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
