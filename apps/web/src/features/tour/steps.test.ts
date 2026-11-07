import { dictionaries } from "@gachipad/i18n";
import { describe, expect, it } from "vitest";
import { bodyOf, TOUR_STEPS } from "./steps";

describe("TOUR_STEPS", () => {
  it("has four to six steps, each pointing at a different element", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(6);
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length);
  });

  it("has a title and a body in both languages for every step", () => {
    for (const locale of ["en", "ko"] as const) {
      const dictionary: Record<string, string> = dictionaries[locale];
      for (const step of TOUR_STEPS) {
        expect(dictionary[step.title], `${locale} ${step.title}`).toBeTruthy();
        expect(dictionary[step.body], `${locale} ${step.body}`).toBeTruthy();
        for (const variant of [step.limitedBody, step.touchBody]) {
          if (variant) expect(dictionary[variant], `${locale} ${variant}`).toBeTruthy();
        }
      }
    }
  });
});

describe("the files step", () => {
  const files = TOUR_STEPS.find((step) => step.id === "files");
  const dictionary: Record<string, string> = dictionaries.en;

  it("is shown to people who cannot add files with words that do not promise it", () => {
    expect(files?.editorOnly).toBeFalsy();
    expect(files?.limitedBody).toBeTruthy();
    if (!files?.limitedBody) return;
    const limited = dictionary[bodyOf(files, { limited: true, touchOnly: false })] ?? "";
    expect(bodyOf(files, { limited: true, touchOnly: false })).toBe(files.limitedBody);
    expect(limited).not.toMatch(/drag|drop/i);
  });

  it("teaches dragging to editors with a mouse and the upload menu to touch-only devices", () => {
    if (!files?.touchBody) throw new Error("the files step has no touch text");
    const editor = dictionary[bodyOf(files, { limited: false, touchOnly: false })] ?? "";
    const touch = dictionary[bodyOf(files, { limited: false, touchOnly: true })] ?? "";
    expect(editor).toMatch(/drag/i);
    expect(touch).not.toMatch(/drag/i);
    expect(bodyOf(files, { limited: false, touchOnly: true })).toBe(files.touchBody);
  });

  it("falls back to the plain text for steps without variants", () => {
    const share = TOUR_STEPS.find((step) => step.id === "share");
    if (!share) throw new Error("no share step");
    expect(bodyOf(share, { limited: true, touchOnly: true })).toBe(share.body);
  });

  it("is told about in the menu step: cursor display lives in Settings", () => {
    const menu = TOUR_STEPS.find((step) => step.id === "menu");
    if (!menu) throw new Error("no menu step");
    expect(dictionary[menu.body]).toMatch(/settings/i);
    expect(dictionary[menu.body]).toMatch(/cursor/i);
  });
});
