import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  closeAll,
  createShare,
  editorText,
  joinByLink,
  newUser,
  shareIdOf,
  type User,
  waitForEditor,
} from "./helpers";

test("remote caret identity survives selection changes and another participant leaving", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Watching");
  const guests = [await newUser(browser, "First"), await newUser(browser, "Second")];
  try {
    // Session colors are random and may collide; tint identity needs two distinct colors.
    for (const [i, guest] of guests.entries()) {
      const response = await guest.context.request.patch("/api/session", {
        data: { color: i === 0 ? "#2563eb" : "#b45309" },
      });
      expect(response.ok()).toBe(true);
    }
    await owner.page.emulateMedia({ reducedMotion: "no-preference" });
    const id = await createShare(owner.page);
    await owner.page.getByTestId("device-choice-skip").click();
    await owner.page.locator(".cm-content").click();
    await owner.page.keyboard.type("a shared line of text");
    for (const guest of guests) {
      await joinByLink(guest, id);
      await waitForEditor(guest.page);
      await guest.page.getByTestId("device-choice-skip").click();
      await guest.page.locator(".cm-content").click();
      await guest.page.keyboard.press("End");
    }
    const carets = owner.page.locator(".cm-remote-caret");
    await expect(carets).toHaveCount(2);
    const names = await carets.locator(".cm-remote-caret-flag").allTextContents();
    const leaving = guests.find((guest) => guest.name === names[0]);
    const staying = guests.find((guest) => guest.name === names[1]);
    if (!leaving || !staying) throw new Error("missing participants");
    await owner.page.evaluate((name) => {
      const caret = [...document.querySelectorAll(".cm-remote-caret")].find(
        (el) => el.textContent === name,
      );
      if (!caret) throw new Error("missing remote caret");
      const probe = { caret, flag: caret.lastElementChild, removed: 0 };
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.removedNodes) {
            if (node === caret || (node instanceof Element && node.contains(caret)))
              probe.removed++;
          }
      }).observe(document.querySelector(".cm-remote-carets") as Element, {
        childList: true,
        subtree: true,
      });
      (window as unknown as { __remoteCaret: typeof probe }).__remoteCaret = probe;
    }, staying.name);
    for (let i = 0; i < 3; i++) {
      await staying.page.keyboard.press("Shift+ArrowLeft");
      await expect(owner.page.locator(".cm-remote-selection")).not.toHaveCount(0);
      await staying.page.keyboard.press("ArrowRight");
      await expect(owner.page.locator(".cm-remote-selection")).toHaveCount(0);
    }
    await leaving.page.keyboard.press("Shift+ArrowLeft");
    await staying.page.keyboard.press("Shift+ArrowLeft");
    await expect(owner.page.locator(".cm-remote-selection")).toHaveCount(2);
    await owner.page.evaluate((name) => {
      const caret = [...document.querySelectorAll<HTMLElement>(".cm-remote-caret")].find(
        (el) => el.textContent === name,
      );
      const color = caret?.style.getPropertyValue("--rc");
      const tint = [...document.querySelectorAll<HTMLElement>(".cm-remote-selection")].find(
        (el) => el.style.getPropertyValue("--rc") === color,
      );
      (window as unknown as { __tint: Element | undefined }).__tint = tint;
    }, staying.name);
    await leaving.page.keyboard.press("ArrowRight");
    await expect(owner.page.locator(".cm-remote-selection")).toHaveCount(1);
    expect(
      await owner.page.evaluate(
        () =>
          (window as unknown as { __tint: Element }).__tint ===
          document.querySelector(".cm-remote-selection"),
      ),
    ).toBe(true);
    await staying.page.keyboard.press("ArrowRight");
    await staying.page.keyboard.type(" continuous typing ", { delay: 90 });
    await expect.poll(() => editorText(owner.page)).toContain("continuous typing");
    const activeFlag = carets.filter({ hasText: staying.name }).locator(".cm-remote-caret-flag");
    await expect(activeFlag).toHaveCSS("opacity", "1");
    // A move during the idle fade keeps the flag visible instead of fading from zero again.
    await owner.page.waitForTimeout(2450);
    await staying.page.keyboard.press("ArrowLeft");
    await expect(carets.filter({ hasText: staying.name })).toHaveAttribute(
      "data-flag-from",
      "shown",
    );
    await staying.page.keyboard.press("ArrowRight");
    await leaving.context.close();
    await expect(carets).toHaveCount(1);
    await staying.page.keyboard.type("still typing", { delay: 90 });
    await expect.poll(() => editorText(owner.page)).toContain("still typing");
    expect(
      await owner.page.evaluate(() => {
        const probe = (
          window as unknown as { __remoteCaret: { caret: Element; flag: Element; removed: number } }
        ).__remoteCaret;
        return {
          removed: probe.removed,
          sameCaret: probe.caret === document.querySelector(".cm-remote-caret"),
          sameFlag: probe.flag === document.querySelector(".cm-remote-caret-flag"),
        };
      }),
    ).toEqual({ removed: 0, sameCaret: true, sameFlag: true });
  } finally {
    await closeAll(owner, ...guests);
  }
});

/** A room whose text has `lines` numbered lines; the owner made it, the others joined by link. */
async function room(browser: Browser, names: string[], lines = 12): Promise<User[]> {
  const people: User[] = [];
  for (const name of names) people.push(await newUser(browser, name));
  const [owner, ...guests] = people as [User, ...User[]];
  const id = await createShare(owner.page);
  await owner.page.getByTestId("device-choice-skip").click();
  await owner.page.locator(".cm-content").click();
  await owner.page.keyboard.insertText(
    Array.from({ length: lines }, (_, i) => `line number ${i + 1}`).join("\n"),
  );
  await owner.page.keyboard.press("Control+Home");
  for (const guest of guests) {
    await joinByLink(guest, id);
    await waitForEditor(guest.page);
    await guest.page.getByTestId("device-choice-skip").click();
    await guest.page.locator(".cm-content").click();
  }
  return people;
}

/** Puts the caret at the end of a line (from 1) with a click, which counts as moving there. */
async function goToLine(user: User, line: number) {
  await user.page
    .locator(".cm-line")
    .nth(line - 1)
    .click();
  await user.page.keyboard.press("End");
}

const caretOf = (page: Page, name: string) =>
  page.locator(".cm-remote-caret").filter({ hasText: name });
const flagOf = (page: Page, name: string) => caretOf(page, name).locator(".cm-remote-caret-flag");

async function expectFlagHidden(page: Page, name: string) {
  // A move made just before may still be on its way: "hidden" must not mean "not shown yet".
  await page.waitForTimeout(250);
  // Longer than the whole flag animation of that move.
  await expect(flagOf(page, name)).toHaveCSS("opacity", "0", { timeout: 6000 });
}

interface CaretProbe {
  /** Flag restarts per name. */
  flashes: Record<string, number>;
  /** Frames in which that caret had a running transform transition, per name. */
  glides: Record<string, number>;
  /** Every opacity seen on a flag, per name. */
  opacities: Record<string, number[]>;
}

/** Records, from the next frame on, what the layer does to each caret. */
async function watchCarets(page: Page) {
  await page.evaluate(() => {
    const probe = { flashes: {}, glides: {}, opacities: {} } as {
      flashes: Record<string, number>;
      glides: Record<string, number>;
      opacities: Record<string, number[]>;
    };
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as Element;
        if (!target.hasAttribute("data-flag")) continue;
        const name = target.textContent ?? "";
        probe.flashes[name] = (probe.flashes[name] ?? 0) + 1;
      }
    }).observe(document.querySelector(".cm-remote-carets") as Element, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-flag"],
    });
    const frame = () => {
      for (const caret of document.querySelectorAll(".cm-remote-caret")) {
        const name = caret.textContent ?? "";
        const gliding = caret
          .getAnimations()
          .some((a) => a instanceof CSSTransition && a.transitionProperty === "transform");
        if (gliding) probe.glides[name] = (probe.glides[name] ?? 0) + 1;
        const opacity = Number(getComputedStyle(caret.lastElementChild as Element).opacity);
        const seen = probe.opacities[name] ?? [];
        if (seen[seen.length - 1] !== opacity) seen.push(opacity);
        probe.opacities[name] = seen;
      }
      requestAnimationFrame(frame);
    };
    frame();
    (window as unknown as { __carets: typeof probe }).__carets = probe;
  });
}

const readProbe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __carets: CaretProbe }).__carets);

const resetProbe = (page: Page) =>
  page.evaluate(() => {
    const probe = (window as unknown as { __carets: CaretProbe }).__carets;
    probe.flashes = {};
    probe.glides = {};
    probe.opacities = {};
  });

async function chooseCursors(page: Page, label: string) {
  await page.getByTestId("settings-button").click();
  await page.getByTestId("select-remote-cursors").getByRole("combobox").click();
  await page.getByRole("option", { name: label, exact: true }).click();
  // The list closing and a toast may each take an Escape before the sheet does.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("select-remote-cursors")).toBeHidden({ timeout: 300 });
  }).toPass();
}

const screenshot = (page: Page, name: string) =>
  page.screenshot({
    path: resolve(dirname(fileURLToPath(import.meta.url)), `../../../.box-out/cursors/${name}.png`),
  });

/** The Hocuspocus message type of a frame: after the document name, as lib0 varints. */
function messageType(payload: string | Buffer): number | null {
  if (typeof payload === "string") return null;
  let at = 0;
  const varUint = () => {
    let value = 0;
    let unit = 1;
    for (;;) {
      const byte = payload[at++] as number;
      value += (byte & 0x7f) * unit;
      unit *= 128;
      if (byte < 128) return value;
    }
  };
  const nameLength = varUint();
  at += nameLength;
  return varUint();
}
const AWARENESS_MESSAGE = 1;

test("only the person's own activity shows a name or glides; text pushing a caret does not", async ({
  browser,
}) => {
  const [observer, typist, pushed] = (await room(browser, ["Watching", "Enter", "Pushed"])) as [
    User,
    User,
    User,
  ];
  try {
    await observer.page.emulateMedia({ reducedMotion: "no-preference" });
    await goToLine(typist, 1);
    await goToLine(pushed, 6);
    await expect(observer.page.locator(".cm-remote-caret")).toHaveCount(2);
    await expectFlagHidden(observer.page, pushed.name);
    await watchCarets(observer.page);

    // Someone presses Enter above B: B's caret follows the text, silently and at once.
    const before = await caretOf(observer.page, pushed.name).boundingBox();
    await typist.page.keyboard.press("Enter");
    await expect
      .poll(async () => (await caretOf(observer.page, pushed.name).boundingBox())?.y)
      .toBeGreaterThan(before?.y ?? 0);
    await expect(flagOf(observer.page, typist.name)).toHaveCSS("opacity", "1");
    let probe = await readProbe(observer.page);
    expect(probe.flashes[pushed.name]).toBeUndefined();
    expect(probe.glides[pushed.name]).toBeUndefined();
    await expect(flagOf(observer.page, pushed.name)).toHaveCSS("opacity", "0");

    // B types: now B's name shows.
    await pushed.page.keyboard.type("x");
    await expect(flagOf(observer.page, pushed.name)).toHaveCSS("opacity", "1");
    probe = await readProbe(observer.page);
    expect(probe.flashes[pushed.name]).toBeGreaterThan(0);

    // A short move of B's own glides.
    await resetProbe(observer.page);
    await pushed.page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await readProbe(observer.page)).glides[pushed.name] ?? 0)
      .toBeGreaterThan(0);
    expect((await readProbe(observer.page)).flashes[pushed.name]).toBeGreaterThan(0);

    // A long jump lands at once, and still counts as moving.
    await observer.page.waitForTimeout(200);
    await resetProbe(observer.page);
    const short = await caretOf(observer.page, pushed.name).boundingBox();
    await pushed.page.keyboard.press("Control+End");
    await expect
      .poll(async () => (await caretOf(observer.page, pushed.name).boundingBox())?.y)
      .toBeGreaterThan(short?.y ?? 0);
    probe = await readProbe(observer.page);
    expect(probe.glides[pushed.name]).toBeUndefined();
    expect(probe.flashes[pushed.name]).toBeGreaterThan(0);

    // My own undo comes through Yjs like a remote edit, but it is still me moving: the others
    // see my name, and my caret where it really is.
    await pushed.page.keyboard.type("abc");
    await expect.poll(() => editorText(observer.page)).toContain("abc");
    await expectFlagHidden(observer.page, pushed.name);
    await resetProbe(observer.page);
    await pushed.page.keyboard.press("Control+z");
    await expect.poll(() => editorText(observer.page)).not.toContain("abc");
    await expect
      .poll(async () => (await readProbe(observer.page)).flashes[pushed.name] ?? 0)
      .toBeGreaterThan(0);
    const own = await pushed.page.locator(".cm-cursor-primary").first().boundingBox();
    await expect
      .poll(async () => {
        const seen = await caretOf(observer.page, pushed.name).boundingBox();
        return Math.abs((seen?.x ?? 0) - (own?.x ?? 0));
      })
      .toBeLessThan(4);
  } finally {
    await closeAll(observer, typist, pushed);
  }
});

test("redraws, scrolling, resizing and joining show no name; a caret pushed by text stays right", async ({
  browser,
}) => {
  const [observer, peer, typist] = (await room(browser, ["Watching", "Peer", "Typing"], 300)) as [
    User,
    User,
    User,
  ];
  try {
    const page = observer.page;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.keyboard.press("Control+Home");
    await goToLine(peer, 2);
    // Long enough to wrap in a narrow window.
    await peer.page.keyboard.insertText(" long".repeat(20));
    await goToLine(typist, 3);
    await expect(page.locator(".cm-remote-caret")).toHaveCount(2);
    await expectFlagHidden(page, peer.name);
    await expectFlagHidden(page, typist.name);
    await watchCarets(page);
    const quiet = async () => {
      await page.waitForTimeout(300);
      const probe = await readProbe(page);
      expect(probe.flashes[peer.name]).toBeUndefined();
      expect(probe.glides[peer.name]).toBeUndefined();
      expect(probe.opacities[peer.name] ?? []).not.toContain(1);
    };

    // Scrolled far away the caret is not drawn at all; scrolled back it is drawn anew.
    const scroller = page.locator(".cm-scroller");
    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(caretOf(page, peer.name)).toHaveCount(0);
    await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(caretOf(page, peer.name)).toHaveCount(1);
    await quiet();

    // A narrow window wraps lines and moves carets to other pixels.
    const before = await caretOf(page, peer.name).boundingBox();
    await page.setViewportSize({ width: 400, height: 720 });
    await expect
      .poll(async () => (await caretOf(page, peer.name).boundingBox())?.x)
      .not.toBe(before?.x);
    await quiet();
    await page.setViewportSize({ width: 1280, height: 720 });
    await quiet();

    // Someone arriving who has not touched anything yet is a first sighting.
    const late = await newUser(browser, "Late");
    try {
      await joinByLink(late, shareIdOf(page));
      await waitForEditor(late.page);
      await expect(page.locator(".cm-remote-caret")).toHaveCount(3);
      await page.waitForTimeout(300);
      expect((await readProbe(page)).opacities[late.name] ?? []).not.toContain(1);
    } finally {
      await closeAll(late);
    }

    // Text inserted exactly at the peer's caret: the peer's position is corrected for the others
    // without looking like a move of theirs.
    await goToLine(peer, 5);
    await typist.page.locator(".cm-line").nth(4).click();
    await typist.page.keyboard.press("End");
    await expectFlagHidden(page, peer.name);
    await resetProbe(page);
    await typist.page.keyboard.type("inserted here");
    await expect.poll(() => editorText(page)).toContain("inserted here");
    const own = await peer.page.locator(".cm-cursor-primary").first().boundingBox();
    await expect
      .poll(async () => {
        const seen = await caretOf(page, peer.name).boundingBox();
        return Math.abs((seen?.x ?? 0) - (own?.x ?? 0));
      })
      .toBeLessThan(4);
    await quiet();
  } finally {
    await closeAll(observer, peer, typist);
  }
});

test("an idle client sends no cursor when someone else types", async ({ browser }) => {
  const typist = await newUser(browser, "Typing");
  const idle = await newUser(browser, "Idle");
  try {
    let sent = 0;
    idle.page.on("websocket", (socket) =>
      socket.on("framesent", (frame) => {
        if (messageType(frame.payload) === AWARENESS_MESSAGE) sent++;
      }),
    );
    const id = await createShare(typist.page);
    await typist.page.getByTestId("device-choice-skip").click();
    await typist.page.locator(".cm-content").click();
    await typist.page.keyboard.insertText("first line\nsecond line\n");
    await joinByLink(idle, id);
    await waitForEditor(idle.page);
    await idle.page.getByTestId("device-choice-skip").click();
    await idle.page.locator(".cm-content").click();
    await idle.page.keyboard.press("Control+Home");
    await idle.page.waitForTimeout(1500);
    sent = 0;
    const keys = 60;
    await typist.page.keyboard.type("x".repeat(keys), { delay: 50 });
    await expect.poll(() => editorText(idle.page)).toContain("x".repeat(keys));
    await idle.page.waitForTimeout(500);
    console.log(`idle client: ${sent} awareness frames while another client typed ${keys} keys`);
    // Awareness renews itself every 15 s, so one may fall inside this window.
    expect(sent).toBeLessThanOrEqual(1);
  } finally {
    await closeAll(typist, idle);
  }
});

/** Moves the pointer onto a person's caret, as a real mouse move. */
async function pointAtCaret(page: Page, name: string) {
  const box = await caretOf(page, name).locator(".cm-remote-caret-bar").boundingBox();
  if (!box) throw new Error("no caret box");
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
}

/** The participant list finds anyone: the avatar, or the "+N" list when there is no room for it. */
async function hoverPerson(page: Page, name: string) {
  const avatar = page.getByTestId("people").getByRole("button", { name: `Follow: ${name}` });
  if (await avatar.count()) await avatar.hover();
  else {
    await page.getByTestId("people-more").click();
    await page
      .getByTestId("people-more-list")
      .getByRole("button", { name: `Follow: ${name}` })
      .hover();
  }
}

const TINT_12 = / 0\.12\)$/;
const TINT_8 = / 0\.08\)$/;

test("a busy file: fainter selections, a name only for someone who starts, two at a time, no glide", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const [host, observer, first, second, third] = (await room(browser, [
    "Teacher",
    "Watching",
    "First",
    "Second",
    "Third",
  ])) as [User, User, User, User, User];
  try {
    const page = observer.page;
    const editor = page.locator(".cm-editor");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await goToLine(first, 3);
    await goToLine(second, 6);
    await goToLine(third, 9);
    await expect(page.locator(".cm-remote-caret")).toHaveCount(4);
    await expect(editor).toHaveAttribute("data-remote-cursors", "busy");
    for (const person of [first, second, third]) await expectFlagHidden(page, person.name);

    // The share owner's name stays on, and only theirs; bars keep full strength.
    await expect(caretOf(page, host.name)).toHaveAttribute("data-pinned", "");
    await expect(flagOf(page, host.name)).toHaveCSS("opacity", "1");
    await expect(caretOf(page, first.name)).not.toHaveAttribute("data-pinned", "");
    await expect(caretOf(page, first.name).locator(".cm-remote-caret-bar")).toHaveCSS(
      "opacity",
      "1",
    );

    // A selection is fainter than with a few people.
    await first.page.keyboard.press("Shift+ArrowLeft");
    const tint = page.locator(".cm-remote-selection");
    await expect(tint).toHaveCount(1);
    expect(await tint.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(TINT_12);
    await first.page.keyboard.press("ArrowRight");
    await expect(tint).toHaveCount(0);
    await screenshot(page, "busy");

    // Everyone has been quiet for longer than the quiet spell.
    await page.waitForTimeout(10_500);
    await watchCarets(page);
    await resetProbe(page);

    // First starts typing and goes on: the name comes once, and the caret never glides.
    await first.page.keyboard.type("x".repeat(40), { delay: 90 });
    await expect.poll(() => editorText(page)).toContain("x".repeat(40));
    await expectFlagHidden(page, first.name);
    let probe = await readProbe(page);
    expect(probe.flashes[first.name]).toBe(1);
    expect(probe.glides[first.name]).toBeUndefined();

    // One person in two tabs is one person: starting in the second tab right after the first is
    // not starting after being quiet.
    await page.waitForTimeout(10_500);
    await resetProbe(page);
    const secondTab = await first.context.newPage();
    await joinByLink({ ...first, page: secondTab }, shareIdOf(page));
    await waitForEditor(secondTab);
    await expect(page.locator(".cm-remote-caret")).toHaveCount(5);
    await first.page.keyboard.type("a");
    await expect.poll(() => editorText(page)).toContain("a");
    await expect
      .poll(async () => (await readProbe(page)).flashes[first.name] ?? 0)
      .toBeGreaterThan(0);
    await secondTab.locator(".cm-content").click();
    await secondTab.keyboard.type("Q");
    await expect.poll(() => editorText(page)).toContain("Q");
    await page.waitForTimeout(300);
    expect((await readProbe(page)).flashes[first.name]).toBe(1);
    await secondTab.close();
    await expect(page.locator(".cm-remote-caret")).toHaveCount(4);

    // Three start at once after another quiet spell: two names at a time at most, so one gets
    // none, and is not given one later when the others have faded.
    await page.waitForTimeout(10_500);
    await resetProbe(page);
    await Promise.all([
      first.page.keyboard.type("1"),
      second.page.keyboard.type("2"),
      third.page.keyboard.type("3"),
    ]);
    await expect
      .poll(async () => {
        const seen = (await readProbe(page)).flashes;
        return [first, second, third].filter((person) => seen[person.name] === 1).length;
      })
      .toBe(2);
    await expectFlagHidden(page, first.name);
    await expectFlagHidden(page, second.name);
    await expectFlagHidden(page, third.name);
    probe = await readProbe(page);
    const named = [first, second, third].filter((person) => probe.flashes[person.name] === 1);
    const denied = [first, second, third].filter(
      (person) => probe.flashes[person.name] === undefined,
    );
    expect(named).toHaveLength(2);
    expect(denied).toHaveLength(1);
    for (const person of [first, second, third]) expect(probe.glides[person.name]).toBeUndefined();
  } finally {
    await closeAll(host, observer, first, second, third);
  }
});

test("a crowded file: no name by itself, dimmer bars and selections, the host pinned, hysteresis", async ({
  browser,
  browserName,
}) => {
  test.setTimeout(300_000);
  const [host, observer, near, far, ...others] = (await room(browser, [
    "Teacher",
    "Watching",
    "Nearby",
    "Faraway",
    "Fifth",
    "Sixth",
    "Seventh",
    "Eighth",
  ])) as [User, User, User, User, User, User, User, User];
  try {
    const page = observer.page;
    const editor = page.locator(".cm-editor");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.keyboard.press("Control+Home");
    await goToLine(near, 1);
    await goToLine(far, 11);
    for (const [i, person] of others.entries()) await goToLine(person, 3 + i);
    await expect(page.locator(".cm-remote-caret")).toHaveCount(7);
    await expect(editor).toHaveAttribute("data-remote-cursors", "crowded");
    // Moves made while the others were still arriving may still be fading.
    for (const person of [near, far, ...others]) await expectFlagHidden(page, person.name);
    await watchCarets(page);

    // The share owner's name stays on, unfaded, and only theirs.
    await expect(caretOf(page, host.name)).toHaveAttribute("data-pinned", "");
    await expect(flagOf(page, host.name)).toHaveCSS("opacity", "1");
    await expect(caretOf(page, host.name).locator(".cm-remote-caret-bar")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(caretOf(page, far.name)).not.toHaveAttribute("data-pinned", "");

    // Bars are dimmer, except under a request for more contrast.
    const bar = caretOf(page, far.name).locator(".cm-remote-caret-bar");
    await expect(bar).toHaveCSS("opacity", "0.6");
    // Playwright has no prefers-contrast emulation in Firefox.
    if (browserName !== "firefox") {
      await page.emulateMedia({ contrast: "more" });
      await expect(bar).toHaveCSS("opacity", "1");
      await page.emulateMedia({ contrast: "no-preference" });
    }

    // Selections are fainter still.
    await far.page.keyboard.press("Shift+ArrowLeft");
    const tint = page.locator(".cm-remote-selection");
    await expect(tint).toHaveCount(1);
    expect(await tint.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(TINT_8);
    await far.page.keyboard.press("ArrowRight");
    await expect(tint).toHaveCount(0);
    await expectFlagHidden(page, far.name);

    // Nobody's name comes by itself: not far away, and not right beside my cursor either.
    await resetProbe(page);
    await far.page.keyboard.type("far");
    await expect.poll(() => editorText(page)).toContain("far");
    await near.page.keyboard.type("near");
    await expect.poll(() => editorText(page)).toContain("near");
    await page.waitForTimeout(400);
    const probe = await readProbe(page);
    expect(probe.flashes[far.name]).toBeUndefined();
    expect(probe.flashes[near.name]).toBeUndefined();
    await expect(flagOf(page, far.name)).toHaveCSS("opacity", "0");
    await expect(flagOf(page, near.name)).toHaveCSS("opacity", "0");
    await screenshot(page, "crowded");

    // Hovering a caret still shows the name, and moving away ends it.
    await pointAtCaret(page, far.name);
    await expect(flagOf(page, far.name)).toHaveCSS("opacity", "1");
    await page.mouse.move(2, 2);
    await expect(flagOf(page, far.name)).toHaveCSS("opacity", "0");

    // The participant list finds anyone: the avatars...
    await hoverPerson(page, near.name);
    await expect(caretOf(page, near.name)).toHaveAttribute("data-spot", "");
    await expect(flagOf(page, near.name)).toHaveCSS("opacity", "1");
    await expect(caretOf(page, near.name).locator(".cm-remote-caret-bar")).toHaveCSS(
      "opacity",
      "1",
    );
    await page.mouse.move(0, 400);
    await page.keyboard.press("Escape");
    await expect(caretOf(page, near.name)).not.toHaveAttribute("data-spot", "");
    await expect(flagOf(page, near.name)).toHaveCSS("opacity", "0");
    // ...and "+N", by keyboard as well: everyone beyond the first few is on this list.
    await page.getByTestId("people-more").focus();
    await page.keyboard.press("Enter");
    const list = page.getByTestId("people-more-list");
    await expect(list).toBeVisible();
    await screenshot(page, "people-list");
    // The list stays on screen in the narrowest window.
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(list).toBeVisible();
    const box = await list.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    await screenshot(page, "people-list-320");
    await page.setViewportSize({ width: 1280, height: 720 });
    const row = list.getByRole("button").first();
    await row.focus();
    await expect(page.locator(".cm-remote-caret[data-spot]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(page.locator(".cm-remote-caret[data-spot]")).toHaveCount(0);

    // `moving` shows everyone's moves however many people are here, at full strength.
    await chooseCursors(page, "Names when moving");
    await expect(editor).toHaveAttribute("data-remote-cursors", "normal");
    await expect(bar).toHaveCSS("opacity", "1");
    await expect(caretOf(page, host.name)).not.toHaveAttribute("data-pinned", "");
    await far.page.keyboard.type("!");
    await expect(flagOf(page, far.name)).toHaveCSS("opacity", "1");
    await expectFlagHidden(page, far.name);
    // Back in Auto: a name still showing goes at once, because none shows by itself here.
    await far.page.keyboard.type("!");
    await expect(flagOf(page, far.name)).toHaveCSS("opacity", "1");
    await chooseCursors(page, "Auto");
    await expect(editor).toHaveAttribute("data-remote-cursors", "crowded");
    await expect(caretOf(page, far.name)).not.toHaveAttribute("data-flag", /./);
    await expect(flagOf(page, far.name)).toHaveCSS("opacity", "0");

    // Leaving: still crowded at 7, busy at 6, back to normal only at 2.
    const [fifth, sixth, seventh, eighth] = others as [User, User, User, User];
    await eighth.context.close();
    await expect(page.locator(".cm-remote-caret")).toHaveCount(6);
    await page.waitForTimeout(300);
    await expect(editor).toHaveAttribute("data-remote-cursors", "crowded");
    await seventh.context.close();
    await expect(page.locator(".cm-remote-caret")).toHaveCount(5);
    await expect(editor).toHaveAttribute("data-remote-cursors", "busy");
    await expect(caretOf(page, host.name)).toHaveAttribute("data-pinned", "");
    await expect(bar).toHaveCSS("opacity", "1");
    await sixth.context.close();
    await fifth.context.close();
    await far.context.close();
    await expect(page.locator(".cm-remote-caret")).toHaveCount(2);
    await page.waitForTimeout(300);
    await expect(editor).toHaveAttribute("data-remote-cursors", "busy");
    await near.context.close();
    await expect(page.locator(".cm-remote-caret")).toHaveCount(1);
    await expect(editor).toHaveAttribute("data-remote-cursors", "normal");
    await expect(caretOf(page, host.name)).not.toHaveAttribute("data-pinned", "");
  } finally {
    await closeAll(host, observer, near, far, ...others);
  }
});

test("a caret pushed under a resting pointer opens no name; moving the pointer onto it does", async ({
  browser,
}) => {
  const [observer, peer, typist] = (await room(browser, ["Watching", "Peer", "Typing"])) as [
    User,
    User,
    User,
  ];
  try {
    const page = observer.page;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await goToLine(peer, 5);
    await goToLine(typist, 1);
    await expect(page.locator(".cm-remote-caret")).toHaveCount(2);
    await expectFlagHidden(page, peer.name);
    await expectFlagHidden(page, typist.name);

    // The pointer rests one line below the caret, on the line the text will push it to.
    const before = await caretOf(page, peer.name).locator(".cm-remote-caret-bar").boundingBox();
    if (!before) throw new Error("no caret box");
    await page.mouse.move(before.x + 2, before.y + before.height * 1.5);
    await page.waitForTimeout(300);
    await expect(caretOf(page, peer.name)).not.toHaveAttribute("data-spot", "");
    await watchCarets(page);

    await typist.page.keyboard.press("Enter");
    await expect
      .poll(async () => (await caretOf(page, peer.name).boundingBox())?.y)
      .toBeGreaterThan(before.y + before.height / 2);
    const after = await caretOf(page, peer.name).locator(".cm-remote-caret-bar").boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before.y + before.height))).toBeLessThan(before.height / 2);
    await page.waitForTimeout(500);
    await expect(caretOf(page, peer.name)).not.toHaveAttribute("data-spot", "");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");
    expect((await readProbe(page)).flashes[peer.name]).toBeUndefined();

    // A real move of the pointer onto the caret opens it.
    await pointAtCaret(page, peer.name);
    await expect(caretOf(page, peer.name)).toHaveAttribute("data-spot", "");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
  } finally {
    await closeAll(observer, peer, typist);
  }
});

test("a hover name goes when its caret scrolls away; Escape holds only until the caret has left", async ({
  browser,
}) => {
  const [observer, peer] = (await room(browser, ["Watching", "Peer"], 60)) as [User, User];
  try {
    const page = observer.page;
    await goToLine(peer, 5);
    await expect(page.locator(".cm-remote-caret")).toHaveCount(1);
    await expectFlagHidden(page, peer.name);

    await pointAtCaret(page, peer.name);
    await expect(caretOf(page, peer.name)).toHaveAttribute("data-spot", "");
    await page.locator(".cm-scroller").evaluate((el) => el.scrollTo({ top: 40 }));
    await expect(caretOf(page, peer.name)).not.toHaveAttribute("data-spot", "");
    await page.locator(".cm-scroller").evaluate((el) => el.scrollTo({ top: 0 }));

    await page.mouse.move(0, 400);
    await pointAtCaret(page, peer.name);
    await expect(caretOf(page, peer.name)).toHaveAttribute("data-spot", "");
    await page.keyboard.press("Escape");
    await expect(caretOf(page, peer.name)).not.toHaveAttribute("data-spot", "");
    const bar = caretOf(page, peer.name).locator(".cm-remote-caret-bar");
    const home = await bar.boundingBox();
    if (!home) throw new Error("no caret box");
    await goToLine(peer, 8);
    await expect.poll(async () => (await bar.boundingBox())?.y).toBeGreaterThan(home.y);
    await goToLine(peer, 5);
    await expect.poll(async () => (await bar.boundingBox())?.y).toBe(home.y);
    // Back under the pointer: it opens nothing until the pointer moves, and then it does.
    await page.waitForTimeout(300);
    await expect(caretOf(page, peer.name)).not.toHaveAttribute("data-spot", "");
    await page.mouse.move(home.x + 3, home.y + home.height / 2);
    await expect(caretOf(page, peer.name)).toHaveAttribute("data-spot", "");
  } finally {
    await closeAll(observer, peer);
  }
});

test("each cursor setting applies live, and hovering a caret shows the name in all of them", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const [observer, peer] = (await room(browser, ["Watching", "Peer"])) as [User, User];
  try {
    const page = observer.page;
    const editor = page.locator(".cm-editor");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await goToLine(peer, 6);
    await expect(page.locator(".cm-remote-caret")).toHaveCount(1);
    await expectFlagHidden(page, peer.name);
    await expect(editor).toHaveAttribute("data-remote-cursors", "normal");
    await screenshot(page, "normal");

    await chooseCursors(page, "Names always on");
    await expect(caretOf(page, peer.name)).toHaveAttribute("data-pinned", "");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await expect(flagOf(page, peer.name)).toHaveCSS("animation-name", "none");
    await watchCarets(page);
    await peer.page.keyboard.type("a");
    await expect.poll(() => editorText(page)).toMatch(/number 6a/);
    await page.waitForTimeout(300);
    expect((await readProbe(page)).flashes[peer.name]).toBeUndefined();
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");

    await chooseCursors(page, "Cursors only");
    await expect(editor).toHaveAttribute("data-remote-cursors", "carets");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");
    await peer.page.keyboard.press("Shift+ArrowLeft");
    const tint = page.locator(".cm-remote-selection");
    await expect(tint).toHaveCount(1);
    expect(await tint.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/ 0\.12\)$/);
    await peer.page.keyboard.press("ArrowRight");
    await resetProbe(page);
    await peer.page.keyboard.type("bcd");
    await expect.poll(() => editorText(page)).toContain("bcd");
    await page.waitForTimeout(300);
    expect((await readProbe(page)).flashes[peer.name]).toBeUndefined();
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");

    // Hover: within a few pixels of the bar, in this mode too; the layers still take no pointer.
    const hoverCaret = async () => {
      const box = await caretOf(page, peer.name).locator(".cm-remote-caret-bar").boundingBox();
      if (!box) throw new Error("no caret box");
      await page.mouse.move(box.x + 4, box.y + box.height / 2);
    };
    await expect(page.locator(".cm-remote-carets")).toHaveCSS("pointer-events", "none");
    await hoverCaret();
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await screenshot(page, "carets-hover");
    await page.mouse.move(2, 2);
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");
    await screenshot(page, "carets");

    // Escape hides the name and still reaches the search panel, which closes on it.
    await page.locator(".cm-content").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+f");
    await expect(page.locator(".cm-panel.cm-search")).toBeVisible();
    await hoverCaret();
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await page.keyboard.press("Escape");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");
    await expect(page.locator(".cm-panel.cm-search")).toBeHidden();
    // Leaving the editor clears it too, once it has shown again.
    await page.mouse.move(2, 2);
    await hoverCaret();
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await page.locator("header").first().hover();
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");

    await chooseCursors(page, "Names when moving");
    await expect(editor).toHaveAttribute("data-remote-cursors", "normal");
    await peer.page.keyboard.type("e");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await expectFlagHidden(page, peer.name);

    await chooseCursors(page, "Auto");
    await peer.page.keyboard.type("f");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");

    // Device-wide, like the other preferences.
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("gachipad.prefs") ?? "{}").remoteCursors,
      ),
    ).toBe("auto");
  } finally {
    await closeAll(observer, peer);
  }
});

test("a name opened by hover stays while the pointer is on it, and Escape closes it from anywhere", async ({
  browser,
}) => {
  const [observer, peer] = (await room(browser, ["Watching", "Peer"])) as [User, User];
  try {
    const page = observer.page;
    await goToLine(peer, 6);
    await chooseCursors(page, "Cursors only");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");
    const hover = async () => {
      const box = await caretOf(page, peer.name).locator(".cm-remote-caret-bar").boundingBox();
      if (!box) throw new Error("no caret box");
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    };
    await hover();

    // Onto the name, past the reach of the caret: it stays, and still takes no pointer events.
    const flag = await flagOf(page, peer.name).boundingBox();
    if (!flag) throw new Error("no flag box");
    await page.mouse.move(flag.x + flag.width - 2, flag.y + flag.height / 2, { steps: 4 });
    await page.waitForTimeout(300);
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await expect(page.locator(".cm-remote-carets")).toHaveCSS("pointer-events", "none");
    // Off it: gone.
    await page.mouse.move(flag.x + flag.width + 60, flag.y - 60, { steps: 2 });
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");

    // Escape with focus outside the editor, and the key is still there for others.
    await hover();
    await page.getByTestId("settings-button").focus();
    await page.evaluate(() => {
      const w = window as unknown as { __escapeSeen?: boolean };
      // In the same phase as the cursors' listener and after it: what it did to the event shows here.
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") w.__escapeSeen = !event.defaultPrevented;
        },
        { capture: true },
      );
    });
    await page.keyboard.press("Escape");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0");
    expect(
      await page.evaluate(() => (window as unknown as { __escapeSeen?: boolean }).__escapeSeen),
    ).toBe(true);
  } finally {
    await closeAll(observer, peer);
  }
});

test("switching to cursors only ends a name that is still showing, at once", async ({
  browser,
}) => {
  const [observer, peer] = (await room(browser, ["Watching", "Peer"])) as [User, User];
  try {
    const page = observer.page;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await goToLine(peer, 6);
    await expect(caretOf(page, peer.name)).toHaveCount(1);
    await expectFlagHidden(page, peer.name);

    // The option is one click away while the peer starts a flash of three seconds.
    const from = ["Auto", "Names when moving"];
    for (const [index, mode] of from.entries()) {
      if (index > 0) await chooseCursors(page, mode);
      await page.getByTestId("settings-button").click();
      await page.getByTestId("select-remote-cursors").getByRole("combobox").click();
      await peer.page.keyboard.type("x");
      await expect(caretOf(page, peer.name)).toHaveAttribute("data-flag", /^[ab]$/);
      await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
      await page.getByRole("option", { name: "Cursors only", exact: true }).click();
      await expect(caretOf(page, peer.name), mode).not.toHaveAttribute("data-flag", /./, {
        timeout: 1000,
      });
      await expect(flagOf(page, peer.name), mode).toHaveCSS("opacity", "0", { timeout: 1000 });
      await expect(async () => {
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("select-remote-cursors")).toBeHidden({ timeout: 300 });
      }).toPass();
    }
  } finally {
    await closeAll(observer, peer);
  }
});

test("a flag near the top of what is visible hangs below, wherever the document is scrolled", async ({
  browser,
}) => {
  const [observer, peer] = (await room(browser, ["Watching", "Peer"], 120)) as [User, User];
  try {
    const page = observer.page;
    await goToLine(peer, 20);
    const caret = caretOf(page, peer.name);
    await expect(caret).toHaveCount(1);
    await expect(caret).not.toHaveClass(/is-top/);
    // From where the caret is going, not where it is: it may still be gliding there.
    const scrollCaretTo = (offset: number) =>
      caret.evaluate((el, gap) => {
        const y = (el as HTMLElement).style.transform.match(/, ([\d.]+)px, /)?.[1];
        const scroller = document.querySelector(".cm-scroller") as HTMLElement;
        scroller.scrollTop = Number(y) - gap;
      }, offset);
    // At the very top of the visible part, far from the top of the document.
    await scrollCaretTo(0);
    await expect(caret).toHaveClass(/is-top/);
    const flag = await flagOf(page, peer.name).boundingBox();
    const scroller = await page.locator(".cm-scroller").boundingBox();
    expect(flag && scroller && flag.y >= scroller.y).toBe(true);
    // A little further down there is room above it again.
    await scrollCaretTo(200);
    await expect(caret).not.toHaveClass(/is-top/);
  } finally {
    await closeAll(observer, peer);
  }
});

test("undoing counts as activity, also the undo of a file dropped into the empty file", async ({
  browser,
}) => {
  const actor = await newUser(browser, "Actor");
  const observer = await newUser(browser, "Watching");
  try {
    const id = await createShare(actor.page);
    await actor.page.getByTestId("device-choice-skip").click();
    await joinByLink(observer, id);
    await waitForEditor(observer.page);
    await observer.page.getByTestId("device-choice-skip").click();
    const page = observer.page;
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Text put straight into the document before any selection was recorded for it.
    await actor.page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["dropped\n"], "first.py", { type: "text/plain" }));
      const target = document.querySelector(".cm-content") as Element;
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      }
    });
    await expect.poll(() => editorText(page)).toBe("dropped");
    await actor.page.locator(".cm-content").click();
    await expect(caretOf(page, actor.name)).toHaveCount(1);
    await expectFlagHidden(page, actor.name);

    await watchCarets(page);
    await actor.page.keyboard.press("Control+z");
    await expect.poll(() => editorText(page)).not.toContain("dropped");
    await expect
      .poll(async () => (await readProbe(page)).flashes[actor.name] ?? 0)
      .toBeGreaterThan(0);
    await expectFlagHidden(page, actor.name);

    await resetProbe(page);
    await actor.page.keyboard.press("Control+y");
    await expect.poll(() => editorText(page)).toBe("dropped");
    await expect
      .poll(async () => (await readProbe(page)).flashes[actor.name] ?? 0)
      .toBeGreaterThan(0);
  } finally {
    await closeAll(actor, observer);
  }
});

test("the person I follow and the presenter keep their names on, until they stop", async ({
  browser,
}) => {
  const [presenter, observer] = (await room(browser, ["Showing", "Watching"])) as [User, User];
  try {
    const page = observer.page;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await goToLine(presenter, 2);
    await expectFlagHidden(page, presenter.name);
    await watchCarets(page);

    // Keyboard focus on the person highlights their caret as well as hovering does.
    const avatar = page.getByRole("button", { name: `Follow: ${presenter.name}` });
    await avatar.focus();
    await expect(caretOf(page, presenter.name)).toHaveAttribute("data-spot", "");
    await expect(flagOf(page, presenter.name)).toHaveCSS("opacity", "1");
    await avatar.blur();
    await expect(caretOf(page, presenter.name)).not.toHaveAttribute("data-spot", "");
    await expect(flagOf(page, presenter.name)).toHaveCSS("opacity", "0");

    // Following.
    await avatar.click();
    await expect(caretOf(page, presenter.name)).toHaveAttribute("data-pinned", "");
    await expect(flagOf(page, presenter.name)).toHaveCSS("opacity", "1");
    await page.getByRole("button", { name: "Stop following" }).first().click();
    await expect(caretOf(page, presenter.name)).not.toHaveAttribute("data-pinned", "");
    // The pointer is still on their avatar, which highlights them; off it the name goes.
    await page.mouse.move(2, 400);
    // Unpinning is no activity: the name goes, and no flash starts.
    await expect(flagOf(page, presenter.name)).toHaveCSS("opacity", "0");
    expect((await readProbe(page)).flashes[presenter.name]).toBeUndefined();

    // Presenting: pinned through the automatic follow, and after I stop following too.
    await presenter.page.getByTestId("menu-button").click();
    await presenter.page.getByRole("menuitem", { name: "Sync everyone to me" }).click();
    await expect(caretOf(page, presenter.name)).toHaveAttribute("data-pinned", "");
    await expect(page.getByTestId("banner-following")).toBeVisible();
    await page.getByTestId("banner-following").getByRole("button").first().click();
    await expect(page.getByTestId("banner-following")).toBeHidden();
    await expect(caretOf(page, presenter.name)).toHaveAttribute("data-pinned", "");
    await expect(flagOf(page, presenter.name)).toHaveCSS("opacity", "1");
  } finally {
    await closeAll(presenter, observer);
  }
});

test("reduced motion: a flag still comes and goes, with no fade or glide", async ({ browser }) => {
  const [observer, peer] = (await room(browser, ["Still", "Peer"])) as [User, User];
  try {
    const page = observer.page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await goToLine(peer, 3);
    await expect(page.locator(".cm-remote-caret")).toHaveCount(1);
    await expectFlagHidden(page, peer.name);
    await watchCarets(page);
    await peer.page.keyboard.press("ArrowLeft");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0", { timeout: 6000 });
    const probe = await readProbe(page);
    expect(probe.flashes[peer.name]).toBe(1);
    expect(probe.glides[peer.name]).toBeUndefined();
    // On or off in the rendered frames; nothing in between.
    expect(probe.opacities[peer.name]?.every((opacity) => opacity === 0 || opacity === 1)).toBe(
      true,
    );
    // A move while it shows starts the same time over, through the other animation name.
    await peer.page.keyboard.press("ArrowLeft");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await peer.page.keyboard.press("ArrowLeft");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "0", { timeout: 6000 });
    // Pinned names stay.
    await chooseCursors(page, "Names always on");
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
    await page.waitForTimeout(3000);
    await expect(flagOf(page, peer.name)).toHaveCSS("opacity", "1");
  } finally {
    await closeAll(observer, peer);
  }
});
