import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isVersionSeen,
  markTourSeen,
  resetTourMemory,
  TOUR_STORAGE_KEY,
  TOUR_VERSION,
  tourSeen,
} from "./seen";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const blockedStorage = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

beforeEach(() => resetTourMemory());
afterEach(() => vi.unstubAllGlobals());

describe("tourSeen", () => {
  it("is false for a browser that never saw the tour", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(tourSeen()).toBe(false);
  });

  it("is true once Skip or Done stored the current version", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    markTourSeen();
    expect(storage.data.get(TOUR_STORAGE_KEY)).toBe(String(TOUR_VERSION));
    resetTourMemory();
    expect(tourSeen()).toBe(true);
  });

  it("counts a newer stored version as seen and ignores anything that is not a version", () => {
    vi.stubGlobal("localStorage", memoryStorage({ [TOUR_STORAGE_KEY]: String(TOUR_VERSION + 4) }));
    expect(tourSeen()).toBe(true);
    for (const junk of ["", "0", "-1", "1.5", "yes", "NaN"]) {
      vi.stubGlobal("localStorage", memoryStorage({ [TOUR_STORAGE_KEY]: junk }));
      expect(tourSeen(), junk).toBe(false);
    }
  });
});

describe("the tour version", () => {
  it("is past 1, so people who saw the first tour see the rewritten one once", () => {
    expect(TOUR_VERSION).toBeGreaterThan(1);
    vi.stubGlobal("localStorage", memoryStorage({ [TOUR_STORAGE_KEY]: "1" }));
    expect(tourSeen()).toBe(false);
    markTourSeen();
    resetTourMemory();
    expect(tourSeen()).toBe(true);
  });
});

describe("isVersionSeen", () => {
  it("shows a changed tour again to everyone who saw an older one", () => {
    expect(isVersionSeen(1, 1)).toBe(true);
    expect(isVersionSeen(1, 2)).toBe(false);
    expect(isVersionSeen(0, 1)).toBe(false);
  });
});

describe("with storage blocked", () => {
  it("never throws, and remembers the tour for the rest of the page", () => {
    vi.stubGlobal("localStorage", blockedStorage);
    expect(tourSeen()).toBe(false);
    expect(() => markTourSeen()).not.toThrow();
    expect(tourSeen()).toBe(true);
  });

  it("starts unseen again after a reload (nothing was persisted)", () => {
    vi.stubGlobal("localStorage", blockedStorage);
    markTourSeen();
    resetTourMemory();
    expect(tourSeen()).toBe(false);
  });
});
