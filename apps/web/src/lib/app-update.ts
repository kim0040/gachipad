import { registerSW } from "virtual:pwa-register";
import { useSyncExternalStore } from "react";
import { EDITING_LOCK, flushPendingSessions, hasOpenSessions } from "./collab/session";

/**
 * Picking up a new build after the server was updated. The service worker no longer swaps itself
 * in silently: a new build waits, and the prompt offers a reload on a click, so a live editing
 * session is never cut off. Only a page nobody is using takes the build by itself: no open document
 * in any tab and not touched since it loaded (applyWhenIdle). The server's `/api/version` is compared
 * with this build's version on start, when the tab becomes visible, every half hour and after every
 * collab reconnect (a server restart), which also covers a changed collab protocol.
 */

/** The root package.json version, set by vite.config.ts. */
export const BUILD_VERSION: string = import.meta.env.VITE_APP_VERSION || "0.0.0";

export interface AppUpdateState {
  /** A newer build is waiting, or the server runs another version than this tab. */
  available: boolean;
  serverVersion: string | null;
}

const PERIOD_MS = 30 * 60_000;
const MIN_GAP_MS = 60_000;
const APPROVAL_MS = 30_000;
const AUTO_APPLY_GAP_MS = 5 * 60_000;
const AUTO_APPLY_KEY = "gachipad.update.autoApplied";
/** Half-typed forms, dropped files in memory, someone reading: any of these keeps the prompt. */
const TOUCH_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "dragenter",
  "paste",
  "input",
] as const;

let state: AppUpdateState = { available: false, serverVersion: null };
let dismissedFor: string | null = null;
const listeners = new Set<() => void>();
let updateServiceWorker: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;
let lastCheck = 0;
let started = false;
let reloadApprovedUntil = 0;
let touched = false;

function publish(next: AppUpdateState) {
  state = next;
  for (const listener of listeners) listener();
}

const key = () => state.serverVersion ?? "build";

function markAvailable(serverVersion: string | null) {
  publish({ available: true, serverVersion: serverVersion ?? state.serverVersion });
}

/** Registers the service worker in prompt mode and starts the version checks. Call once. */
export function startAppUpdates(): void {
  if (started) return;
  started = true;
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    for (const name of TOUCH_EVENTS) {
      window.addEventListener(
        name,
        () => {
          touched = true;
        },
        { capture: true, passive: true, once: true },
      );
    }
    updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh: () => {
        markAvailable(null);
        void applyWhenIdle();
      },
      // Workbox broadcasts controlling to every tab. Approval belongs to this JS context only.
      onNeedReload: () => {
        dismissedFor = null;
        markAvailable(null);
        if (Date.now() < reloadApprovedUntil) void reloadWhenSynced();
        else reloadApprovedUntil = 0;
      },
      onRegisteredSW: (_url, value) => {
        registration = value;
        // A worker already waiting at load fires onNeedRefresh before this, with no registration yet.
        void applyWhenIdle();
        // Refreshed while the new build was still downloading: Workbox listens for updatefound, which
        // has passed, so it never reports this worker as waiting.
        const installing = value?.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") void applyWhenIdle();
        });
      },
    });
  }
  void checkServerVersion(0);
  window.setInterval(() => void checkServerVersion(), PERIOD_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkServerVersion();
      void applyWhenIdle();
    }
  });
  // Vite emits this before surfacing a stale lazy chunk failure. Offer a safe, explicit reload.
  window.addEventListener("vite:preloadError", () => {
    dismissedFor = null;
    markAvailable(null);
  });
}

/** Asks the server for its version unless that happened within `minGapMs`. Never throws. */
export async function checkServerVersion(minGapMs = MIN_GAP_MS): Promise<void> {
  if (Date.now() - lastCheck < minGapMs) return;
  lastCheck = Date.now();
  try {
    const response = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return;
    const { version } = (await response.json()) as { version?: unknown };
    if (typeof version !== "string" || !version || version === BUILD_VERSION) return;
    // Lets the service worker fetch the new build now, so the reload gets it.
    void registration?.update().catch(() => undefined);
    markAvailable(version);
  } catch {
    // Offline or the server is restarting: the next trigger asks again.
  } finally {
    void applyWhenIdle();
  }
}

/** Collab connected again: the server may have restarted with another version. */
export function onCollabConnected(): void {
  void checkServerVersion(5000);
}

async function reloadWhenSynced(): Promise<boolean> {
  if (!(await flushPendingSessions())) {
    reloadApprovedUntil = 0;
    return false;
  }
  // No await between the last pending check and reload: typing cannot slip into that gap.
  window.location.reload();
  return true;
}

/** Reloads only this tab after its user agrees and all its document edits are acknowledged. */
export async function applyAppUpdate(): Promise<boolean> {
  if (registration && updateServiceWorker) {
    await registration.update().catch(() => undefined);
    if (!(await flushPendingSessions())) return false;
    reloadApprovedUntil = Date.now() + APPROVAL_MS;
    if (registration.waiting) {
      try {
        await updateServiceWorker();
        return true;
      } catch {
        reloadApprovedUntil = 0;
        return false;
      }
    }
  }
  return reloadWhenSynced();
}

/** Open documents in any tab of this browser. Without Web Locks nobody can tell: assume there are. */
async function editingInSomeTab(): Promise<boolean> {
  if (!navigator.locks) return true;
  try {
    const { held = [], pending = [] } = await navigator.locks.query();
    return [...held, ...pending].some((lock) => lock.name === EDITING_LOCK);
  } catch {
    return true;
  }
}

/** One automatic attempt per tab and gap, so a worker that keeps coming back cannot loop reloads. */
function claimAutoApply(): boolean {
  try {
    if (Math.abs(Date.now() - Number(sessionStorage.getItem(AUTO_APPLY_KEY))) < AUTO_APPLY_GAP_MS) {
      return false;
    }
    sessionStorage.setItem(AUTO_APPLY_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Activates a waiting worker and reloads this tab, if nobody is using it. Reloads on the worker's
 * own `activated`, not through onNeedReload: a tab the old worker does not control (a first visit,
 * this worker has no clients.claim) gets no controlling event. Acts only on `registration.waiting`,
 * so a server version mismatch alone never reloads anything.
 */
async function applyWhenIdle(): Promise<void> {
  if (!registration?.waiting || !updateServiceWorker || touched || hasOpenSessions()) return;
  if (await editingInSomeTab()) return;
  const worker = registration.waiting;
  // No await from here to the activation: a document cannot open in that gap.
  if (!worker || touched || hasOpenSessions() || !claimAutoApply()) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "activated" && !touched && !hasOpenSessions()) void reloadWhenSynced();
  });
  void updateServiceWorker().catch(() => undefined);
}

/** "Later": hidden until another version shows up. */
export function dismissAppUpdate(): void {
  dismissedFor = key();
  publish({ ...state });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current state outside React (tests). */
export function appUpdateState(): AppUpdateState & { dismissed: boolean } {
  return { ...state, dismissed: dismissedFor === key() };
}

export function useAppUpdate(): AppUpdateState & { dismissed: boolean } {
  const current = useSyncExternalStore(subscribe, () => state);
  return { ...current, dismissed: dismissedFor === key() };
}
