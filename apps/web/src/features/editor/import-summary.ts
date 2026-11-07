import type { MessageKey, TFunction } from "@gachipad/i18n";
import { MAX_FILES_PER_SHARE } from "@gachipad/shared";
import type { Skip, SkipReason } from "./dropped-files";
import { type ImportResult, MAX_FILE_BYTES } from "./import-files";

/** The toasts an import ends with, built from its result. No React, no side effects. */

export interface SummaryToast {
  title: string;
  description?: string;
  tone: "success" | "neutral" | "warning";
  duration?: number;
}

/** Named skips listed before "and N more". */
export const NAMED_SKIPS = 3;
const NAME_LIMIT = 40;

const REASON_KEY: Record<SkipReason, MessageKey> = {
  binary: "toast.import.reason.binary",
  tooBig: "toast.import.reason.tooBig",
  unreadable: "toast.import.reason.unreadable",
  folder: "toast.import.reason.folder",
  excludedFolder: "toast.import.reason.excludedFolder",
  tooMany: "toast.import.reason.tooMany",
  shareFull: "toast.import.reason.shareFull",
  badPath: "toast.import.reason.badPath",
  zipTooMany: "toast.import.reason.zipTooMany",
  zipTooBig: "toast.import.reason.zipTooBig",
  zipBad: "toast.import.reason.zipBad",
};

const shorten = (name: string) =>
  name.length > NAME_LIMIT ? `…${name.slice(name.length - NAME_LIMIT + 1)}` : name;

export function skipReasonText(t: TFunction, reason: SkipReason): string {
  return t(REASON_KEY[reason], {
    size: `${MAX_FILE_BYTES / (1024 * 1024)}MB`,
    max: MAX_FILES_PER_SHARE,
  });
}

const countOf = (skip: Skip) => skip.count ?? 1;

/**
 * "Skipped 5 items: a.png (not a text file), b.bin (...), c.exe (...) and 2 more". Entries without
 * a name (the tail of a folder that was too big to walk) are counted, not listed.
 */
export function skipDescription(t: TFunction, skipped: readonly Skip[]): string {
  const total = skipped.reduce((sum, skip) => sum + countOf(skip), 0);
  const named = skipped.filter((skip) => skip.name !== "").slice(0, NAMED_SKIPS);
  const listed = named.reduce((sum, skip) => sum + countOf(skip), 0);
  const parts = named.map((skip) => `${shorten(skip.name)} (${skipReasonText(t, skip.reason)})`);
  if (total > listed) {
    const unnamed = skipped.find((skip) => skip.name === "");
    parts.push(
      named.length === 0 && unnamed
        ? t("toast.import.skipTail", {
            count: total - listed,
            reason: skipReasonText(t, unnamed.reason),
          })
        : t("toast.import.more", { count: total - listed }),
    );
  }
  return parts.join(", ");
}

/** A warning toast for skips alone (a landing-page drop has no import result). */
export function skipToast(t: TFunction, skipped: readonly Skip[]): SummaryToast | null {
  if (skipped.length === 0) return null;
  const total = skipped.reduce((sum, skip) => sum + countOf(skip), 0);
  return {
    title: t("toast.import.skipped", { count: total }),
    description: skipDescription(t, skipped),
    tone: "warning",
    duration: 9000,
  };
}

export function summarizeImport(
  t: TFunction,
  result: Pick<ImportResult, "added" | "addedPaths" | "renamed" | "duplicates" | "skipped">,
): SummaryToast[] {
  const notes: string[] = [];
  for (const { from, to } of result.renamed.slice(0, 1)) {
    notes.push(t("toast.import.renamed", { from: shorten(from), to: shorten(to) }));
  }
  if (result.renamed.length > 1) {
    notes.push(t("toast.import.renamedMore", { count: result.renamed.length - 1 }));
  }
  if (result.duplicates.length === 1) {
    notes.push(t("toast.import.duplicate", { name: shorten(result.duplicates[0] as string) }));
  } else if (result.duplicates.length > 1) {
    notes.push(t("toast.import.duplicateMany", { count: result.duplicates.length }));
  }

  const toasts: SummaryToast[] = [];
  const description = notes.length > 0 ? notes.join(" ") : undefined;
  if (result.added === 1) {
    toasts.push({
      title: t("toast.import.added", { name: shorten(result.addedPaths[0] as string) }),
      description,
      tone: "success",
      duration: description ? 8000 : undefined,
    });
  } else if (result.added > 1) {
    toasts.push({
      title: t("toast.import.addedMany", { count: result.added }),
      description,
      tone: "success",
      duration: description ? 8000 : undefined,
    });
  } else if (result.duplicates.length > 0) {
    toasts.push({
      title:
        result.duplicates.length === 1
          ? t("toast.import.openedDuplicate", { name: shorten(result.duplicates[0] as string) })
          : t("toast.import.openedDuplicateMany", { count: result.duplicates.length }),
      tone: "neutral",
    });
  }

  if (result.skipped.length > 0) {
    if (toasts.length > 0) {
      const extra = skipToast(t, result.skipped);
      if (extra) toasts.push(extra);
    } else {
      toasts.push({
        title: t("toast.import.none"),
        description: skipDescription(t, result.skipped),
        tone: "warning",
        duration: 9000,
      });
    }
  } else if (toasts.length === 0) {
    toasts.push({ title: t("toast.import.empty"), tone: "warning" });
  }
  return toasts;
}
