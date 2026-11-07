import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginCreate,
  CREATE_TIMEOUT_MS,
  createPending,
  subscribeCreatePending,
} from "./create-run";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("beginCreate", () => {
  it("lets one run go at a time, from wherever it starts", () => {
    const first = beginCreate(() => {});
    expect(first).not.toBeNull();
    expect(createPending()).toBe(true);
    expect(beginCreate(() => {})).toBeNull();
    first?.finish();
    expect(createPending()).toBe(false);
    const second = beginCreate(() => {});
    expect(second).not.toBeNull();
    second?.finish();
  });

  it("gives the page back after the timeout when a request never ends", () => {
    const timedOut = vi.fn();
    const run = beginCreate(timedOut);
    vi.advanceTimersByTime(CREATE_TIMEOUT_MS - 1);
    expect(timedOut).not.toHaveBeenCalled();
    expect(createPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(timedOut).toHaveBeenCalledOnce();
    expect(createPending()).toBe(false);
    expect(run?.live()).toBe(false);
    expect(run?.signal.aborted).toBe(true);
  });

  it("does not time out a run that finished", () => {
    const timedOut = vi.fn();
    beginCreate(timedOut)?.finish();
    vi.advanceTimersByTime(CREATE_TIMEOUT_MS * 2);
    expect(timedOut).not.toHaveBeenCalled();
  });

  it("ends the request and frees the page when the page that started it goes", () => {
    const timedOut = vi.fn();
    const run = beginCreate(timedOut);
    run?.cancel();
    expect(run?.live()).toBe(false);
    expect(run?.signal.aborted).toBe(true);
    expect(createPending()).toBe(false);
    vi.advanceTimersByTime(CREATE_TIMEOUT_MS * 2);
    expect(timedOut).not.toHaveBeenCalled();
  });

  it("is not cancelled by leaving once the share exists: that is the navigation itself", () => {
    const run = beginCreate(() => {});
    run?.commit();
    run?.cancel();
    expect(run?.live()).toBe(true);
    expect(run?.signal.aborted).toBe(false);
    run?.finish();
    expect(createPending()).toBe(false);
  });

  it("does not let an old run free a newer one", () => {
    const old = beginCreate(() => {});
    old?.cancel();
    const next = beginCreate(() => {});
    old?.finish();
    expect(createPending()).toBe(true);
    next?.finish();
  });

  it("tells whoever is listening when it starts and when it ends", () => {
    const heard = vi.fn();
    const stop = subscribeCreatePending(heard);
    const run = beginCreate(() => {});
    expect(heard).toHaveBeenCalledTimes(1);
    run?.finish();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });
});
