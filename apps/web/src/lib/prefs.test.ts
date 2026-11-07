import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  getPrefs,
  REMOTE_CURSOR_MODES,
  resetPrefs,
  sanitizePrefs,
  setPrefs,
} from "./prefs";

describe("sanitizePrefs", () => {
  it("enables code completion by default", () => {
    expect(DEFAULT_PREFS.codeCompletion).toBe(true);
    expect(sanitizePrefs({}).codeCompletion).toBe(true);
  });

  it("returns the defaults for anything that is not an object", () => {
    for (const input of [null, undefined, "text", 5, []]) {
      expect(sanitizePrefs(input)).toEqual(DEFAULT_PREFS);
    }
  });

  it("clamps numbers and rounds them", () => {
    expect(sanitizePrefs({ fontSize: 3 }).fontSize).toBe(FONT_SIZE_MIN);
    expect(sanitizePrefs({ fontSize: 99 }).fontSize).toBe(FONT_SIZE_MAX);
    expect(sanitizePrefs({ fontSize: 15.6 }).fontSize).toBe(16);
    expect(sanitizePrefs({ tabSize: 0 }).tabSize).toBe(1);
    expect(sanitizePrefs({ tabSize: Number.NaN }).tabSize).toBe(DEFAULT_PREFS.tabSize);
  });

  it("drops values of the wrong type or outside the known sets", () => {
    const result = sanitizePrefs({
      keymap: "nano",
      editorTheme: "neon",
      wrap: "yes",
      lineNumbers: 0,
      smoothTyping: "off",
      codeCompletion: "off",
    });
    expect(result.keymap).toBe("default");
    expect(result.editorTheme).toBe("auto");
    expect(result.wrap).toBe(DEFAULT_PREFS.wrap);
    expect(result.lineNumbers).toBe(DEFAULT_PREFS.lineNumbers);
    expect(result.smoothTyping).toBe(true);
    expect(result.codeCompletion).toBe(true);
  });

  it("sanitises the remote cursor mode to one of the known values, auto by default", () => {
    expect(DEFAULT_PREFS.remoteCursors).toBe("auto");
    expect(sanitizePrefs({}).remoteCursors).toBe("auto");
    for (const value of REMOTE_CURSOR_MODES) {
      expect(sanitizePrefs({ remoteCursors: value }).remoteCursors).toBe(value);
    }
    for (const value of ["off", "", null, 1, true, {}]) {
      expect(sanitizePrefs({ remoteCursors: value }).remoteCursors).toBe("auto");
    }
  });

  it("keeps valid values", () => {
    const stored = {
      ...DEFAULT_PREFS,
      keymap: "vim",
      wrap: false,
      fontSize: 18,
      tabSize: 4,
      smoothTyping: false,
      codeCompletion: false,
    };
    expect(sanitizePrefs(stored)).toEqual(stored);
  });
});

describe("setPrefs", () => {
  it("merges a patch, validates it and can be reset", () => {
    resetPrefs();
    setPrefs({ fontSize: 400, keymap: "emacs" });
    expect(getPrefs().fontSize).toBe(FONT_SIZE_MAX);
    expect(getPrefs().keymap).toBe("emacs");
    expect(getPrefs().wrap).toBe(DEFAULT_PREFS.wrap);
    resetPrefs();
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });
});

describe("offline copy choice", () => {
  it("is undecided unless it was answered", () => {
    expect(sanitizePrefs({}).offlineCopy).toBe("undecided");
    expect(sanitizePrefs({ offlineCopy: "maybe" }).offlineCopy).toBe("undecided");
    for (const choice of ["undecided", "yes", "no"] as const) {
      expect(sanitizePrefs({ offlineCopy: choice }).offlineCopy).toBe(choice);
    }
  });

  it("migrates the old switch: on was the unasked default, off was a choice", () => {
    expect(sanitizePrefs({ offlineCopy: true }).offlineCopy).toBe("undecided");
    expect(sanitizePrefs({ offlineCopy: false }).offlineCopy).toBe("no");
  });

  it("survives a reset of the editor settings", () => {
    setPrefs({ offlineCopy: "no", fontSize: 20 });
    resetPrefs();
    expect(getPrefs().offlineCopy).toBe("no");
    expect(getPrefs().fontSize).toBe(DEFAULT_PREFS.fontSize);
    setPrefs({ offlineCopy: "undecided" });
  });
});
