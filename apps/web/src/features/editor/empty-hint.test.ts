import { describe, expect, it } from "vitest";
import { emptyHintKey } from "./empty-hint";

describe("emptyHintKey", () => {
  it("promises dragging only where it can happen", () => {
    expect(emptyHintKey({ readOnly: false, canImport: true, touch: false })).toBe(
      "empty.file.body",
    );
    expect(emptyHintKey({ readOnly: false, canImport: true, touch: true })).toBe(
      "empty.file.bodyTouch",
    );
  });
  it("does not offer files to someone who cannot add them", () => {
    expect(emptyHintKey({ readOnly: false, canImport: false, touch: false })).toBe(
      "empty.file.bodyType",
    );
    expect(emptyHintKey({ readOnly: false, canImport: false, touch: true })).toBe(
      "empty.file.bodyType",
    );
  });
  it("tells a viewer the file is empty, not to type", () => {
    expect(emptyHintKey({ readOnly: true, canImport: false, touch: false })).toBe(
      "empty.file.bodyReadOnly",
    );
    expect(emptyHintKey({ readOnly: true, canImport: true, touch: true })).toBe(
      "empty.file.bodyReadOnly",
    );
  });
});
