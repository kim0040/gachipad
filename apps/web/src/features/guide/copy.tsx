import { formatNumber, type Locale } from "@gachipad/i18n";
import {
  createContext,
  type ReactNode,
  use,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
} from "react";
import { useLocale, useT } from "../../lib/i18n";
import type { GuideKey } from "./copy-en";
import { FACTS } from "./facts";

export type GuideParams = Record<string, string | number>;
export type GuideT = (key: GuideKey, params?: GuideParams) => string;
type Dictionary = Readonly<Record<GuideKey, string>>;

/** Values the admin controls, as the public settings endpoint reports them. */
export interface GuideSettings {
  expiryHours: number;
  historyDays: number;
  uploadMB: number;
  docMB: number;
}

export const DEFAULT_GUIDE_SETTINGS: GuideSettings = {
  expiryHours: FACTS.defaultExpiryHours,
  historyDays: FACTS.defaultHistoryDays,
  uploadMB: FACTS.defaultUploadMB,
  docMB: FACTS.defaultDocMB,
};

// Each language's text is its own chunk, imported when a guide page first needs it. The service
// worker precaches both (vite.config.ts), so they also download once per build for offline use.
const loading = new Map<Locale, Promise<Dictionary>>();

function loadDictionary(locale: Locale): Promise<Dictionary> {
  let promise = loading.get(locale);
  if (!promise) {
    promise =
      locale === "ko"
        ? import("./copy-ko").then((module) => module.guideKo)
        : import("./copy-en").then((module) => module.guideEn);
    // A failed fetch must not stay cached, or the next visit would fail the same way.
    promise.catch(() => loading.delete(locale));
    loading.set(locale, promise);
  }
  return promise;
}

function interpolate(locale: Locale, message: string, params?: GuideParams): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}

interface GuideValue {
  t: GuideT;
  settings: GuideSettings;
}

const GuideContext = createContext<GuideValue | null>(null);

/**
 * Loads the guide text for the current language and suspends until it is there. A language switch
 * keeps the old text on screen until the new one has arrived (no skeleton flash).
 */
export function GuideCopyProvider({
  settings,
  children,
}: {
  settings: GuideSettings;
  children: ReactNode;
}) {
  const [locale] = useLocale();
  const shown = useDeferredValue(locale);
  const dictionary = use(loadDictionary(shown));
  const value = useMemo<GuideValue>(
    () => ({
      t: (key, params) => interpolate(shown, dictionary[key], params),
      settings,
    }),
    [shown, dictionary, settings],
  );
  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

export function useGuide(): GuideValue {
  const value = useContext(GuideContext);
  if (!value) throw new Error("useGuide needs a GuideCopyProvider");
  return value;
}

/** The tab title of a guide page: its own name, then the product's. */
export function useGuideTitle(title: string) {
  const t = useT();
  useEffect(() => {
    document.title = `${title} – ${t("app.name")}`;
  }, [title, t]);
}
