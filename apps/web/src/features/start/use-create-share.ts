import type { MessageKey } from "@gachipad/i18n";
import { MAX_FILES_PER_SHARE, type Template } from "@gachipad/shared";
import { toast } from "@gachipad/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, isApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useT } from "../../lib/i18n";
import type { DroppedFiles } from "../editor/dropped-files";
import { skipToast } from "../editor/import-summary";

/** Creating a share, empty or from files, and opening it. */
export function useCreateShare() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const open = async (id: string) => {
    void queryClient.invalidateQueries({ queryKey: ["shares"] });
    await navigate({ to: "/$id", params: { id } });
  };

  const fail = (error: unknown) => {
    const text = errorText(error);
    toast({
      title: t(text.title),
      description: text.hint ? t(text.hint) : undefined,
      tone: "danger",
    });
  };

  return {
    pending,
    createEmpty: async () => {
      setPending(true);
      try {
        const created = await api.createShare({});
        await open(created.id);
      } catch (error) {
        fail(error);
      } finally {
        setPending(false);
      }
    },
    /** Creates a share with the files of a template and opens it; true when it worked. */
    createFromTemplate: async (template: Template) => {
      setPending(true);
      try {
        const created = await api.createShare({
          title: template.builtin ? t(template.name as MessageKey) : template.name,
          language: template.language,
          files: template.files,
        });
        await open(created.id);
        return true;
      } catch (error) {
        fail(error);
        return false;
      } finally {
        setPending(false);
      }
    },
    /**
     * Creates a share from dropped or picked files. Every failure says what went wrong: too many
     * files, nothing readable as text, too large, over a quota or rate limit, offline.
     */
    createFromFiles: async (input: File[] | DroppedFiles) => {
      const { files, skipped } = Array.isArray(input) ? { files: input, skipped: [] } : input;
      if (files.length === 0) {
        const none = skipToast(t, skipped);
        toast(none ?? { title: t("toast.import.empty"), tone: "warning" });
        return;
      }
      if (files.length > MAX_FILES_PER_SHARE) {
        toast({ title: t("editor.files.limit", { max: MAX_FILES_PER_SHARE }), tone: "warning" });
        return;
      }
      setPending(true);
      try {
        const created = (await api.upload(files, { asShare: true })) as { id: string };
        await open(created.id);
        const extra = skipToast(t, skipped);
        if (extra) toast(extra);
      } catch (error) {
        if (isApiError(error, "validation")) {
          toast({
            title: t("toast.upload.noText"),
            description: t("toast.upload.noText.hint"),
            tone: "warning",
          });
        } else fail(error);
      } finally {
        setPending(false);
      }
    },
  };
}
