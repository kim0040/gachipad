import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { ySyncAnnotation } from "y-codemirror.next";
import * as Y from "yjs";
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

  it("counts text that came through Yjs while my own undo or redo was running", () => {
    const undone = state.update({ changes: { from: 0, to: 1 }, annotations: fromYjs });
    expect(isLocalActivity([undone], true)).toBe(true);
    // The same text with no undo running is someone else's edit.
    expect(isLocalActivity([undone], false)).toBe(false);
  });

  it("a real undo manager says it is undoing while the text changes, and only then", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    const manager = new Y.UndoManager(text);
    // Text that went straight into the document, the way an imported file does.
    text.insert(0, "imported");
    const seen: boolean[] = [];
    text.observe(() => seen.push(manager.undoing || manager.redoing));
    manager.undo();
    expect(text.toString()).toBe("");
    manager.redo();
    expect(text.toString()).toBe("imported");
    doc.transact(() => text.insert(0, "someone else "), "provider");
    expect(seen).toEqual([true, true, false]);
  });

  it("does not count a transaction that changes neither text nor selection", () => {
    expect(isLocalActivity([state.update({})])).toBe(false);
  });
});
