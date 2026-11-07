import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { ySyncAnnotation } from "y-codemirror.next";
import { isLocalActivity } from "./awareness-bridge";

const state = EditorState.create({ doc: "hello" });
// The annotation's value is y-codemirror's own config; only whether it is there matters here.
const fromYjs = ySyncAnnotation.of({} as never);

describe("isLocalActivity", () => {
  it("counts a local edit and a local selection change", () => {
    expect(isLocalActivity([state.update({ changes: { from: 0, insert: "x" } })])).toBe(true);
    expect(isLocalActivity([state.update({ selection: { anchor: 2 } })])).toBe(true);
  });

  it("does not count text that came through Yjs", () => {
    const remote = state.update({ changes: { from: 0, insert: "x" }, annotations: fromYjs });
    expect(isLocalActivity([remote])).toBe(false);
  });

  it("counts the selection that undo restores right after its text came through Yjs", () => {
    const undone = state.update({ changes: { from: 0, to: 1 }, annotations: fromYjs });
    const restored = undone.state.update({ selection: { anchor: 1 } });
    expect(isLocalActivity([undone])).toBe(false);
    expect(isLocalActivity([restored])).toBe(true);
  });

  it("does not count a transaction that changes neither text nor selection", () => {
    expect(isLocalActivity([state.update({})])).toBe(false);
  });
});
