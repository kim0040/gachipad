import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useT } from "../../lib/i18n";
import { GuidePage } from "./blocks";
import { useGuide, useGuideTitle } from "./copy";
import { FACTS } from "./facts";
import { fragmentId } from "./fragment";
import { type FaqEntry, FaqGroup } from "./parts";

/** Questions by topic. Ids double as anchors (`/guide/faq#expiry`). */
const GROUPS = [
  { id: "start", keys: ["expiry", "save", "account", "phone", "run"] },
  { id: "people", keys: ["security", "cantEdit", "pin", "notNearby", "codeFails"] },
  {
    id: "edit",
    keys: [
      "languages",
      "offline",
      "size",
      "folder",
      "duplicate",
      "uploadFails",
      "cursors",
      "history",
    ],
  },
  { id: "network", keys: ["outside", "internet", "tracking", "shared", "contact"] },
] as const;

/** Questions that were on the home page keep their texts there. */
const FROM_HOME = new Set(["expiry", "save", "security", "languages", "outside", "phone"]);

const QUESTIONS: ReadonlySet<string> = new Set(GROUPS.flatMap((group) => group.keys));

/** The question the address points at, if it points at one. */
function linkedQuestion(): string | null {
  const id = typeof window === "undefined" ? "" : fragmentId(window.location.hash);
  return QUESTIONS.has(id) ? id : null;
}

function initialOpen(): Set<string> {
  return new Set([linkedQuestion() ?? "expiry"]);
}

export function FaqPage() {
  const { t, settings } = useGuide();
  const app = useT();
  useGuideTitle(t("guide.faq.title"));
  const [open, setOpen] = useState(initialOpen);

  // A link to another question while the page is open (Back, Forward, a link in an answer) opens
  // that answer too; GuidePage scrolls to it.
  const hash = useRouterState({ select: (state) => state.location.hash });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the router's hash says the address changed
  useEffect(() => {
    const id = linkedQuestion();
    if (id) setOpen((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, [hash]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const entry = (key: string): FaqEntry => {
    if (FROM_HOME.has(key)) {
      const answer =
        key === "expiry"
          ? app("intro.faq.expiry.a", { count: settings.expiryHours })
          : app(`intro.faq.${key as "save"}.a`);
      return { id: key, question: app(`intro.faq.${key as "save"}.q`), answer };
    }
    const params = {
      upload: settings.uploadMB,
      max: FACTS.files,
      perFile: FACTS.importFileMB,
    };
    return {
      id: key,
      question: t(`guide.faq.${key as "account"}.q`),
      answer: t(`guide.faq.${key as "account"}.a`, params),
    };
  };

  const toc = GROUPS.map(({ id }) => ({ id, label: t(`guide.faq.group.${id}`) }));

  return (
    <GuidePage slug="faq" title={t("guide.faq.title")} lead={t("guide.faq.lead")} toc={toc}>
      {GROUPS.map(({ id, keys }) => (
        <div id={id} key={id} className="ix-ganchor">
          <FaqGroup
            title={t(`guide.faq.group.${id}`)}
            entries={keys.map(entry)}
            open={open}
            onToggle={toggle}
          />
        </div>
      ))}
    </GuidePage>
  );
}
