import { describe, expect, it } from "vitest";
import { attachment, basename, decodeText, firstLines, sanitizePath } from "./files.js";
import { DEFAULT_LANGUAGE, languageForPath } from "./languages.js";

describe("sanitizePath", () => {
  it("puts a name from macOS in NFC, so it is the same name as one typed elsewhere", () => {
    const nfc = "폴더/과제1.py";
    expect(sanitizePath(nfc.normalize("NFD"))).toBe(nfc);
  });

  it("normalises separators and redundant segments", () => {
    expect(sanitizePath("src\\app/./main.ts")).toBe("src/app/main.ts");
    expect(sanitizePath("/abs/olute.py")).toBe("abs/olute.py");
    expect(sanitizePath("a//b.txt")).toBe("a/b.txt");
  });

  it("rejects traversal, drive letters, control characters and empty paths", () => {
    for (const bad of ["../x", "a/../../x", "a/..", "C:/Windows/x", "a\u0000b", "", "/", "./."]) {
      expect(sanitizePath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rejects paths over the length limit", () => {
    expect(sanitizePath("a".repeat(300))).toBeNull();
    expect(sanitizePath("a".repeat(260))).not.toBeNull();
  });
});

describe("text detection", () => {
  it("decodes UTF-8 text including Korean", () => {
    expect(decodeText(new TextEncoder().encode("안녕 gachipad\n"))).toBe("안녕 gachipad\n");
  });

  it("treats NUL bytes and invalid UTF-8 as binary", () => {
    expect(decodeText(new Uint8Array([0x68, 0x00, 0x69]))).toBeNull();
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
  });
});

describe("helpers", () => {
  it("keeps the first lines only", () => {
    expect(firstLines("a\nb\nc\nd", 2)).toBe("a\nb");
    expect(firstLines("one")).toBe("one");
    expect(firstLines("a\nb\n")).toBe("a\nb");
    expect(firstLines("a\n\n")).toBe("a\n");
    expect(firstLines("")).toBe("");
    expect(firstLines(Array.from({ length: 20 }, (_, i) => i).join("\n"))).toBe(
      "0\n1\n2\n3\n4\n5\n6\n7",
    );
  });

  it("takes the last path segment", () => {
    expect(basename("a/b/c.ts")).toBe("c.ts");
    expect(basename("c.ts")).toBe("c.ts");
  });

  it("builds a safe Content-Disposition with a UTF-8 name", () => {
    const header = attachment('한글 "파일".ts');
    expect(header.startsWith("attachment; filename=")).toBe(true);
    expect(header).not.toMatch(/[^\x20-\x7e]/);
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('한글 "파일".ts')}`);
    expect(header).not.toContain('"파일"');
  });

  it("maps extensions to languages with a plain-text fallback", () => {
    expect(languageForPath("src/a.TS")).toBe("typescript");
    expect(languageForPath("main.py")).toBe("python");
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("notes.unknownext")).toBe(DEFAULT_LANGUAGE);
    expect(languageForPath("README")).toBe(DEFAULT_LANGUAGE);
  });
});
