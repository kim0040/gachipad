import { Outlet, useRouterState } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useT } from "../../lib/i18n";
import { usePublicSettings } from "../../lib/public-settings";
import { usePrefersReducedMotion, useScrollReveal } from "../intro/hooks";
import "../intro/intro.css";
import { Footer } from "../intro/sections/Footer";
import { Header } from "../intro/sections/Header";
import { editorVars } from "../intro/static-data";
import { buildVersion } from "../intro/version";
import { DEFAULT_GUIDE_SETTINGS, GuideCopyProvider } from "./copy";
import "./guide.css";

/** Same frame while the page text loads, so the footer does not jump up and back down. */
function PageSkeleton() {
  const t = useT();
  return (
    <div className="ix-page ix-page-wait" role="status">
      <div className="ix-wrap">
        <div className="ix-skel ix-skel-title" />
        <div className="ix-skel ix-skel-line" />
        <div className="ix-skel ix-skel-line" />
        <p className="ix-sr">{t("common.loading")}</p>
      </div>
    </div>
  );
}

/**
 * Header, footer and skip link shared by the guide pages. The pages themselves load their text
 * lazily; the header and footer keep using the main dictionary and show at once.
 */
export function GuideLayout() {
  const root = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  useScrollReveal(root, reduced);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const publicSettings = usePublicSettings();
  const settings = useMemo(
    () => ({
      expiryHours: publicSettings?.anonymousTtlHours ?? DEFAULT_GUIDE_SETTINGS.expiryHours,
      historyDays: publicSettings?.historyRetentionDays ?? DEFAULT_GUIDE_SETTINGS.historyDays,
      uploadMB: publicSettings?.maxUploadMB ?? DEFAULT_GUIDE_SETTINGS.uploadMB,
      docMB: publicSettings
        ? Math.round((publicSettings.maxDocBytes / (1024 * 1024)) * 10) / 10
        : DEFAULT_GUIDE_SETTINGS.docMB,
    }),
    [publicSettings],
  );

  // Moving between guide pages starts the next one at the top at once, also while its text loads.
  // Focus follows when the page mounts (GuidePage), and the first entry from another page does the
  // same there (useFocusOnArrival).
  const shown = useRef(pathname);
  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="ix" ref={root} style={editorVars}>
      {/* The skip link is the app shell's (routes/__root.tsx); it points at #main. */}
      <Header />
      <main id="main" tabIndex={-1}>
        <Suspense fallback={<PageSkeleton />}>
          <GuideCopyProvider settings={settings}>
            <Outlet />
          </GuideCopyProvider>
        </Suspense>
      </main>
      <Footer version={buildVersion()} contact={publicSettings?.contact} />
    </div>
  );
}
