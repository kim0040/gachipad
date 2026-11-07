import { createT, type Locale } from "@gachipad/i18n";
import { describe, expect, it } from "vitest";
import { MAX_WALKED_ENTRIES, type Skip } from "./dropped-files";
import { skipDescription, skipReasonText, skipToast, summarizeImport } from "./import-summary";

const base = { added: 0, addedPaths: [], renamed: [], duplicates: [], skipped: [] };

describe.each(["ko", "en"] as Locale[])("summarizeImport (%s)", (locale) => {
  const t = createT(locale);
  const text = (key: Parameters<typeof t>[0], params?: Record<string, string | number>) =>
    t(key, params);

  it("names the file when one was added", () => {
    const [toast, ...rest] = summarizeImport(t, { ...base, added: 1, addedPaths: ["main.py"] });
    expect(toast?.title).toBe(text("toast.import.added", { name: "main.py" }));
    expect(toast?.title).toContain("main.py");
    expect(toast?.tone).toBe("success");
    expect(toast?.description).toBeUndefined();
    expect(rest).toEqual([]);
  });

  it("gives the count when several were added", () => {
    const [toast] = summarizeImport(t, { ...base, added: 4, addedPaths: ["a", "b", "c", "d"] });
    expect(toast?.title).toBe(text("toast.import.addedMany", { count: 4 }));
    expect(toast?.title).toContain("4");
  });

  it("names both files when a different file took the name", () => {
    const [toast] = summarizeImport(t, {
      ...base,
      added: 1,
      addedPaths: ["main (2).py"],
      renamed: [{ from: "main.py", to: "main (2).py" }],
    });
    expect(toast?.title).toContain("main (2).py");
    expect(toast?.description).toContain("main.py");
    expect(toast?.description).toContain("main (2).py");
  });

  it("says an identical file was not added again", () => {
    const [toast, ...rest] = summarizeImport(t, { ...base, duplicates: ["main.py"] });
    expect(toast?.title).toBe(text("toast.import.openedDuplicate", { name: "main.py" }));
    expect(toast?.tone).toBe("neutral");
    expect(rest).toEqual([]);
    const [mixed] = summarizeImport(t, {
      ...base,
      added: 1,
      addedPaths: ["b.py"],
      duplicates: ["main.py"],
    });
    expect(mixed?.description).toBe(text("toast.import.duplicate", { name: "main.py" }));
  });

  it("follows added files with one warning that lists up to three named skips", () => {
    const skipped: Skip[] = [
      { name: "a.png", reason: "binary" },
      { name: "b.zip", reason: "zipBad" },
      { name: "node_modules", reason: "excludedFolder" },
      { name: "c.bin", reason: "binary" },
      { name: "d.bin", reason: "binary" },
    ];
    const toasts = summarizeImport(t, { ...base, added: 2, addedPaths: ["x", "y"], skipped });
    expect(toasts).toHaveLength(2);
    const warning = toasts[1];
    expect(warning?.tone).toBe("warning");
    expect(warning?.title).toBe(text("toast.import.skipped", { count: 5 }));
    for (const name of ["a.png", "b.zip", "node_modules"])
      expect(warning?.description).toContain(name);
    expect(warning?.description).not.toContain("c.bin");
    expect(warning?.description).toContain(text("toast.import.more", { count: 2 }));
    expect(warning?.description).toContain(text("toast.import.reason.binary"));
  });

  it("explains a drop where nothing could be added", () => {
    const [toast, ...rest] = summarizeImport(t, {
      ...base,
      skipped: [{ name: "logo.png", reason: "binary" }],
    });
    expect(rest).toEqual([]);
    expect(toast?.title).toBe(text("toast.import.none"));
    expect(toast?.tone).toBe("warning");
    expect(toast?.description).toBe(`logo.png (${text("toast.import.reason.binary")})`);
    expect(summarizeImport(t, base)[0]?.title).toBe(text("toast.import.empty"));
  });

  it("words every reason, with the limits filled in", () => {
    const reasons: Skip["reason"][] = [
      "binary",
      "tooBig",
      "unreadable",
      "folder",
      "excludedFolder",
      "tooMany",
      "shareFull",
      "badPath",
      "zipTooMany",
      "zipTooBig",
      "zipBad",
    ];
    for (const reason of reasons) {
      const description = skipDescription(t, [{ name: "x", reason }]);
      expect(description, reason).toMatch(/^x \(.+\)$/);
      expect(description, reason).not.toContain("toast.import");
      expect(description, reason).not.toMatch(/\{\w+\}/);
    }
    expect(skipDescription(t, [{ name: "x", reason: "tooBig" }])).toContain("5MB");
    expect(skipDescription(t, [{ name: "x", reason: "tooMany" }])).toContain("100");
  });

  it("says the rest was not checked, without counting it as skipped", () => {
    const stopped = { name: "", reason: "notChecked", count: 0 } as const;
    const words = skipReasonText(t, "notChecked");
    expect(words).toContain(MAX_WALKED_ENTRIES.toLocaleString("en"));
    expect(skipDescription(t, [{ name: "a.png", reason: "binary" }, stopped])).toContain(words);
    expect(skipToast(t, [{ name: "a.png", reason: "binary" }, stopped])?.title).toBe(
      t("toast.import.skipped", { count: 1 }),
    );
    expect(skipToast(t, [stopped])).toEqual(expect.objectContaining({ title: words }));
  });

  it("counts skips without a name instead of listing them", () => {
    const description = skipDescription(t, [
      { name: "a.png", reason: "binary" },
      { name: "", reason: "tooMany", count: 30 },
    ]);
    expect(description).toContain("a.png");
    expect(description).toContain("30");
  });

  it("shortens a long path from the left", () => {
    const long = `${"deep/".repeat(30)}file.py`;
    const description = skipDescription(t, [{ name: long, reason: "binary" }]);
    expect(description.startsWith("…")).toBe(true);
    expect(description).toContain("file.py");
    expect(description.length).toBeLessThan(long.length);
  });

  it("builds a skips-only toast, or none", () => {
    expect(skipToast(t, [])).toBeNull();
    expect(skipToast(t, [{ name: "a", reason: "binary" }])?.tone).toBe("warning");
  });
});
