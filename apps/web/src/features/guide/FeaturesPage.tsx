import { Link } from "@tanstack/react-router";
import { useT } from "../../lib/i18n";
import { DownloadArt, FilesArt, HistoryArt, MergeArt } from "../intro/art";
import { Cards, GSection, GuidePage, P, ShortcutKeys, Split } from "./blocks";
import { useGuide, useGuideTitle } from "./copy";
import { EDITOR_FACTS, FACTS } from "./facts";
import { LanguageBrowser, ShortcutTables, TemplateNames } from "./parts";

const SECTIONS = [
  "languages",
  "merge",
  "files",
  "history",
  "download",
  "shortcuts",
  "settings",
  "cursors",
  "lab",
  "templates",
  "more",
] as const;

export function FeaturesPage() {
  const { t, settings } = useGuide();
  const app = useT();
  useGuideTitle(t("guide.features.title"));
  const toc = SECTIONS.map((id) => ({ id, label: t(`guide.features.toc.${id}`) }));

  return (
    <GuidePage
      slug="features"
      title={t("guide.features.title")}
      lead={t("guide.features.lead")}
      toc={toc}
    >
      <GSection id="languages" title={t("guide.features.languages.title")}>
        <P>{t("guide.features.languages.body1")}</P>
        <P>{t("guide.features.languages.body2")}</P>
        <LanguageBrowser />
      </GSection>

      <GSection id="merge" title={t("guide.features.merge.title")}>
        <Split Art={MergeArt}>
          <P>{t("guide.features.merge.body1")}</P>
          <P>{t("guide.features.merge.body2")}</P>
        </Split>
      </GSection>

      <GSection id="files" title={t("guide.features.files.title")}>
        <Split Art={FilesArt} flip>
          <P>{t("guide.features.files.body1", { max: FACTS.files })}</P>
          <P>{t("guide.features.files.body2")}</P>
          <Link to="/guide/how" hash="files" className="ix-more">
            {t("guide.features.files.more")}
          </Link>
          <P>
            {t("guide.features.files.body3", {
              upload: settings.uploadMB,
              doc: settings.docMB,
            })}
          </P>
        </Split>
      </GSection>

      <GSection id="history" title={t("guide.features.history.title")}>
        <Split Art={HistoryArt}>
          <P>{t("guide.features.history.body1")}</P>
          <P>
            {t("guide.features.history.body2", {
              seconds: FACTS.historySeconds,
              max: FACTS.historyMax,
              days: settings.historyDays,
            })}
          </P>
          <P>{t("guide.features.history.body3")}</P>
          <P>{t("guide.features.history.body4")}</P>
        </Split>
      </GSection>

      <GSection id="download" title={t("guide.features.download.title")}>
        <Split Art={DownloadArt} flip>
          <P>{t("guide.features.download.body")}</P>
        </Split>
      </GSection>

      <GSection
        id="shortcuts"
        title={t("guide.features.shortcuts.title")}
        lead={t("guide.features.shortcuts.lead")}
      >
        <ShortcutTables />
        <P>{t("guide.features.shortcuts.note1")}</P>
        <P>{t("guide.features.shortcuts.note2")}</P>
        <P>{t("guide.features.shortcuts.note3")}</P>
      </GSection>

      <GSection id="settings" title={t("guide.features.settings.title")}>
        <P>
          {t("guide.features.settings.lead")} <ShortcutKeys id="settings" />
        </P>
        <Cards
          items={[
            {
              title: t("guide.features.settings.theme.title"),
              body: t("guide.features.settings.theme.body"),
            },
            {
              title: t("guide.features.settings.editorTheme.title"),
              body: t("guide.features.settings.editorTheme.body"),
            },
            {
              title: t("guide.features.settings.font.title"),
              body: t("guide.features.settings.font.body", {
                min: EDITOR_FACTS.fontMin,
                max: EDITOR_FACTS.fontMax,
                default: EDITOR_FACTS.fontDefault,
              }),
            },
            {
              title: t("guide.features.settings.indent.title"),
              body: t("guide.features.settings.indent.body"),
            },
            {
              title: t("guide.features.settings.keymap.title"),
              body: t("guide.features.settings.keymap.body"),
            },
            {
              title: t("guide.features.settings.smooth.title"),
              body: t("guide.features.settings.smooth.body"),
            },
            {
              title: t("guide.features.settings.notify.title"),
              body: t("guide.features.settings.notify.body"),
            },
            {
              title: t("guide.features.settings.language.title"),
              body: t("guide.features.settings.language.body"),
            },
          ]}
        />
      </GSection>

      <GSection
        id="cursors"
        title={t("guide.features.cursors.title")}
        lead={t("guide.features.cursors.lead")}
      >
        <Cards
          items={(["auto", "moving", "always", "carets"] as const).map((key) => ({
            title: t(`guide.features.cursors.${key}.title`),
            body: t(`guide.features.cursors.${key}.body`, { crowd: FACTS.cursorCrowd }),
          }))}
        />
        <P>{t("guide.features.cursors.hover")}</P>
      </GSection>

      <GSection id="lab" title={t("guide.features.lab.title")} lead={t("guide.features.lab.lead")}>
        <Cards
          items={(["start", "grid", "help", "send", "lock"] as const).map((key) => ({
            title: t(`guide.features.lab.${key}.title`),
            body: t(`guide.features.lab.${key}.body`),
          }))}
        />
        <P>{t("guide.features.lab.note")}</P>
      </GSection>

      <GSection id="templates" title={t("guide.features.templates.title")}>
        <P>{t("guide.features.templates.body1")}</P>
        <p className="ix-gsub">{t("guide.features.templates.builtIn")}</p>
        <TemplateNames />
        <P>{t("guide.features.templates.body2")}</P>
      </GSection>

      <GSection id="more" title={t("guide.features.more.title")}>
        <Cards
          items={[
            {
              title: t("guide.features.more.palette.title"),
              body: (
                <>
                  {t("guide.features.more.palette.body")} <ShortcutKeys id="palette" />
                </>
              ),
            },
            {
              title: t("guide.features.more.shares.title"),
              body: t("guide.features.more.shares.body", { tags: FACTS.tags }),
            },
            {
              title: t("guide.features.more.format.title"),
              body: (
                <>
                  {t("guide.features.more.format.body")} <ShortcutKeys id="format" />
                </>
              ),
            },
            {
              title: t("guide.features.more.secret.title"),
              body: t("guide.features.more.secret.body"),
            },
          ]}
        />
        <Link to="/guide/security" className="ix-more">
          {app("intro.nav.security")}
        </Link>
      </GSection>
    </GuidePage>
  );
}
