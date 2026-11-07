import type { MessageKey } from "@gachipad/i18n";
import { defaultSettings, type Template } from "@gachipad/shared";
import { toast } from "@gachipad/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, isApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useT } from "../../lib/i18n";
import { setTemplatesOpen } from "../../lib/overlays";
import { usePublicSettings } from "../../lib/public-settings";
import { collectDrop, type DroppedFiles } from "../editor/dropped-files";
import { readForNewShare } from "../editor/import-files";
import { skipToast, summarizeImport } from "../editor/import-summary";
import { markDropTipDone } from "../tour/drop-tip";
import { beginCreate, type CreateRun, createPending, subscribeCreatePending } from "./create-run";

const DEFAULT_MAX_DOC_BYTES = defaultSettings().maxDocBytes;
const MB = 1024 * 1024;

/** Creating a share, empty or from files, and opening it. */
export function useCreateShare() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = usePublicSettings();
  const pending = useSyncExternalStore(subscribeCreatePending, createPending, () => false);
  const [pendingFiles, setPendingFiles] = useState(false);
  const own = useRef<CreateRun | null>(null);

  // Leaving before the share exists: nothing goes on behind the next page's back.
  useEffect(() => () => own.current?.cancel(), []);

  const start = (): CreateRun | null => {
    const run = beginCreate(() => {
      setPendingFiles(false);
      toast({
        title: t("toast.create.timeout"),
        description: t("toast.create.timeout.hint"),
        tone: "danger",
      });
    });
    if (run) own.current = run;
    return run;
  };

  /** False when the run ended first: there is nothing to open any more. */
  const open = async (id: string, run: CreateRun): Promise<boolean> => {
    if (!run.live()) return false;
    run.commit();
    void queryClient.invalidateQueries({ queryKey: ["shares"] });
    await navigate({ to: "/$id", params: { id } });
    return true;
  };

  const fail = (error: unknown) => {
    const text = errorText(error);
    toast({
      title: t(text.title),
      description: text.hint ? t(text.hint) : undefined,
      tone: "danger",
    });
  };

  /**
   * Every failure says what went wrong: too many files, nothing readable as text, too large, over a
   * quota or rate limit, offline. The files go through the same reader as adding to an open share,
   * and the server gets the normalised text.
   */
  const fromFiles = async (run: CreateRun, input: File[] | DroppedFiles) => {
    const { files, skipped } = Array.isArray(input) ? { files: input, skipped: [] } : input;
    try {
      if (!run.live()) return;
      if (files.length === 0) {
        const none = skipToast(t, skipped);
        toast(none ?? { title: t("toast.import.empty"), tone: "warning" });
        return;
      }
      const prepared = await readForNewShare(files, {
        skipped,
        maxDocBytes: () => settings?.maxDocBytes ?? DEFAULT_MAX_DOC_BYTES,
      });
      if (!run.live()) return;
      if (prepared.files.length === 0) {
        const none = skipToast(t, prepared.result.skipped);
        toast(none ?? { title: t("toast.import.empty"), tone: "warning" });
        return;
      }
      const total = prepared.files.reduce((sum, file) => sum + file.size, 0);
      if (settings && total > settings.maxUploadMB * MB) {
        toast({
          title: t("toast.upload.overLimit", { size: settings.maxUploadMB }),
          description: t("error.too_large.hint"),
          tone: "warning",
        });
        return;
      }
      const created = (await api.upload(prepared.files, {
        asShare: true,
        signal: run.signal,
      })) as { id: string };
      if (!(await open(created.id, run))) return;
      setTemplatesOpen(false);
      markDropTipDone();
      const { result } = prepared;
      if (result.renamed.length > 0 || result.duplicates.length > 0 || result.skipped.length > 0) {
        for (const summary of summarizeImport(t, result)) toast(summary);
      }
    } catch (error) {
      if (!run.live()) return;
      if (isApiError(error, "validation")) {
        toast({
          title: t("toast.upload.noText"),
          description: t("toast.upload.noText.hint"),
          tone: "warning",
        });
      } else fail(error);
    } finally {
      run.finish();
      setPendingFiles(false);
    }
  };

  return {
    pending,
    /** Files are being read and uploaded (as opposed to an empty share being made). */
    pendingFiles,
    createEmpty: async () => {
      const run = start();
      if (!run) return;
      try {
        const created = await api.createShare({}, run.signal);
        await open(created.id, run);
      } catch (error) {
        if (run.live()) fail(error);
      } finally {
        run.finish();
      }
    },
    /** Creates a share with the files of a template and opens it; true when it worked. */
    createFromTemplate: async (template: Template) => {
      const run = start();
      if (!run) return false;
      try {
        const created = await api.createShare(
          {
            title: template.builtin ? t(template.name as MessageKey) : template.name,
            language: template.language,
            files: template.files,
          },
          run.signal,
        );
        return await open(created.id, run);
      } catch (error) {
        if (run.live()) fail(error);
        return false;
      } finally {
        run.finish();
      }
    },
    /** Creates a share from picked files. */
    createFromFiles: async (input: File[] | DroppedFiles) => {
      const run = start();
      if (!run) return;
      setPendingFiles(true);
      await fromFiles(run, input);
    },
    /**
     * Creates a share from a drop. Called inside the drop event: the transfer is read before the
     * first await, because the browser empties it afterwards.
     */
    createFromDrop: (transfer: DataTransfer) => {
      const run = start();
      if (!run) return;
      setPendingFiles(true);
      void collectDrop(transfer).then((dropped) => fromFiles(run, dropped));
    },
  };
}
