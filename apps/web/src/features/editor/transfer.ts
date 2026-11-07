import { toast } from "@gachipad/ui";
import { type DragEvent, useState } from "react";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useT } from "../../lib/i18n";
import { FILE_DROP_TARGET_ATTR } from "../app/file-drop";
import { collectDroppedFiles } from "./dropped-files";

/** MIME type used while dragging a file tab or tree row of this share. */
export const FILE_DRAG_TYPE = "application/x-gachipad-file";

export function setFileDrag(event: DragEvent, fileId: string): void {
  event.dataTransfer.setData(FILE_DRAG_TYPE, fileId);
  event.dataTransfer.setData("text/plain", fileId);
  event.dataTransfer.effectAllowed = "copy";
}

/**
 * Makes an element accept a dragged file tab (sends that file) or dropped files from the desktop
 * (uploads them, then sends). `to` is a client id, or "net" for everyone on the network.
 */
export function useTransferTarget(shareId: string, to: string, name: string) {
  const t = useT();
  const [over, setOver] = useState(false);

  const accepts = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).some(
      (type) => type === FILE_DRAG_TYPE || type === "Files",
    );

  return {
    over,
    props: {
      // The page-level drop handling leaves a drag over this element to it.
      [FILE_DROP_TARGET_ATTR]: "",
      onDragEnter: (event: DragEvent) => {
        if (accepts(event)) {
          event.preventDefault();
          setOver(true);
        }
      },
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent) => {
        setOver(false);
        if (!accepts(event)) return;
        event.preventDefault();
        const fileId = event.dataTransfer.getData(FILE_DRAG_TYPE);
        if (fileId) {
          void api
            .invite({ to: to as never, shareId, fileId })
            .then(() => toast({ title: t("toast.sent", { name }), tone: "success" }))
            .catch(() => toast({ title: t("error.generic"), tone: "danger" }));
          return;
        }
        void collectDroppedFiles(event.dataTransfer).then(async (files) => {
          if (files.length === 0) return;
          try {
            const uploaded = (await api.upload(files)) as { uploadId: string }[];
            for (const result of uploaded) {
              await api.invite({ to: to as never, shareId, uploadId: result.uploadId });
            }
            toast({ title: t("toast.sent", { name }), tone: "success" });
          } catch (error) {
            const text = errorText(error);
            toast({
              title: t(text.title),
              description: text.hint ? t(text.hint) : undefined,
              tone: "danger",
            });
          }
        });
      },
    },
  };
}
