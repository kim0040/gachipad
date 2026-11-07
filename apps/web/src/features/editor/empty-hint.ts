import type { MessageKey } from "@gachipad/i18n";
import { useDragCapable, useIsNarrow } from "../../lib/appearance";
import { useT } from "../../lib/i18n";

/**
 * What an empty file tells the person looking at it. Dragging is promised only where it can
 * happen: not on a narrow or touch screen, where the upload button in the file bar is the way,
 * and not to someone who cannot add files at all.
 */
export function emptyHintKey(options: {
  readOnly: boolean;
  canImport: boolean;
  touch: boolean;
}): MessageKey {
  if (options.readOnly) return "empty.file.bodyReadOnly";
  if (!options.canImport) return "empty.file.bodyType";
  return options.touch ? "empty.file.bodyTouch" : "empty.file.body";
}

export function useEmptyHint(options: { readOnly: boolean; canImport: boolean }): string {
  const t = useT();
  const narrow = useIsNarrow();
  const dragCapable = useDragCapable();
  return t(emptyHintKey({ ...options, touch: narrow || !dragCapable }));
}
