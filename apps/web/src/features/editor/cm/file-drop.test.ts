import { describe, expect, it, vi } from "vitest";
import { editorFileDropHandlers, pastedFiles, transferHasFiles } from "./file-drop";

const withTypes = (...types: string[]) => ({ types }) as unknown as DataTransfer;

describe("editorFileDropHandlers", () => {
  it("claims a drop of files so CodeMirror never inserts their text, and imports nothing itself", () => {
    const handlers = editorFileDropHandlers();
    const preventDefault = vi.fn();
    const event = { dataTransfer: withTypes("Files"), preventDefault };
    expect(handlers.drop(event)).toBe(true);
    expect(handlers.dragover(event)).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it("leaves text drags (moving a selection, dropping text) to CodeMirror", () => {
    const handlers = editorFileDropHandlers();
    const preventDefault = vi.fn();
    const event = { dataTransfer: withTypes("text/plain"), preventDefault };
    expect(handlers.drop(event)).toBe(false);
    expect(handlers.dragover(event)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("recognises only a drag that carries files", () => {
    expect(transferHasFiles(withTypes("text/plain", "Files"))).toBe(true);
    expect(transferHasFiles(withTypes("application/x-gachipad-file", "text/plain"))).toBe(false);
    expect(transferHasFiles(null)).toBe(false);
  });
});

describe("pastedFiles", () => {
  const clip = (files: File[], text: string) => ({ files, getData: () => text });

  it("takes the files of a copy from Finder or Explorer: the files, with at most their own names as text", () => {
    const file = new File(["x"], "main.py");
    expect(pastedFiles(clip([file], "main.py"))).toEqual([file]);
    expect(pastedFiles(clip([file], ""))).toEqual([file]);
    const other = new File(["y"], "util.py");
    expect(pastedFiles(clip([file, other], "main.py\r\nutil.py"))).toEqual([file, other]);
  });

  it("leaves ordinary text alone, also when an image of it came along", () => {
    const image = new File(["x"], "image.png");
    expect(pastedFiles(clip([], "print(1)"))).toEqual([]);
    expect(pastedFiles(clip([image], "a\tb\nc\td"))).toEqual([]);
    expect(pastedFiles(clip([], ""))).toEqual([]);
    expect(pastedFiles(null)).toEqual([]);
  });

  it("reads clipboard items when the file list is empty", () => {
    const file = new File(["x"], "main.py");
    const items = [
      { kind: "file", getAsFile: () => file },
      { kind: "string", getAsFile: () => null },
    ];
    expect(
      pastedFiles({
        files: [],
        items: items as unknown as DataTransferItemList,
        getData: () => "main.py",
      }),
    ).toEqual([file]);
  });
});
