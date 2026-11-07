import { Link } from "@tanstack/react-router";
import { useT } from "../../lib/i18n";
import { BroadcastArt, CodeArt, MergeArt, NearbyArt, QrArt, SendArt } from "../intro/art";
import { reveal } from "../intro/reveal";
import { Cards, GSection, GuidePage, Mock, P, Row, ShortcutKeys, Split, Yes } from "./blocks";
import { useGuide, useGuideTitle } from "./copy";
import { FACTS } from "./facts";
import { AccessMock } from "./parts";

export function HowPage() {
  const { t, settings } = useGuide();
  const app = useT();
  useGuideTitle(t("guide.how.title"));
  const toc = (["create", "tell", "edit", "files", "roles", "control", "offline"] as const).map(
    (id) => ({
      id,
      label: t(`guide.how.toc.${id}`),
    }),
  );
  const roleRows = [
    ["edit", true, true, false],
    ["history", true, false, false],
    ["access", true, false, false],
    ["remove", true, false, false],
    ["lock", true, false, false],
  ] as const;

  return (
    <GuidePage slug="how" title={t("guide.how.title")} lead={t("guide.how.lead")} toc={toc}>
      <GSection id="create" title={t("guide.how.create.title")}>
        <P>{t("guide.how.create.body1")}</P>
        <P>{t("guide.how.create.body2")}</P>
        <P>{app("intro.faq.expiry.a", { count: settings.expiryHours })}</P>
        <Link to="/guide/features" hash="templates" className="ix-more">
          {t("guide.how.create.templatesLink")}
        </Link>
      </GSection>

      <GSection id="tell" title={t("guide.how.tell.title")} lead={t("guide.how.tell.lead")}>
        <ul className="ix-grows">
          <Row
            Art={CodeArt}
            title={t("guide.how.tell.code.title")}
            body={t("guide.how.tell.code.body")}
          />
          <Row
            Art={QrArt}
            title={t("guide.how.tell.qr.title")}
            body={t("guide.how.tell.qr.body")}
            flip
          />
          <Row
            Art={NearbyArt}
            title={t("guide.how.tell.nearby.title")}
            body={t("guide.how.tell.nearby.body")}
          />
          <Row
            Art={SendArt}
            title={t("guide.how.tell.send.title")}
            body={t("guide.how.tell.send.body")}
            flip
          />
          <Row
            Art={BroadcastArt}
            title={t("guide.how.tell.room.title")}
            body={t("guide.how.tell.room.body")}
          />
        </ul>
        <P>
          {t("guide.how.tell.shortcut")} <ShortcutKeys id="share" />
        </P>
        <Link to="/guide/network" className="ix-more">
          {t("guide.how.tell.networkLink")}
        </Link>
      </GSection>

      <GSection id="edit" title={t("guide.how.edit.title")} lead={t("guide.how.edit.lead")}>
        <Split Art={MergeArt} flip>
          <Cards
            items={(["cursors", "follow", "files", "comments", "lock"] as const).map((key) => ({
              title: t(`guide.how.edit.${key}.title`),
              body: t(`guide.how.edit.${key}.body`),
            }))}
          />
        </Split>
      </GSection>

      <GSection id="files" title={t("guide.how.files.title")} lead={t("guide.how.files.lead")}>
        <Cards
          items={(["drag", "button", "paste", "zip"] as const).map((key) => ({
            title: t(`guide.how.files.${key}.title`),
            body: t(`guide.how.files.${key}.body`),
          }))}
        />
        <p className="ix-gsub">{t("guide.how.files.duplicate.title")}</p>
        <P>{t("guide.how.files.duplicate.body")}</P>
        <p className="ix-gsub">{t("guide.how.files.skipped.title")}</p>
        <P>
          {t("guide.how.files.skipped.body", {
            perFile: FACTS.importFileMB,
            max: FACTS.files,
            doc: FACTS.defaultDocMB,
          })}
        </P>
        <P>{t("guide.how.files.viewer")}</P>
      </GSection>

      <GSection id="roles" title={t("guide.how.roles.title")} lead={t("guide.how.roles.lead")}>
        <Cards
          items={(["owner", "edit", "view"] as const).map((key) => ({
            title: t(`guide.how.roles.${key}.title`),
            body: t(`guide.how.roles.${key}.body`),
          }))}
        />
        <P>{t("guide.how.roles.default")}</P>
        <div className="ix-table-wrap" {...reveal()}>
          <table className="ix-table ix-table-roles">
            <caption>{t("guide.how.roles.table.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("guide.how.roles.table.action")}</th>
                <th scope="col">{t("guide.how.roles.owner.title")}</th>
                <th scope="col">{t("guide.how.roles.edit.title")}</th>
                <th scope="col">{t("guide.how.roles.view.title")}</th>
              </tr>
            </thead>
            <tbody>
              {roleRows.map(([key, owner, editor, viewer]) => (
                <tr key={key}>
                  <th scope="row">{t(`guide.how.roles.table.${key}`)}</th>
                  <td>
                    <Yes yes={owner} />
                  </td>
                  <td>
                    <Yes yes={editor} />
                  </td>
                  <td>
                    <Yes yes={viewer} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>{t("guide.how.roles.table.note")}</P>
      </GSection>

      <GSection
        id="control"
        title={t("guide.how.control.title")}
        lead={t("guide.how.control.lead")}
      >
        <div className="ix-gsplit ix-gsplit-mock">
          <div className="ix-gsplit-text">
            <Cards
              items={[
                {
                  title: t("guide.how.control.view.title"),
                  body: t("guide.how.control.view.body"),
                },
                {
                  title: t("guide.how.control.pin.title"),
                  body: t("guide.how.control.pin.body", {
                    min: FACTS.pinMin,
                    max: FACTS.pinMax,
                    attempts: FACTS.pinAttempts,
                    minutes: FACTS.pinMinutes,
                  }),
                },
                {
                  title: t("guide.how.control.approval.title"),
                  body: t("guide.how.control.approval.body"),
                },
                {
                  title: t("guide.how.control.nearby.title"),
                  body: t("guide.how.control.nearby.body"),
                },
                {
                  title: t("guide.how.control.remove.title"),
                  body: t("guide.how.control.remove.body"),
                },
              ]}
            />
          </div>
          <Mock caption={t("guide.how.control.mock")}>
            <AccessMock />
          </Mock>
        </div>
      </GSection>

      <GSection id="offline" title={t("guide.how.offline.title")}>
        <P>{t("guide.how.offline.body1")}</P>
        <P>{t("guide.how.offline.body2")}</P>
        <P>{t("guide.how.offline.body3")}</P>
      </GSection>
    </GuidePage>
  );
}
