import {
  DIAGNOSTIC_CAPS,
  type DiagnosticDetails,
  type DiagnosticEvent,
  type DiagnosticKind,
  type DiagnosticLevel,
  DiagnosticRing,
  diagnosticError,
  diagnosticLocation,
} from "@gachipad/shared";
import { getPrefs } from "./prefs";
import { LEGACY_STORAGE_PREFIX, mirrorLegacy } from "./storage-migration";

/** Correlates one live document session without accepting or storing its actual share id. */
export function newDiagnosticReference(): string {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return Array.from({ length: 2 }, () =>
      Math.floor(Math.random() * 0x100000000)
        .toString(16)
        .padStart(8, "0"),
    ).join("");
  }
}
export function diagnosticExportEvents(events: DiagnosticEvent[]): DiagnosticEvent[] {
  const salt = newDiagnosticReference();
  const hash = (value: string) => {
    let h = 2166136261;
    for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return events.map((event) => ({
    ...event,
    details: {
      ...event.details,
      ...(event.details.shareRef
        ? { shareRef: hash(salt + event.details.shareRef) + hash(event.details.shareRef + salt) }
        : {}),
    },
  }));
}
export function shouldRecordApiFailure(status: number): boolean {
  return (
    status === 0 ||
    status >= 500 ||
    (status >= 400 && status < 500 && ![401, 403, 404, 409, 429].includes(status))
  );
}
export const isBenignResizeObserverError = (message: string): boolean =>
  /^ResizeObserver loop(?: limit exceeded| completed with undelivered notifications\.)?$/i.test(
    message,
  );

const STORAGE_KEY = "gachipad.diagnostics.v1";
const ENABLED_KEY = "gachipad.diagnostics.enabled";
const ring = new DiagnosticRing();
const bootId = newDiagnosticReference();
const listeners = new Set<() => void>();
const activeContexts = new Map<
  string,
  Pick<DiagnosticDetails, "documentSize" | "fileCount" | "connectionCount">
>();
let loaded = false;
let enabled = true;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let installed = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    enabled = localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    /* Memory still works. */
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length <= DIAGNOSTIC_CAPS.bytes * 2) ring.load(JSON.parse(raw));
  } catch {
    /* Private browsing, quota denial or invalid JSON. */
  }
}
function persist() {
  timer = undefined;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.length <= DIAGNOSTIC_CAPS.bytes * 2) ring.merge(JSON.parse(stored));
    const value = JSON.stringify(ring.snapshot());
    if (value !== stored) {
      localStorage.setItem(STORAGE_KEY, value);
      mirrorLegacy(STORAGE_KEY, value);
    }
  } catch {
    /* Memory only. */
  }
}
function changed() {
  revision++;
  for (const listener of listeners) listener();
  timer ??= setTimeout(persist, 1000);
}
export function recordDiagnostic(
  kind: DiagnosticKind,
  details: DiagnosticDetails = {},
  level: DiagnosticLevel = "warn",
): void {
  load();
  if (!enabled) return;
  // Never allow diagnostics to break the operation it observes.
  try {
    ring.record("client", kind, details, level);
    changed();
  } catch {
    /* Best effort. */
  }
}
export const subscribeDiagnostics = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const diagnosticsRevision = () => revision;
export function diagnosticsState() {
  load();
  return { enabled, count: ring.count };
}
export function updateDiagnosticContext(
  reference: string,
  values: Pick<DiagnosticDetails, "documentSize" | "fileCount" | "connectionCount">,
): void {
  if (!/^[a-f0-9]{16}$/.test(reference)) return;
  if (!activeContexts.has(reference) && activeContexts.size >= 50) {
    const oldest = activeContexts.keys().next().value;
    if (oldest) activeContexts.delete(oldest);
  }
  activeContexts.delete(reference);
  activeContexts.set(reference, values);
}
export function clearDiagnosticContext(reference: string): void {
  activeContexts.delete(reference);
}
export function diagnosticContextDetails(): Pick<
  DiagnosticDetails,
  "documentSize" | "fileCount" | "connectionCount"
> {
  const values = [...activeContexts.values()];
  const sizeRank = ["lt_64k", "64k_1m", "1m_10m", "gte_10m"] as const;
  const countRank = ["0", "1", "2_5", "6_20", "gte_21"] as const;
  const max = <T extends string>(rows: Array<T | undefined>, rank: readonly T[]): T | undefined => {
    const index = Math.max(-1, ...rows.map((row) => rank.indexOf(row as T)));
    return rank[index];
  };
  const documentSize = max(
    values.map((row) => row.documentSize),
    sizeRank,
  );
  const fileCount = max(
    values.map((row) => row.fileCount),
    countRank,
  );
  const connectionCount = max(
    values.map((row) => row.connectionCount),
    countRank,
  );
  return {
    ...(documentSize ? { documentSize } : {}),
    ...(fileCount ? { fileCount } : {}),
    ...(connectionCount ? { connectionCount } : {}),
  };
}
export function setDiagnosticsEnabled(value: boolean): void {
  load();
  enabled = value;
  try {
    localStorage.setItem(ENABLED_KEY, String(value));
    mirrorLegacy(ENABLED_KEY, String(value));
  } catch {
    /* Memory only. */
  }
  changed();
}
export function clearDiagnostics(): void {
  load();
  ring.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
  try {
    localStorage.removeItem(STORAGE_KEY);
    mirrorLegacy(STORAGE_KEY, null);
  } catch {
    /* Memory only. */
  }
  revision++;
  for (const listener of listeners) listener();
}
export function captureDiagnosticError(
  kind: "uncaught" | "rejection" | "render" | "sync_error",
  error: unknown,
  details: DiagnosticDetails = {},
): void {
  recordDiagnostic(kind, { ...diagnosticError(error), ...details }, "error");
}

/** Install once. This module has no fetch, beacon, WebSocket or automatic upload capability. */
export function installDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  load();
  persist();
  window.addEventListener("error", (event) => {
    if (event instanceof ErrorEvent && !isBenignResizeObserverError(event.message))
      captureDiagnosticError("uncaught", event.error, {
        location: diagnosticLocation(event.filename),
        line: event.lineno,
        column: event.colno,
      });
  });
  window.addEventListener("unhandledrejection", (event) =>
    captureDiagnosticError("rejection", event.reason),
  );
  window.addEventListener("pagehide", persist);
  window.addEventListener("storage", (event) => {
    if (event.key === ENABLED_KEY || event.key === `${LEGACY_STORAGE_PREFIX}diagnostics.enabled`) {
      enabled = event.newValue !== "false";
      revision++;
      for (const listener of listeners) listener();
    }
    if (event.key === STORAGE_KEY || event.key === `${LEGACY_STORAGE_PREFIX}diagnostics.v1`) {
      if (event.newValue === null) {
        ring.clear();
        if (timer) clearTimeout(timer);
        timer = undefined;
      } else if (event.newValue.length <= DIAGNOSTIC_CAPS.bytes * 2) {
        try {
          if (!ring.merge(JSON.parse(event.newValue))) return;
          timer ??= setTimeout(persist, 1000);
        } catch {
          return;
        }
      }
      revision++;
      for (const listener of listeners) listener();
    }
  });
  try {
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (entry.duration >= 200)
            recordDiagnostic("long_task", {
              durationMs: entry.duration,
              ...diagnosticContextDetails(),
            });
      });
      observer.observe({ type: "longtask", buffered: true });
    }
  } catch {
    /* Long tasks are not supported by every engine. */
  }
}

const safe = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};
const version = () => (import.meta.env.VITE_APP_VERSION || "0.0.0").replace(/[^\w.-]/g, "_");
function environment() {
  const ua = navigator.userAgent;
  const browser = [
    /(Edg)\/([\d.]+)/,
    /(Firefox)\/([\d.]+)/,
    /(Chrome)\/([\d.]+)/,
    /(Version)\/([\d.]+)/,
  ]
    .map((pattern) => ua.match(pattern))
    .find(Boolean);
  const prefs = getPrefs();
  return {
    appVersion: version(),
    build: {
      mode: import.meta.env.MODE,
      assets: safe(
        () =>
          Array.from(document.scripts, (script) => new URL(script.src, document.baseURI).pathname)
            .filter((path) => /^\/assets\/[\w.-]+\.js$/.test(path))
            .slice(0, 4),
        [] as string[],
      ),
    },
    browser: browser
      ? { name: browser[1] === "Version" ? "Safari" : browser[1], version: browser[2] }
      : { name: "unknown", version: "unknown" },
    engine: /Firefox\//.test(ua)
      ? "Gecko"
      : /Chrome\//.test(ua)
        ? "Blink"
        : /AppleWebKit\//.test(ua)
          ? "WebKit"
          : "unknown",
    engineVersion:
      ua.match(/Chrome\/([\d.]+)/)?.[1] ??
      ua.match(/rv:([\d.]+)/)?.[1] ??
      ua.match(/AppleWebKit\/([\d.]+)/)?.[1] ??
      "unknown",
    os: /Windows/.test(ua)
      ? "Windows"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Mac OS X/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "unknown",
    deviceClass: /Mobi|Android/.test(ua) ? "mobile" : "desktop",
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio,
    },
    language: /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(navigator.language)
      ? navigator.language
      : "unknown",
    colorScheme: safe(
      () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
      "unknown",
    ),
    reducedMotion: safe(() => matchMedia("(prefers-reduced-motion: reduce)").matches, false),
    prefs: {
      editorTheme: prefs.editorTheme,
      fontSize: prefs.fontSize,
      tabSize: prefs.tabSize,
      indentWithTabs: prefs.indentWithTabs,
      wrap: prefs.wrap,
      lineNumbers: prefs.lineNumbers,
      keymap: prefs.keymap,
      smoothTyping: prefs.smoothTyping,
      remoteCursors: prefs.remoteCursors,
    },
    support: {
      indexedDB: safe(() => Boolean(window.indexedDB), false),
      fullscreen: safe(() => document.fullscreenEnabled, false),
      clipboard: safe(() => Boolean(navigator.clipboard?.writeText), false),
      websocket: typeof WebSocket !== "undefined",
      performanceObserver: typeof PerformanceObserver !== "undefined",
    },
  };
}
export function clientDiagnosticExport(): string {
  load();
  return JSON.stringify(
    {
      format: 1,
      header: `gachipad client diagnostics v${version()}: local operational events, a short breadcrumb timeline, counts, redacted error categories/source frames and environment. Document text, file names, user values, URLs, credentials and share IDs are omitted; random session references are hashed anew per export. Source maps for this version are on the GitHub release page as gachipad-web-sourcemaps-${version()}.tar.gz. Nothing is sent automatically.`,
      exportedAt: new Date().toISOString(),
      bootId,
      caps: DIAGNOSTIC_CAPS,
      enabled,
      environment: environment(),
      events: diagnosticExportEvents(ring.list()),
      breadcrumbs: ring.listBreadcrumbs(),
    },
    null,
    2,
  );
}
export function diagnosticsFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `gachipad-diagnostics-${version()}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}
export function downloadDiagnostics(text: string, name = diagnosticsFilename()): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
