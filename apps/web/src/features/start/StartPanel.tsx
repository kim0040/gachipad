import { getLanguage } from "@gachipad/highlight";
import { formatRelativeTime } from "@gachipad/i18n";
import { Button, EmptyState, LanguageBadge, PinInput, Skeleton, Spinner } from "@gachipad/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { History, LayoutTemplate, Plus, Radar, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api, isApiError } from "../../lib/api";
import { useEventsSnapshot } from "../../lib/events";
import { firstLines } from "../../lib/format";
import { useLocale, useT } from "../../lib/i18n";
import { openTemplates } from "../../lib/overlays";
import { useSession } from "../../lib/session";
import { FileDropOverlay } from "../app/FileDropOverlay";
import { useFileDrop } from "../app/file-drop";
import { collectDrop } from "../editor/dropped-files";
import { useCreateShare } from "./use-create-share";

const CODE_LENGTH = 6;
const RECENT_COUNT = 4;

/**
 * The start of every visit: create a share, enter a 6-digit code, pick a nearby share or reopen a
 * recent one. The intro page embeds it; it works on its own on a 320px screen.
 */
export function StartPanel({ className }: { className?: string }) {
  const t = useT();
  const create = useCreateShare();
  // Files dropped anywhere on the page start a new share; the overlay says so, and keeps saying it
  // (with a spinner) while the share is created.
  const createRef = useRef(create.createFromFiles);
  createRef.current = create.createFromFiles;
  const [dropping, setDropping] = useState(false);
  const dropOverlay = useFileDrop({
    mode: "create",
    denied: null,
    busy: dropping,
    onDrop: (transfer) => {
      setDropping(true);
      // Read the transfer now, in the event: the browser empties it afterwards.
      void collectDrop(transfer)
        .then((dropped) => createRef.current(dropped))
        .finally(() => setDropping(false));
    },
  });

  return (
    <div className={`flex flex-col gap-8 ${className ?? ""}`} data-testid="start-panel">
      <FileDropOverlay view={dropOverlay} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Button
          variant="primary"
          size="lg"
          leading={<Plus />}
          loading={create.pending}
          loadingLabel={t("common.loading")}
          onClick={() => void create.createEmpty()}
          data-testid="new-share"
          className="sm:shrink-0"
        >
          {t("share.new")}
        </Button>
        <Button
          size="lg"
          leading={<LayoutTemplate />}
          onClick={openTemplates}
          data-testid="new-from-template"
          className="sm:shrink-0"
        >
          {t("template.startAction")}
        </Button>
        <p className="flex items-center gap-1.5 text-caption text-fg-3">
          <Upload aria-hidden="true" className="size-3.5 shrink-0" />
          {t("upload.dropHint")}
        </p>
      </div>

      <JoinByCode />
      <Nearby />
      <Recent />
    </div>
  );
}

function JoinByCode() {
  const t = useT();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (code: string) => {
    if (code.length !== CODE_LENGTH) {
      setError(t("intro.join.incomplete"));
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const target = await api.resolveCode(code);
      if ("id" in target) await navigate({ to: "/$id", params: { id: target.id } });
      else await navigate({ to: "/lab/$id", params: { id: target.labId } });
    } catch (e) {
      setError(
        isApiError(e, "not_found") || isApiError(e, "expired") || isApiError(e, "validation")
          ? t("error.not_found")
          : t(isApiError(e, "rate_limited") ? "error.rate_limited" : "error.network"),
      );
      setValue("");
    } finally {
      setChecking(false);
    }
  };

  return (
    <section aria-labelledby="join-title" className="flex flex-col gap-2">
      <h2 id="join-title" className="text-body-sm font-semibold">
        {t("share.joinWithCode")}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <PinInput
          aria-label={t("a11y.pinGroup", { count: CODE_LENGTH })}
          getDigitLabel={(position, total) => t("a11y.pinDigit", { index: position, count: total })}
          value={value}
          onValueChange={(next) => {
            setValue(next);
            if (error) setError(null);
          }}
          onComplete={(code) => void submit(code)}
          invalid={error !== null}
          disabled={checking}
          length={CODE_LENGTH}
        />
        {checking ? <Spinner size="sm" label={t("intro.join.checking")} /> : null}
        <Button onClick={() => void submit(value)} disabled={checking} data-testid="join-submit">
          {t("intro.join.submitAction")}
        </Button>
      </div>
      <p
        role={error ? "alert" : undefined}
        className={`text-caption ${error ? "text-danger-text" : "text-fg-3"}`}
      >
        {error ?? t("intro.join.hint")}
      </p>
    </section>
  );
}

function Nearby() {
  const t = useT();
  const { nearby, ready, connected } = useEventsSnapshot();
  const session = useSession();
  if (session.data?.net.startsWith("client:")) return null;
  return (
    <section aria-labelledby="nearby-title" className="flex flex-col gap-3" data-testid="nearby">
      <h2 id="nearby-title" className="flex items-center gap-2 text-body-sm font-semibold">
        <Radar aria-hidden="true" className="size-4 text-fg-3" />
        {t("nearby.title")}
      </h2>
      {!ready && connected ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t("nearby.loading")}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : !ready ? (
        <EmptyState
          size="sm"
          tone="danger"
          title={t("nearby.error.title")}
          description={t("nearby.error.body")}
        />
      ) : nearby.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Radar />}
          title={t("nearby.empty.title")}
          description={t("nearby.empty.body")}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {nearby.map((item) => {
            const language = getLanguage(item.language);
            return (
              <li key={item.id} className="ui-appear">
                <Link
                  to="/$id"
                  params={{ id: item.id }}
                  className="group flex h-full flex-col gap-2 rounded-xl border border-line bg-panel p-3 transition-[border-color,scale] duration-(--duration-fast) ease-out hover:border-fg-3 motion-safe:active:scale-[0.99]"
                  data-testid={`nearby-${item.id}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-body-sm font-medium">
                      {item.title || t("common.untitled")}
                    </span>
                    <span className="shrink-0 text-caption text-fg-3">
                      {t("nearby.people", { count: item.participants })}
                    </span>
                  </span>
                  <LanguageBadge
                    name={language?.name ?? item.language}
                    color={language?.color ?? "#8b949e"}
                  />
                  <pre className="max-h-24 overflow-hidden rounded-md bg-bg p-2 font-mono text-[0.6875rem] leading-snug text-fg-2">
                    {firstLines(item.preview, 6)}
                  </pre>
                  <span className="text-caption font-medium text-accent-text group-hover:underline">
                    {t("nearby.joinAction")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Recent() {
  const t = useT();
  const [locale] = useLocale();
  const shares = useQuery({
    queryKey: ["shares"],
    queryFn: ({ signal }) => api.listShares(signal),
    retry: false,
  });
  const recent = [...(shares.data ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_COUNT);

  if (shares.isPending) {
    return (
      <section className="flex flex-col gap-2" aria-busy="true" aria-label={t("myshares.loading")}>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12" />
      </section>
    );
  }
  if (shares.isError || recent.length === 0) return null;
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-2" data-testid="recent">
      <div className="flex items-center justify-between gap-2">
        <h2 id="recent-title" className="flex items-center gap-2 text-body-sm font-semibold">
          <History aria-hidden="true" className="size-4 text-fg-3" />
          {t("myshares.title")}
        </h2>
        <Link to="/me" className="text-caption text-accent-text hover:underline">
          {t("myshares.openAction")}
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-panel">
        {recent.map((share) => {
          const language = getLanguage(share.language);
          return (
            <li key={share.id} className="ui-appear-fade">
              <Link
                to="/$id"
                params={{ id: share.id }}
                className="flex min-h-12 items-center gap-3 px-3 py-2 transition-colors duration-(--duration-fast) ease-out hover:bg-fill-hover"
              >
                <span className="min-w-0 flex-1 truncate text-body-sm">
                  {share.title || t("common.untitled")}
                </span>
                <LanguageBadge
                  name={language?.name ?? share.language}
                  color={language?.color ?? "#8b949e"}
                  className="max-sm:hidden"
                />
                <span className="shrink-0 text-caption text-fg-3">
                  {formatRelativeTime(locale, new Date(share.updatedAt).getTime() - Date.now())}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
