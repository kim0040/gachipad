import { Button } from "@gachipad/ui";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { applyAppUpdate, dismissAppUpdate, useAppUpdate } from "../../lib/app-update";
import { useT } from "../../lib/i18n";

/**
 * "A new version is available": shown after the server was updated. It never reloads on its own,
 * so nobody loses their place while editing; here the reload happens on the button only. A page
 * nobody is using may take a waiting build by itself (applyWhenIdle in lib/app-update.ts).
 */
export function UpdatePrompt() {
  const t = useT();
  const update = useAppUpdate();
  const [busy, setBusy] = useState(false);
  if (!update.available || update.dismissed) return null;
  return (
    <section
      role="status"
      aria-labelledby="update-prompt-title"
      data-testid="update-prompt"
      className="fixed inset-x-3 bottom-3 z-(--z-toast) flex flex-col gap-3 rounded-lg border border-line bg-overlay p-3 text-fg [box-shadow:var(--edge),var(--elev-3)] sm:inset-x-auto sm:start-4 sm:bottom-4 sm:w-sm"
    >
      <div className="flex items-start gap-3">
        <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-text" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="update-prompt-title" className="text-body-sm font-medium">
            {t("app.update.title")}
          </h2>
          <p className="text-caption text-fg-2">{t("app.update.body")}</p>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dismissAppUpdate}>
          {t("app.update.laterAction")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          loadingLabel={t("common.loading")}
          onClick={() => {
            setBusy(true);
            void applyAppUpdate().finally(() => setBusy(false));
          }}
        >
          {t("app.update.reloadAction")}
        </Button>
      </div>
    </section>
  );
}
