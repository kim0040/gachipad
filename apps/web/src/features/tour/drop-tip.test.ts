import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DROP_TIP_STORAGE_KEY,
  type DropTipState,
  dropTipDone,
  dropTipUsesButton,
  fileWasAdded,
  markDropTipDone,
  resetDropTipMemory,
  showDropTip,
} from "./drop-tip";

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

beforeEach(() => resetDropTipMemory());
afterEach(() => vi.unstubAllGlobals());

describe("dropTipDone", () => {
  it("is false for a browser that never dismissed the tip", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(dropTipDone()).toBe(false);
  });

  it("stays true after dismiss or a first file, also in the next page load", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    markDropTipDone();
    expect(storage.data.get(DROP_TIP_STORAGE_KEY)).toBe("1");
    resetDropTipMemory();
    expect(dropTipDone()).toBe(true);
  });

  it("ignores anything but the stored mark", () => {
    for (const junk of ["", "0", "yes", "true"]) {
      vi.stubGlobal("localStorage", memoryStorage({ [DROP_TIP_STORAGE_KEY]: junk }));
      expect(dropTipDone(), junk).toBe(false);
    }
  });

  it("never throws with storage blocked, and remembers for the rest of the page", () => {
    vi.stubGlobal("localStorage", blockedStorage);
    expect(dropTipDone()).toBe(false);
    expect(() => markDropTipDone()).not.toThrow();
    expect(dropTipDone()).toBe(true);
    resetDropTipMemory();
    expect(dropTipDone()).toBe(false);
  });
});

describe("showDropTip", () => {
  const ready: DropTipState = {
    canAdd: true,
    done: false,
    tourSeen: true,
    dialogOpen: false,
    deviceQuestion: false,
    panelOpen: false,
    aloneHintShown: false,
    typed: false,
    settled: true,
  };

  it("shows when everything allows it", () => {
    expect(showDropTip(ready)).toBe(true);
  });

  it("stays away from anyone who cannot add files", () => {
    expect(showDropTip({ ...ready, canAdd: false })).toBe(false);
  });

  it("stays away once done, and while the tour is unseen, open or a dialog is up", () => {
    expect(showDropTip({ ...ready, done: true })).toBe(false);
    expect(showDropTip({ ...ready, tourSeen: false })).toBe(false);
    expect(showDropTip({ ...ready, dialogOpen: true })).toBe(false);
    expect(showDropTip({ ...ready, deviceQuestion: true })).toBe(false);
    expect(showDropTip({ ...ready, panelOpen: true })).toBe(false);
  });

  it("gives way to the other hint, to typing and to the editor still settling", () => {
    expect(showDropTip({ ...ready, aloneHintShown: true })).toBe(false);
    expect(showDropTip({ ...ready, typed: true })).toBe(false);
    expect(showDropTip({ ...ready, settled: false })).toBe(false);
  });
});

describe("dropTipUsesButton", () => {
  it("points at the upload button on touch-only and narrow screens, else at dragging", () => {
    expect(dropTipUsesButton({ touchOnly: false, narrow: false })).toBe(false);
    expect(dropTipUsesButton({ touchOnly: true, narrow: false })).toBe(true);
    expect(dropTipUsesButton({ touchOnly: false, narrow: true })).toBe(true);
  });
});

describe("fileWasAdded", () => {
  it("counts a larger file count as an addition and nothing else", () => {
    expect(fileWasAdded(1, 2)).toBe(true);
    expect(fileWasAdded(1, 1)).toBe(false);
    expect(fileWasAdded(3, 2)).toBe(false);
  });
});
