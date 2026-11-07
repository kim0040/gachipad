/**
 * One new share at a time, on the whole page: the buttons, a drop, the file picker and the template
 * dialog all start here, from reading the files until the new share is open. Plain state, so every
 * place that can start one sees the others.
 */

/** A create that has not reached its share by now never will; the page gets its buttons back. */
export const CREATE_TIMEOUT_MS = 60_000;

export interface CreateRun {
  /** Ends the request when the run is cancelled or times out. */
  readonly signal: AbortSignal;
  /** False once cancelled or timed out: nothing may happen on its behalf any more. */
  live(): boolean;
  /** The share exists and is being opened: leaving this page no longer cancels the run. */
  commit(): void;
  /** The page that started it is gone. */
  cancel(): void;
  finish(): void;
}

let current: CreateRun | null = null;
const listeners = new Set<() => void>();

function release(run: CreateRun) {
  if (current !== run) return;
  current = null;
  for (const listener of listeners) listener();
}

export const createPending = (): boolean => current !== null;

export function subscribeCreatePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A new run, or null while another one is under way. */
export function beginCreate(
  onTimeout: () => void,
  timeoutMs: number = CREATE_TIMEOUT_MS,
): CreateRun | null {
  if (current) return null;
  const controller = new AbortController();
  let state: "running" | "committed" | "over" = "running";
  const run: CreateRun = {
    signal: controller.signal,
    live: () => state !== "over",
    commit: () => {
      if (state === "running") state = "committed";
    },
    cancel: () => {
      if (state !== "running") return;
      state = "over";
      clearTimeout(timer);
      controller.abort();
      release(run);
    },
    finish: () => {
      if (state === "over") return;
      state = "over";
      clearTimeout(timer);
      release(run);
    },
  };
  const timer = setTimeout(() => {
    state = "over";
    controller.abort();
    release(run);
    onTimeout();
  }, timeoutMs);
  current = run;
  for (const listener of listeners) listener();
  return run;
}
