import { describe, expect, it } from "vitest";
import {
  ACTIVITY_QUIET_MS,
  BUSY_ENTER_PEOPLE,
  BUSY_LEAVE_PEOPLE,
  CARET_HIT_SLOP_PX,
  CROWDED_ENTER_PEOPLE,
  CROWDED_LEAVE_PEOPLE,
  type CrowdLevel,
  caretAt,
  densityOf,
  FLAG_ROOM_PX,
  flagHangsBelow,
  flashesName,
  GLIDE_MAX_LINES,
  GLIDE_MAX_X_PX,
  glidesIn,
  isPinned,
  MAX_BUSY_NAMES,
  movedChanged,
  nextCrowdLevel,
  peopleOnFile,
  shouldGlide,
  startedAfterQuiet,
} from "./remote-cursor-rules";

const nobody = { presenter: false, followed: false, host: false };

describe("crowd levels", () => {
  it("uses the limits the spec names: busy in at 4 and out at 2, crowded in at 8 and out at 6", () => {
    expect(BUSY_ENTER_PEOPLE).toBe(4);
    expect(BUSY_LEAVE_PEOPLE).toBe(2);
    expect(CROWDED_ENTER_PEOPLE).toBe(8);
    expect(CROWDED_LEAVE_PEOPLE).toBe(6);
  });

  it("enters each level only at its upper limit", () => {
    expect(nextCrowdLevel("few", 3)).toBe("few");
    expect(nextCrowdLevel("few", 4)).toBe("busy");
    expect(nextCrowdLevel("few", 7)).toBe("busy");
    expect(nextCrowdLevel("busy", 7)).toBe("busy");
    expect(nextCrowdLevel("busy", 8)).toBe("crowded");
  });

  it("stays busy between the limits and leaves only at the lower one", () => {
    expect(nextCrowdLevel("busy", 3)).toBe("busy");
    expect(nextCrowdLevel("busy", 2)).toBe("few");
    expect(nextCrowdLevel("busy", 1)).toBe("few");
  });

  it("stays crowded between the limits and drops to busy at the lower one", () => {
    expect(nextCrowdLevel("crowded", 7)).toBe("crowded");
    expect(nextCrowdLevel("crowded", 6)).toBe("busy");
    expect(nextCrowdLevel("crowded", 3)).toBe("busy");
  });

  it("lands on the right level at once after a jump", () => {
    expect(nextCrowdLevel("few", 10)).toBe("crowded");
    expect(nextCrowdLevel("few", 8)).toBe("crowded");
    expect(nextCrowdLevel("crowded", 2)).toBe("few");
    expect(nextCrowdLevel("crowded", 1)).toBe("few");
  });

  it("does not flap for a head count going back and forth between the limits", () => {
    let level: CrowdLevel = "few";
    const seen = [4, 3, 4, 3, 3, 4].map((people) => {
      level = nextCrowdLevel(level, people);
      return level;
    });
    expect(seen).toEqual(["busy", "busy", "busy", "busy", "busy", "busy"]);
    const crowd = [8, 7, 8, 7, 7, 8].map((people) => {
      level = nextCrowdLevel(level, people);
      return level;
    });
    expect(crowd).toEqual(["crowded", "crowded", "crowded", "crowded", "crowded", "crowded"]);
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
  it("is busy or crowded only in auto, and carets is its own density", () => {
    expect(densityOf("auto", "few")).toBe("normal");
    expect(densityOf("auto", "busy")).toBe("busy");
    expect(densityOf("auto", "crowded")).toBe("crowded");
    for (const level of ["few", "busy", "crowded"] as const) {
      expect(densityOf("moving", level)).toBe("normal");
      expect(densityOf("always", level)).toBe("normal");
      expect(densityOf("carets", level)).toBe("carets");
    }
  });

  it("glides in normal and carets only", () => {
    expect(glidesIn("normal")).toBe(true);
    expect(glidesIn("carets")).toBe(true);
    expect(glidesIn("busy")).toBe(false);
    expect(glidesIn("crowded")).toBe(false);
  });

  it("flashes every activity in normal", () => {
    expect(flashesName("normal", false, 0)).toBe(true);
    expect(flashesName("normal", true, 5)).toBe(true);
  });

  it("flashes in busy only a start, and only while fewer than two names show", () => {
    expect(MAX_BUSY_NAMES).toBe(2);
    expect(flashesName("busy", true, 0)).toBe(true);
    expect(flashesName("busy", true, 1)).toBe(true);
    expect(flashesName("busy", true, 2)).toBe(false);
    expect(flashesName("busy", true, 3)).toBe(false);
    expect(flashesName("busy", false, 0)).toBe(false);
  });

  it("never flashes in crowded or carets", () => {
    for (const density of ["crowded", "carets"] as const) {
      expect(flashesName(density, true, 0)).toBe(false);
      expect(flashesName(density, false, 0)).toBe(false);
    }
  });

  it("counts a start after at least ten quiet seconds, or a first sighting", () => {
    expect(ACTIVITY_QUIET_MS).toBe(10_000);
    expect(startedAfterQuiet(undefined, 1000)).toBe(true);
    expect(startedAfterQuiet(1000, 1000 + ACTIVITY_QUIET_MS)).toBe(true);
    expect(startedAfterQuiet(1000, 1000 + ACTIVITY_QUIET_MS - 1)).toBe(false);
    expect(startedAfterQuiet(1000, 1001)).toBe(false);
  });

  it("pins the presenter and follow target outside carets; the host only when busy or crowded", () => {
    for (const mode of ["auto", "moving"] as const) {
      for (const level of ["few", "busy", "crowded"] as const) {
        expect(isPinned(mode, level, { ...nobody, presenter: true })).toBe(true);
        expect(isPinned(mode, level, { ...nobody, followed: true })).toBe(true);
        expect(isPinned(mode, level, nobody)).toBe(false);
      }
    }
    expect(isPinned("auto", "crowded", { ...nobody, host: true })).toBe(true);
    expect(isPinned("auto", "busy", { ...nobody, host: true })).toBe(true);
    expect(isPinned("auto", "few", { ...nobody, host: true })).toBe(false);
    expect(isPinned("moving", "crowded", { ...nobody, host: true })).toBe(false);
  });

  it("pins everyone in always and nobody in carets", () => {
    expect(isPinned("always", "few", nobody)).toBe(true);
    const everything = { presenter: true, followed: true, host: true };
    expect(isPinned("carets", "crowded", everything)).toBe(false);
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
