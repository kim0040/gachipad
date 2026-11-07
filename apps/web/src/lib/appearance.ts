import { useSyncExternalStore } from "react";

export type Appearance = "dark" | "light";

function read(): Appearance {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "dark" || forced === "light") return forced;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function subscribe(callback: () => void): () => void {
  const list = window.matchMedia("(prefers-color-scheme: light)");
  list.addEventListener("change", callback);
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    list.removeEventListener("change", callback);
    observer.disconnect();
  };
}

/** The app theme the page renders right now (`data-theme` on <html>, else the OS setting). */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, read, () => "dark");
}

const REDUCED = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const list = window.matchMedia(REDUCED);
      list.addEventListener("change", callback);
      return () => list.removeEventListener("change", callback);
    },
    prefersReducedMotion,
    () => false,
  );
}

const NARROW = "(max-width: 47.99rem)";

function subscribeMedia(queries: readonly string[], callback: () => void): () => void {
  const lists = queries.map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", callback);
  return () => {
    for (const list of lists) list.removeEventListener("change", callback);
  };
}

const ANY_FINE = "(any-pointer: fine)";
const ANY_COARSE = "(any-pointer: coarse)";

/**
 * Whether this device can drag files in from the computer: anything with a mouse or trackpad, among
 * them a touch-screen laptop and a tablet with a trackpad. Only a touch-only device cannot. Follows
 * a mouse being plugged in or out.
 */
export function useDragCapable(): boolean {
  return useSyncExternalStore(
    (callback) => subscribeMedia([ANY_FINE, ANY_COARSE], callback),
    () => window.matchMedia(ANY_FINE).matches || !window.matchMedia(ANY_COARSE).matches,
    () => true,
  );
}

/** Whether a file input can pick a whole folder in this browser. */
export function canPickFolders(): boolean {
  return "webkitdirectory" in HTMLInputElement.prototype;
}

/** True below the `md` breakpoint (48rem). */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const list = window.matchMedia(NARROW);
      list.addEventListener("change", callback);
      return () => list.removeEventListener("change", callback);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}
