import { defaultSettings } from "@gachipad/shared";
import { Button, Dialog, DialogContent, Spinner, toast } from "@gachipad/ui";
import { FolderUp, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { usePublicSettings } from "../../lib/public-settings";
import { useDocumentPermissions, useEditor } from "./context";
import { useFilesDenial } from "./drop-permissions";
import { collectDrop, type DroppedFiles } from "./dropped-files";
import { type ImportResult, importFiles } from "./import-files";
import { summarizeImport } from "./import-summary";

/** Files longer to read than this show a progress toast while they are read. */
const HEAVY_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DOC_BYTES = defaultSettings().maxDocBytes;

/**
 * Adds dropped or picked files (and folders, and .zip archives) to the open share and reports what
 * happened. Every entry point (page drop, editor drop, paste, the upload dialog) comes through here.
 */
export function useImport() {
  const t = useT();
  const ctx = useEditor();
  const canImport = useDocumentPermissions().files;
  const canChangeLanguage = useDocumentPermissions().language;
  const denial = useFilesDenial();
  const settings = usePublicSettings();
  const allowed = useRef({ files: canImport, language: canChangeLanguage });
  allowed.current = { files: canImport, language: canChangeLanguage };
  const limit = useRef<number | undefined>(undefined);
  limit.current = ctx.state.tooLarge ?? settings?.maxDocBytes ?? DEFAULT_MAX_DOC_BYTES;
  return async (input: File[] | DroppedFiles): Promise<ImportResult | null> => {
    const { files, skipped } = Array.isArray(input) ? { files: input, skipped: [] } : input;
    if (!canImport) {
      toast({ title: t(denial ?? "upload.denied.ownerOnly"), tone: "warning" });
      return null;
    }
    if (files.length === 0) {
      for (const summary of summarizeImport(t, {
        added: 0,
        addedPaths: [],
        renamed: [],
        duplicates: [],
        skipped,
      }))
        toast(summary);
      return null;
    }
    // Reading is mostly quick; a big drop or an archive gets a toast first, painted before the work.
    const heavy =
      files.length > 5 ||
      files.some((file) => file.size > HEAVY_BYTES || /\.zip$/i.test(file.name));
    const progress = heavy
      ? toast({
          title: t("toast.import.reading", { count: files.length }),
          tone: "neutral",
          duration: 120_000,
        })
      : null;
    if (progress) await new Promise<void>((resolve) => setTimeout(resolve, 50));
    try {
      const result = await importFiles(ctx.doc, files, {
        skipped,
        canChangeLanguage: () => allowed.current.language,
        mayApply: () => allowed.current.files,
        maxDocBytes: () => limit.current,
      });
      if (result.refused) {
        toast({ title: t("upload.denied.ownerOnly"), tone: "warning" });
        return result;
      }
      if (result.firstId) ctx.setActiveFileId(result.firstId);
      for (const summary of summarizeImport(t, result)) toast(summary);
      return result;
    } catch {
      toast({ title: t("toast.uploadFailed"), tone: "danger" });
      return null;
    } finally {
      if (progress) toast.dismiss(progress);
    }
  };
}

export function UploadDialog() {
  const t = useT();
  const ctx = useEditor();
  const canImport = useDocumentPermissions().files;
  const run = useImport();
  const open = canImport && ctx.panel.name === "upload";
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const handle = async (input: File[] | DroppedFiles) => {
    const count = Array.isArray(input) ? input.length : input.files.length;
    setBusy(Math.max(1, count));
    await run(input);
    setBusy(0);
    ctx.closePanel();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && ctx.closePanel()}>
      <DialogContent size="md" title={t("upload.title")} closeLabel={t("common.close")}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the buttons inside do the same job from the keyboard */}
        <div
          role="presentation"
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            void collectDrop(event.dataTransfer).then(handle);
          }}
          data-drop-over={over || undefined}
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-line-strong p-8 text-center"
          data-testid="upload-zone"
        >
          {busy > 0 ? (
            <Spinner label={t("upload.progress", { count: busy })} />
          ) : (
            <>
              <Upload aria-hidden="true" className="size-6 text-fg-3" />
              <p className="text-body-sm">{t("upload.dropHint")}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => filesInput.current?.click()} leading={<Upload />}>
                  {t("upload.browseAction")}
                </Button>
                <Button onClick={() => folderInput.current?.click()} leading={<FolderUp />}>
                  {t("upload.folderAction")}
                </Button>
              </div>
            </>
          )}
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            data-testid="upload-input"
            onChange={(event) => void handle(Array.from(event.target.files ?? []))}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            // @ts-expect-error non-standard attribute for picking a folder
            webkitdirectory=""
            onChange={(event) => void handle(Array.from(event.target.files ?? []))}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
