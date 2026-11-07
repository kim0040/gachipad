import { describe, expect, it } from "vitest";
import { decideDrop } from "./file-drop";

const base = { hasPage: true, modalOpen: false, inTarget: false, busy: false, denied: false };

describe("decideDrop", () => {
  it("takes the drop when the page wants files and nothing else owns it", () => {
    expect(decideDrop(base)).toBe("take");
  });

  it("leaves the drag to a modal dialog and to elements that take drops themselves", () => {
    expect(decideDrop({ ...base, modalOpen: true })).toBe("ignore");
    expect(decideDrop({ ...base, inTarget: true })).toBe("ignore");
  });

  it("does nothing on a route with no page that wants files", () => {
    expect(decideDrop({ ...base, hasPage: false })).toBe("ignore");
  });

  it("refuses with a reason when files cannot be added, and while a share is being created", () => {
    expect(decideDrop({ ...base, denied: true })).toBe("denied");
    expect(decideDrop({ ...base, busy: true })).toBe("busy");
    expect(decideDrop({ ...base, modalOpen: true, denied: true })).toBe("ignore");
  });
});
