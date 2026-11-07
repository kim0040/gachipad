import { describe, expect, it } from "vitest";
import {
  CARET_HIT_SLOP_PX,
  CROWD_ENTER_PEOPLE,
  CROWD_LEAVE_PEOPLE,
  caretAt,
  densityOf,
  FLAG_ROOM_PX,
  flagHangsBelow,
  flashesName,
  GLIDE_MAX_LINES,
  GLIDE_MAX_X_PX,
  isPinned,
  linesApart,
  movedChanged,
  NEAR_CURSOR_LINES,
  nextCrowded,
  peopleOnFile,
  shouldGlide,
} from "./remote-cursor-rules";

const nobody = { presenter: false, followed: false, host: false };

describe("crowd hysteresis", () => {
  it("uses the limits the spec names: in at 6, out at 4", () => {
    expect(CROWD_ENTER_PEOPLE).toBe(6);
    expect(CROWD_LEAVE_PEOPLE).toBe(4);
  });

  it("enters only at the upper limit", () => {
    expect(nextCrowded(false, CROWD_ENTER_PEOPLE - 1)).toBe(false);
    expect(nextCrowded(false, CROWD_ENTER_PEOPLE)).toBe(true);
  });

  it("stays crowded between the limits and leaves only at the lower one", () => {
    expect(nextCrowded(true, CROWD_ENTER_PEOPLE - 1)).toBe(true);
    expect(nextCrowded(true, CROWD_LEAVE_PEOPLE + 1)).toBe(true);
    expect(nextCrowded(true, CROWD_LEAVE_PEOPLE)).toBe(false);
  });

  it("does not flap for a head count going back and forth between the limits", () => {
    let crowded = false;
    const seen = [6, 5, 6, 5, 5, 6].map((people) => {
      crowded = nextCrowded(crowded, people);
      return crowded;
    });
    expect(seen).toEqual([true, true, true, true, true, true]);
  });
});

describe("peopleOnFile", () => {
  const user = (clientId: string) => ({ clientId });

  it("counts two tabs of one person once and ignores other files and nameless states", () => {
    const states = [
      { user: user("a"), fileId: "main" },
      { user: user("a"), fileId: "main" },
      { user: user("b"), fileId: "main" },
      { user: user("c"), fileId: "other" },
      { user: user("d") },
      { fileId: "main" },
    ];
    expect(peopleOnFile(states, "main", undefined)).toBe(2);
  });

  it("counts me even before my file has been published, once", () => {
    expect(peopleOnFile([], "main", "me")).toBe(1);
    expect(peopleOnFile([{ user: user("me"), fileId: "main" }], "main", "me")).toBe(1);
  });
});

describe("the moved rule", () => {
  it("counts only a change between two numbers", () => {
    expect(movedChanged(3, 4)).toBe(true);
    expect(movedChanged(4, 4)).toBe(false);
  });

  it("does not count a first sighting, an old tab or a broken value", () => {
    expect(movedChanged(undefined, 4)).toBe(false);
    expect(movedChanged(undefined, undefined)).toBe(false);
    expect(movedChanged(4, undefined)).toBe(false);
    expect(movedChanged("3", 4)).toBe(false);
  });
});

describe("shouldGlide", () => {
  const line = 20;

  it("never glides a passive change, however short", () => {
    expect(shouldGlide(false, 8, 0, line)).toBe(false);
    expect(shouldGlide(false, 0, line, line)).toBe(false);
  });

  it("glides short active moves", () => {
    expect(shouldGlide(true, 8, 0, line)).toBe(true);
    expect(shouldGlide(true, 0, line, line)).toBe(true);
    expect(shouldGlide(true, GLIDE_MAX_X_PX, line * GLIDE_MAX_LINES, line)).toBe(true);
  });

  it("jumps over more than about a line or a long way along it", () => {
    expect(shouldGlide(true, 0, line * 2, line)).toBe(false);
    expect(shouldGlide(true, 0, -line * 2, line)).toBe(false);
    expect(shouldGlide(true, GLIDE_MAX_X_PX + 1, 0, line)).toBe(false);
    expect(shouldGlide(true, -(GLIDE_MAX_X_PX + 1), 0, line)).toBe(false);
  });
});

describe("modes", () => {
  it("is crowded only in auto with a crowd, and carets is its own density", () => {
    expect(densityOf("auto", true)).toBe("crowded");
    expect(densityOf("auto", false)).toBe("normal");
    expect(densityOf("moving", true)).toBe("normal");
    expect(densityOf("always", true)).toBe("normal");
    expect(densityOf("carets", false)).toBe("carets");
    expect(densityOf("carets", true)).toBe("carets");
  });

  it("flashes near people only when crowded", () => {
    expect(flashesName("auto", false, 1000)).toBe(true);
    expect(flashesName("auto", true, NEAR_CURSOR_LINES)).toBe(true);
    expect(flashesName("auto", true, 0)).toBe(true);
    expect(flashesName("auto", true, NEAR_CURSOR_LINES + 1)).toBe(false);
  });

  it("flashes everyone in moving however many people are here", () => {
    expect(flashesName("moving", true, 1000)).toBe(true);
    expect(flashesName("moving", false, 1000)).toBe(true);
  });

  it("never flashes in always or carets", () => {
    for (const crowded of [false, true]) {
      expect(flashesName("always", crowded, 0)).toBe(false);
      expect(flashesName("carets", crowded, 0)).toBe(false);
    }
  });

  it("pins the presenter and follow target outside carets; the host only when crowded", () => {
    for (const mode of ["auto", "moving"] as const) {
      for (const crowded of [false, true]) {
        expect(isPinned(mode, crowded, { ...nobody, presenter: true })).toBe(true);
        expect(isPinned(mode, crowded, { ...nobody, followed: true })).toBe(true);
        expect(isPinned(mode, crowded, nobody)).toBe(false);
      }
    }
    expect(isPinned("auto", true, { ...nobody, host: true })).toBe(true);
    expect(isPinned("auto", false, { ...nobody, host: true })).toBe(false);
    expect(isPinned("moving", true, { ...nobody, host: true })).toBe(false);
  });

  it("pins everyone in always and nobody in carets", () => {
    expect(isPinned("always", false, nobody)).toBe(true);
    const everything = { presenter: true, followed: true, host: true };
    expect(isPinned("carets", true, everything)).toBe(false);
  });
});

describe("linesApart", () => {
  const lineHeight = 20;

  it("counts rows on the screen when both carets are drawn: a long wrapped line is not one line", () => {
    expect(linesApart(0, 500, 100, lineHeight)).toBe(20);
    expect(linesApart(0, 160, 100, lineHeight)).toBe(NEAR_CURSOR_LINES);
  });

  it("counts lines of the document when my caret is not drawn", () => {
    expect(linesApart(7, 500, null, lineHeight)).toBe(7);
  });
});

describe("flagHangsBelow", () => {
  it("is about the visible top, not the top of the document", () => {
    expect(flagHangsBelow(FLAG_ROOM_PX - 1, 0)).toBe(true);
    expect(flagHangsBelow(FLAG_ROOM_PX, 0)).toBe(false);
    expect(flagHangsBelow(1200, 1200)).toBe(true);
    expect(flagHangsBelow(1200 + FLAG_ROOM_PX, 1200)).toBe(false);
    expect(flagHangsBelow(1200, 0)).toBe(false);
  });
});

describe("caretAt", () => {
  const carets = [
    { id: 1, x: 100, y: 40, height: 20 },
    { id: 2, x: 106, y: 40, height: 20 },
    { id: 3, x: 300, y: 100, height: 20 },
  ];

  it("finds a caret within the slop either side, on its own line only", () => {
    expect(caretAt(carets, 300 + CARET_HIT_SLOP_PX, 110)).toBe(3);
    expect(caretAt(carets, 300 - CARET_HIT_SLOP_PX, 110)).toBe(3);
    expect(caretAt(carets, 300 + CARET_HIT_SLOP_PX + 1, 110)).toBeNull();
    expect(caretAt(carets, 300, 99)).toBeNull();
    expect(caretAt(carets, 300, 121)).toBeNull();
  });

  it("takes the nearest of two overlapping carets", () => {
    expect(caretAt(carets, 101, 50)).toBe(1);
    expect(caretAt(carets, 105, 50)).toBe(2);
  });

  it("finds nothing when nothing is drawn", () => {
    expect(caretAt([], 10, 10)).toBeNull();
  });
});
