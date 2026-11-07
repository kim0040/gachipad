import type { MessageKey } from "@gachipad/i18n";
import { useDocumentPermissions, useEditor } from "./context";

/**
 * Why files cannot be added to this share right now, as a message key; null when they can. A drop
 * or a paste that is refused shows this instead of doing nothing.
 */
export function useFilesDenial(): MessageKey | null {
  const ctx = useEditor();
  const canImport = useDocumentPermissions().files;
  if (canImport) return null;
  if (ctx.state.locked) return "upload.denied.locked";
  if (ctx.readOnly) return "upload.denied.viewOnly";
  return "upload.denied.ownerOnly";
}
