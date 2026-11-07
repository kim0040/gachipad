import { type Browser, expect, type Page, test } from "@playwright/test";
import { BASE_URL, TIP_UNSEEN_STORAGE } from "./env";
import {
  closeAll,
  createShare,
  joinByLink,
  newUser,
  openShareDialog,
  type User,
  waitForEditor,
} from "./helpers";

/** The version the app's tour is at; people who stored an older one see the tour once more. */
const TOUR_VERSION = "2";

/** After the editor is up, the tour waits for a quiet moment (700ms) before it comes in. */
const QUIET_MS = 1500;

/** A browser profile that has never seen the tour: the config seeds the key, this one does not. */
async function firstTimer(
  browser: Browser,
  label: string,
  options: {
    viewport?: { width: number; height: number };
    reducedMotion?: "reduce" | "no-preference";
    colorScheme?: "dark" | "light";
    forcedColors?: "active" | "none";
    contrast?: "more" | "no-preference";
    storageState?: typeof TIP_UNSEEN_STORAGE;
  } = {},
): Promise<User> {
  const name = `${label}${Date.now().toString(36).slice(-4)}`;
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: "en-US",
    extraHTTPHeaders: { "X-Gachipad": "1" },
    storageState: { cookies: [], origins: [] },
    ...options,
  });
  const response = await context.request.patch("/api/session", { data: { name } });
  expect(response.ok()).toBe(true);
  return { context, page: await context.newPage(), name };
}

/** The editor's one-time device question goes first; the tour waits until it is answered. */
async function answerDeviceQuestion(page: Page): Promise<void> {
  await page.getByTestId("device-choice-skip").click();
  await expect(page.getByTestId("device-choice")).toBeHidden();
}

const tourDialog = (page: Page) => page.getByTestId("tour");

/** Every transition and entry animation of the popover is over, so its box is where it stays. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const tour = document.querySelector('[data-testid="tour"]');
    return tour !== null && tour.getAnimations().length === 0;
  });
}

async function counter(page: Page): Promise<string> {
  return (await page.getByTestId("tour-step").textContent()) ?? "";
}

async function storedVersion(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("gachipad.tour"));
}

async function walkToDone(page: Page): Promise<number> {
  let steps = 1;
  while ((await page.getByTestId("tour-next").textContent()) !== "Done") {
    await page.keyboard.press("Enter");
    steps++;
    await expect(page.getByTestId("tour-step")).toContainText(`${steps} /`);
  }
  return steps;
}

test("a first visit gets the tour, keyboard only, once; Settings replays it", async ({
  browser,
}) => {
  const user = await firstTimer(browser, "Tour");
  const { page } = user;
  try {
    await createShare(page);

    // Not while the device question is open.
    await expect(page.getByTestId("device-choice")).toBeVisible();
    await page.waitForTimeout(QUIET_MS);
    await expect(tourDialog(page)).toBeHidden();

    await answerDeviceQuestion(page);
    await expect(tourDialog(page)).toBeVisible();
    await expect(tourDialog(page)).toHaveAttribute("role", "dialog");
    await expect(page.getByRole("dialog", { name: "Invite others" })).toBeVisible();
    await expect(page.getByTestId("tour-step")).toHaveText("1 / 5");
    // Focus moved into the popover, onto the button Enter walks forward with.
    await expect(page.getByTestId("tour-next")).toBeFocused();
    await expect(page.getByTestId("tour-back")).toHaveCount(0);

    // Back and forth by keyboard; the live region announces the step.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tour-step")).toHaveText("2 / 5");
    await expect(tourDialog(page).getByRole("status")).toContainText("Step 2 of 5: Who is here");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("tour-back")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tour-step")).toHaveText("1 / 5");
    await expect(page.getByTestId("tour-next")).toBeFocused();

    // Focus cannot leave the popover.
    for (let press = 0; press < 7; press++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.activeElement?.closest('[data-testid="tour"]') !== null),
      ).toBe(true);
    }

    // An Escape that cancels an input-method composition does not close the tour.
    await page.getByTestId("tour-next").focus();
    await page.evaluate(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          keyCode: 229,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(tourDialog(page)).toBeVisible();

    expect(await walkToDone(page)).toBe(5);
    await expect(page.getByTestId("tour-next")).toHaveText("Done");
    await expect(page.getByTestId("tour-skip")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(tourDialog(page)).toBeHidden();
    expect(await storedVersion(page)).toBe(TOUR_VERSION);

    // Seen: a reload does not bring it back.
    await page.reload();
    await waitForEditor(page);
    await page.waitForTimeout(QUIET_MS);
    await expect(tourDialog(page)).toBeHidden();

    // Settings > Replay tutorial plays it again from the start.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("replay-tour").click();
    await expect(tourDialog(page)).toBeVisible();
    await expect(page.getByTestId("tour-step")).toHaveText("1 / 5");
    await expect(page.getByTestId("tour-next")).toBeFocused();

    // Escape closes it, and counts as seen.
    await page.keyboard.press("Escape");
    await expect(tourDialog(page)).toBeHidden();
    expect(await storedVersion(page)).toBe(TOUR_VERSION);
  } finally {
    await closeAll(user);
  }
});

test("Skip ends the tour and it stays gone on the next visit", async ({ browser }) => {
  const user = await firstTimer(browser, "Skip");
  const { page } = user;
  try {
    await createShare(page);
    await answerDeviceQuestion(page);
    await expect(tourDialog(page)).toBeVisible();
    await page.getByTestId("tour-next").click();
    await page.getByTestId("tour-skip").click();
    await expect(tourDialog(page)).toBeHidden();
    expect(await storedVersion(page)).toBe(TOUR_VERSION);
    // Another share in the same browser: still no tour.
    await createShare(page);
    await page.waitForTimeout(QUIET_MS);
    await expect(tourDialog(page)).toBeHidden();
  } finally {
    await closeAll(user);
  }
});

test("a browser that already saw the tour, and the marketing pages, never show it", async ({
  browser,
}) => {
  // newUser profiles start with the tour seen (playwright.config.ts).
  const returning = await newUser(browser, "Back");
  const fresh = await firstTimer(browser, "Pages");
  try {
    await createShare(returning.page);
    await answerDeviceQuestion(returning.page);
    await returning.page.waitForTimeout(QUIET_MS);
    await expect(tourDialog(returning.page)).toBeHidden();

    // A first-timer on the home page and the guide: the tour belongs to the editor.
    for (const path of ["/", "/guide/how"]) {
      await fresh.page.goto(path);
      await expect(fresh.page.getByRole("main")).toBeVisible();
      await fresh.page.waitForTimeout(QUIET_MS);
      await expect(tourDialog(fresh.page)).toBeHidden();
    }
    expect(await storedVersion(fresh.page)).toBeNull();
  } finally {
    await closeAll(returning, fresh);
  }
});

test("it waits while another dialog is open", async ({ browser }) => {
  const user = await firstTimer(browser, "Wait");
  const { page } = user;
  try {
    await createShare(page);
    await answerDeviceQuestion(page);
    // Inside the quiet moment before the tour: a dialog opens and the tour holds back.
    await openShareDialog(page);
    await page.waitForTimeout(QUIET_MS);
    await expect(tourDialog(page)).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(tourDialog(page)).toBeVisible();
  } finally {
    await closeAll(user);
  }
});

test("it waits while the editor's own dialogs are open, and does not take their focus", async ({
  browser,
}) => {
  const user = await firstTimer(browser, "Own");
  const { page } = user;
  try {
    await createShare(page);
    await answerDeviceQuestion(page);
    // New file opens right away, inside the quiet moment before the tour.
    await page.getByTestId("add-file").click();
    const dialog = page.getByRole("dialog", { name: "New file" });
    const input = page.getByTestId("file-name-input");
    await expect(input).toBeFocused();
    await input.fill("notes.md");
    await page.waitForTimeout(QUIET_MS);
    await expect(tourDialog(page)).toHaveCount(0);
    // The dialog is still the active one: visible to assistive technology, focus and text kept.
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("aria-hidden", "true");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("notes.md");

    // Closing it lets the tour in, once.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(tourDialog(page)).toBeVisible();
    await expect(page.getByTestId("tour-next")).toBeFocused();
  } finally {
    await closeAll(user);
  }
});

test("a viewer's tour leaves out what a viewer cannot do", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  const viewer = await firstTimer(browser, "Viewer");
  try {
    const id = await createShare(owner.page);
    const dialog = await openShareDialog(owner.page, "Access");
    const patched = owner.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/shares/${id}`) && response.request().method() === "PATCH",
    );
    await dialog.getByTestId("access-view").click();
    await patched;
    await dialog.getByRole("tab", { name: "Code and QR" }).click();
    const viewUrl = await dialog.getByTestId("share-link").inputValue();

    await viewer.page.goto(new URL(viewUrl).pathname);
    await waitForEditor(viewer.page);
    await expect(viewer.page.getByTestId("banner-readonly")).toBeVisible();
    await answerDeviceQuestion(viewer.page);
    await expect(tourDialog(viewer.page)).toBeVisible();
    // The language picker is not usable for a viewer: four steps, none of them about it.
    await expect(viewer.page.getByTestId("tour-step")).toHaveText("1 / 4");
    await walkToDone(viewer.page);
    await expect(viewer.page.getByRole("dialog", { name: "Language" })).toHaveCount(0);
    await viewer.page.keyboard.press("Enter");
    await expect(tourDialog(viewer.page)).toBeHidden();
  } finally {
    await closeAll(owner, viewer);
  }
});

test("at 320px every step stays on screen and never covers what it points at", async ({
  browser,
}) => {
  const user = await firstTimer(browser, "Narrow", { viewport: { width: 320, height: 568 } });
  const { page } = user;
  try {
    await createShare(page);
    await answerDeviceQuestion(page);
    await expect(tourDialog(page)).toBeVisible();

    const total = Number((await counter(page)).split("/")[1]);
    expect(total).toBeGreaterThanOrEqual(4);
    const seen: string[] = [];
    for (let step = 1; step <= total; step++) {
      await expect(page.getByTestId("tour-step")).toHaveText(`${step} / ${total}`);
      await settle(page);
      const title = (await page.getByRole("dialog").getByRole("heading").textContent()) ?? "";
      seen.push(title);
      const box = await page.evaluate(() => {
        const rect = (selector: string) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        return {
          tour: rect('[data-testid="tour"]'),
          spot: rect('[data-testid="tour-spot"]'),
          scrollWidth: document.documentElement.scrollWidth,
          width: innerWidth,
          height: innerHeight,
        };
      });
      const { tour, spot } = box;
      if (!tour || !spot) throw new Error(`step ${step}: missing popover or spotlight`);
      const label = `step ${step} (${title})`;
      // The popover is on screen, and the page did not grow sideways.
      expect(tour.left, label).toBeGreaterThanOrEqual(0);
      expect(tour.right, label).toBeLessThanOrEqual(box.width);
      expect(tour.top, label).toBeGreaterThanOrEqual(0);
      expect(tour.bottom, label).toBeLessThanOrEqual(box.height);
      expect(box.scrollWidth, label).toBeLessThanOrEqual(box.width);
      // So is the highlighted element, and the popover does not sit on it.
      expect(spot.left, label).toBeGreaterThanOrEqual(-1);
      expect(spot.right, label).toBeLessThanOrEqual(box.width + 1);
      const covers =
        tour.left < spot.right &&
        tour.right > spot.left &&
        tour.top < spot.bottom &&
        tour.bottom > spot.top;
      expect(covers, label).toBe(false);
      if (step < total) await page.keyboard.press("Enter");
    }
    // Five distinct places, in order.
    expect(new Set(seen).size).toBe(total);
    expect(seen[0]).toBe("Invite others");
  } finally {
    await closeAll(user);
  }
});

test("light, dark and high contrast: the spotlight and popover stay readable", async ({
  browser,
}) => {
  for (const scheme of ["light", "dark"] as const) {
    const user = await firstTimer(browser, `Look${scheme}`, { colorScheme: scheme });
    const { page } = user;
    try {
      await createShare(page);
      await answerDeviceQuestion(page);
      await expect(tourDialog(page)).toBeVisible();
      await settle(page);
      const look = await page.evaluate(() => {
        const spot = getComputedStyle(
          document.querySelector('[data-testid="tour-spot"]') as Element,
        );
        const tour = getComputedStyle(document.querySelector('[data-testid="tour"]') as Element);
        return {
          outline: spot.outlineStyle,
          outlineWidth: Number.parseFloat(spot.outlineWidth),
          shadow: spot.boxShadow,
          background: tour.backgroundColor,
          color: tour.color,
        };
      });
      expect(look.outline).toBe("solid");
      expect(look.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(look.shadow).not.toBe("none");
      expect(look.background).not.toBe(look.color);
      expect(look.background).not.toBe("rgba(0, 0, 0, 0)");
    } finally {
      await closeAll(user);
    }
  }

  const contrast = await firstTimer(browser, "Contrast", { contrast: "more" });
  try {
    await createShare(contrast.page);
    await answerDeviceQuestion(contrast.page);
    await expect(tourDialog(contrast.page)).toBeVisible();
    const width = await contrast.page
      .getByTestId("tour-spot")
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).outlineWidth));
    expect(width).toBeGreaterThanOrEqual(3);
  } finally {
    await closeAll(contrast);
  }
});

test("reduced motion: the tour moves nothing, motion allowed: it glides on translate only", async ({
  browser,
}) => {
  const motion = await firstTimer(browser, "Glide", { reducedMotion: "no-preference" });
  const reduced = await firstTimer(browser, "Still", { reducedMotion: "reduce" });
  try {
    for (const user of [motion, reduced]) {
      await createShare(user.page);
      await answerDeviceQuestion(user.page);
      await expect(tourDialog(user.page)).toBeVisible();
      await settle(user.page);
    }
    const style = (page: Page) =>
      page.evaluate(() => {
        const pop = getComputedStyle(document.querySelector('[data-testid="tour"]') as Element);
        const spot = getComputedStyle(
          document.querySelector('[data-testid="tour-spot"]') as Element,
        );
        return {
          property: pop.transitionProperty,
          duration: Number.parseFloat(pop.transitionDuration),
          spotAnimation: spot.animationName,
          popAnimationDuration: Number.parseFloat(pop.animationDuration),
        };
      });
    const on = await style(motion.page);
    expect(on.property).toBe("translate");
    expect(on.duration).toBeGreaterThanOrEqual(0.1);
    expect(on.spotAnimation).toBe("tour-spot-in");

    const off = await style(reduced.page);
    expect(off.duration).toBeLessThan(0.001);
    expect(off.spotAnimation).toBe("none");
    expect(off.popAnimationDuration).toBeLessThan(0.001);

    // And a step change under reduced motion is an instant jump: nothing is left animating.
    await reduced.page.keyboard.press("Enter");
    await expect(reduced.page.getByTestId("tour-step")).toHaveText("2 / 5");
    await expect
      .poll(
        () =>
          reduced.page.evaluate(
            () => document.querySelector('[data-testid="tour"]')?.getAnimations().length,
          ),
        { timeout: 1000 },
      )
      .toBe(0);
  } finally {
    await closeAll(motion, reduced);
  }
});

// ── The files step and the menu step teach what the new features do ──

/** Moves from step 1 to the step with this title, by keyboard. */
async function walkTo(page: Page, title: string): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    const heading = (await page.getByRole("dialog").getByRole("heading").textContent()) ?? "";
    if (heading === title) return;
    await page.keyboard.press("Enter");
  }
  throw new Error(`no tour step titled ${title}`);
}

test("the files step teaches dragging a file in, with a drawing; the menu step names Settings", async ({
  browser,
}) => {
  const user = await firstTimer(browser, "Drag");
  const { page } = user;
  try {
    await createShare(page);
    await answerDeviceQuestion(page);
    await expect(tourDialog(page)).toBeVisible();

    await walkTo(page, "Files");
    await expect(tourDialog(page)).toContainText("Drag files, folders or a .zip");
    const drawing = page.getByTestId("tour-illustration");
    await expect(drawing).toBeVisible();
    // Decorative: hidden from assistive technology, and inside the popover.
    await expect(drawing).toHaveAttribute("aria-hidden", "true");
    const inside = await page.evaluate(() => {
      const pop = document.querySelector('[data-testid="tour"]')?.getBoundingClientRect();
      const art = document
        .querySelector('[data-testid="tour-illustration"]')
        ?.getBoundingClientRect();
      return Boolean(
        pop && art && art.left >= pop.left && art.right <= pop.right && art.bottom <= pop.bottom,
      );
    });
    expect(inside).toBe(true);
    // Other steps carry no drawing.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tour-illustration")).toHaveCount(0);

    await walkTo(page, "More actions");
    await expect(tourDialog(page)).toContainText("Settings");
    await expect(tourDialog(page)).toContainText("cursors");
    expect(await storedVersion(page)).toBeNull();
  } finally {
    await closeAll(user);
  }
});

test("a viewer's files step does not promise adding and has no drawing", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  const viewer = await firstTimer(browser, "Look");
  try {
    const id = await createShare(owner.page);
    const dialog = await openShareDialog(owner.page, "Access");
    const patched = owner.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/shares/${id}`) && response.request().method() === "PATCH",
    );
    await dialog.getByTestId("access-view").click();
    await patched;
    await dialog.getByRole("tab", { name: "Code and QR" }).click();
    const viewUrl = await dialog.getByTestId("share-link").inputValue();

    await viewer.page.goto(new URL(viewUrl).pathname);
    await waitForEditor(viewer.page);
    await answerDeviceQuestion(viewer.page);
    await expect(tourDialog(viewer.page)).toBeVisible();
    await walkTo(viewer.page, "Files");
    await expect(tourDialog(viewer.page)).toContainText("You cannot add files");
    await expect(tourDialog(viewer.page)).not.toContainText(/drag/i);
    await expect(viewer.page.getByTestId("tour-illustration")).toHaveCount(0);
  } finally {
    await closeAll(owner, viewer);
  }
});

test("someone who saw the first version of the tour sees the new one once", async ({ browser }) => {
  const returning = await firstTimer(browser, "Old", {
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [{ name: "gachipad.tour", value: "1" }],
        },
      ],
    },
  });
  const { page } = returning;
  try {
    await createShare(page);
    await answerDeviceQuestion(page);
    await expect(tourDialog(page)).toBeVisible();
    await page.getByTestId("tour-skip").click();
    await expect(tourDialog(page)).toBeHidden();
    expect(await storedVersion(page)).toBe(TOUR_VERSION);
    await page.reload();
    await waitForEditor(page);
    await page.waitForTimeout(QUIET_MS);
    await expect(tourDialog(page)).toBeHidden();
  } finally {
    await closeAll(returning);
  }
});

test("the drawing in the files step moves only when motion is welcome, at 320px too", async ({
  browser,
}) => {
  const motion = await firstTimer(browser, "Move", {
    reducedMotion: "no-preference",
    viewport: { width: 320, height: 568 },
  });
  const still = await firstTimer(browser, "Rest", { reducedMotion: "reduce" });
  try {
    for (const user of [motion, still]) {
      await createShare(user.page);
      await answerDeviceQuestion(user.page);
      await expect(tourDialog(user.page)).toBeVisible();
      await walkTo(user.page, "Files");
      await expect(user.page.getByTestId("tour-illustration")).toBeVisible();
    }
    const file = (page: Page) =>
      page.evaluate(() => {
        const node = document.querySelector(".tour-drop-file") as Element;
        const style = getComputedStyle(node);
        return { animation: style.animationName, opacity: Number(style.opacity) };
      });
    expect((await file(motion.page)).animation).toBe("tour-drop-file");
    const rest = await file(still.page);
    expect(rest.animation).toBe("none");
    // At rest the picture is finished: the file is inside the window.
    expect(rest.opacity).toBe(1);

    // 320px: the popover, the drawing and the page all fit.
    await settle(motion.page);
    const fit = await motion.page.evaluate(() => {
      const pop = document.querySelector('[data-testid="tour"]')?.getBoundingClientRect();
      const art = document
        .querySelector('[data-testid="tour-illustration"]')
        ?.getBoundingClientRect();
      return {
        scroll: document.documentElement.scrollWidth <= innerWidth,
        art: Boolean(pop && art && art.left >= pop.left && art.right <= pop.right),
        pop: Boolean(pop && pop.left >= 0 && pop.right <= innerWidth && pop.bottom <= innerHeight),
      };
    });
    expect(fit).toEqual({ scroll: true, art: true, pop: true });
  } finally {
    await closeAll(motion, still);
  }
});

// ── Help is findable from the more menu ──

test("the more menu has a how-to guide entry and a tour replay entry, both by keyboard", async ({
  browser,
}) => {
  const user = await newUser(browser, "Menu");
  const { page } = user;
  try {
    await createShare(page);
    await page.getByTestId("menu-button").focus();
    await page.keyboard.press("Enter");
    const help = page.getByRole("menuitem", { name: /How to use/ });
    await expect(help).toBeVisible();
    // The entry says it opens in a new tab.
    await expect(help).toContainText("(opens in a new tab)");

    // Enter on it opens the guide in a new tab, and the share stays where it is.
    await help.focus();
    const popup = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const guide = await popup;
    await guide.waitForLoadState("domcontentloaded");
    expect(new URL(guide.url()).pathname).toBe("/guide/how");
    expect(new URL(guide.url()).hash).toBe("#files");
    expect(await guide.evaluate(() => window.opener)).toBeNull();
    await expect(guide.getByRole("heading", { level: 2, name: "Adding files" })).toBeVisible();
    await guide.close();
    await expect(page.getByTestId("editor")).toBeVisible();

    // Replay: the tour starts from the first step; the menu is closed by then.
    await page.getByTestId("menu-button").focus();
    await page.keyboard.press("Enter");
    const replay = page.getByRole("menuitem", { name: "Replay tutorial" });
    await replay.focus();
    await page.keyboard.press("Enter");
    await expect(tourDialog(page)).toBeVisible();
    await expect(page.getByTestId("tour-step")).toHaveText("1 / 5");
    await expect(page.getByTestId("tour-next")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tourDialog(page)).toBeHidden();

    // The upload entry is there for people who cannot drag (a phone), and opens the dialog.
    await page.getByTestId("menu-button").focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Upload files" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Upload files or a folder" })).toBeVisible();
  } finally {
    await closeAll(user);
  }
});

test("a viewer's menu has the help entries but no upload entry", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  const viewer = await newUser(browser, "Reader");
  try {
    const id = await createShare(owner.page);
    const dialog = await openShareDialog(owner.page, "Access");
    const patched = owner.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/shares/${id}`) && response.request().method() === "PATCH",
    );
    await dialog.getByTestId("access-view").click();
    await patched;
    await dialog.getByRole("tab", { name: "Code and QR" }).click();
    const viewUrl = await dialog.getByTestId("share-link").inputValue();
    await viewer.page.goto(new URL(viewUrl).pathname);
    await waitForEditor(viewer.page);
    await expect(viewer.page.getByTestId("banner-readonly")).toBeVisible();
    await viewer.page.getByTestId("menu-button").click();
    await expect(viewer.page.getByRole("menuitem", { name: /How to use/ })).toBeVisible();
    await expect(viewer.page.getByRole("menuitem", { name: "Replay tutorial" })).toBeVisible();
    await expect(viewer.page.getByTestId("menu-upload")).toHaveCount(0);
  } finally {
    await closeAll(owner, viewer);
  }
});

// ── The one-time tip about dragging files in ──

/** The device question is out of the way, so the only hint left is the one under test. */
async function skipDeviceQuestion(page: Page): Promise<void> {
  // A new browser profile always gets the question, a moment after the editor is up.
  await page.getByTestId("device-choice-skip").click();
  await expect(page.getByTestId("device-choice")).toBeHidden();
}

/**
 * An owner who has seen the tour but not the tip, with a second person already in the share (the
 * tip gives way to the "only one here" card while someone is alone). Owners can always add files;
 * an editor can only when the owner allows it.
 */
async function ownerWithCompany(
  browser: Browser,
  label: string,
  options: Parameters<typeof firstTimer>[2] = {},
): Promise<{ owner: User; company: User; all: User[] }> {
  const owner = await firstTimer(browser, label, { storageState: TIP_UNSEEN_STORAGE, ...options });
  const company = await newUser(browser, "Company");
  const id = await createShare(owner.page);
  await joinByLink(company, id);
  await waitForEditor(company.page);
  await skipDeviceQuestion(owner.page);
  return { owner, company, all: [owner, company] };
}

const tip = (page: Page) => page.getByTestId("drop-tip");
const TIP_KEY = "gachipad.tip.drop";
const tipStored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), TIP_KEY);

test("the tip shows once for someone who can add files, and dismiss keeps it gone", async ({
  browser,
}) => {
  const { owner, all } = await ownerWithCompany(browser, "Tip");
  try {
    const { page } = owner;
    await expect(tip(page)).toBeVisible();
    await expect(page.getByTestId("drop-tip-text")).toContainText("Drag a file like main.py");
    // Non-modal: it is not a dialog, and the editor keeps working underneath.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".cm-content").click();
    await page.keyboard.type("x");
    // Typing sends it away for this visit without ending it for good.
    await expect(tip(page)).toBeHidden();
    expect(await tipStored(page)).toBeNull();
    await page.reload();
    await waitForEditor(page);
    await expect(tip(page)).toBeVisible();

    // The button opens the upload dialog, and the tip steps aside while it is open.
    await page.getByTestId("drop-tip-open").click();
    await expect(page.getByRole("dialog", { name: "Upload files or a folder" })).toBeVisible();
    await expect(tip(page)).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(tip(page)).toBeVisible();

    // Dismiss by keyboard: gone now, gone after a reload.
    await page.getByTestId("drop-tip-dismiss").focus();
    await page.keyboard.press("Enter");
    await expect(tip(page)).toBeHidden();
    expect(await tipStored(page)).toBe("1");
    await page.reload();
    await waitForEditor(page);
    await page.waitForTimeout(3000);
    await expect(tip(page)).toHaveCount(0);
  } finally {
    await closeAll(...all);
  }
});

test("the first file added by any means ends the tip", async ({ browser }) => {
  const { owner, all } = await ownerWithCompany(browser, "First");
  try {
    const { page } = owner;
    await expect(tip(page)).toBeVisible();
    // A new file from the add button, not a drop.
    await page.getByTestId("add-file").click();
    await page.getByTestId("file-name-input").fill("second.txt");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tab-second.txt")).toBeVisible();
    await expect(tip(page)).toBeHidden();
    await expect.poll(() => tipStored(page)).toBe("1");
  } finally {
    await closeAll(...all);
  }
});

test("people who cannot add files never get the tip: a viewer, and an editor not allowed to", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Owner");
  let viewer: User | undefined;
  let editor: User | undefined;
  try {
    const id = await createShare(owner.page);
    // The default editor: files stay with the owner until the owner allows participants.
    editor = await firstTimer(browser, "Editor", { storageState: TIP_UNSEEN_STORAGE });
    await joinByLink(editor, id);
    await waitForEditor(editor.page);

    const dialog = await openShareDialog(owner.page, "Access");
    const patched = owner.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/shares/${id}`) && response.request().method() === "PATCH",
    );
    await dialog.getByTestId("access-view").click();
    await patched;
    await dialog.getByRole("tab", { name: "Code and QR" }).click();
    const viewUrl = await dialog.getByTestId("share-link").inputValue();
    await owner.page.keyboard.press("Escape");

    viewer = await firstTimer(browser, "Read", { storageState: TIP_UNSEEN_STORAGE });
    await viewer.page.goto(new URL(viewUrl).pathname);
    await waitForEditor(viewer.page);
    await expect(viewer.page.getByTestId("banner-readonly")).toBeVisible();
    await skipDeviceQuestion(viewer.page);
    await skipDeviceQuestion(editor.page);
    await viewer.page.waitForTimeout(3500);
    await expect(tip(viewer.page)).toHaveCount(0);
    await expect(tip(editor.page)).toHaveCount(0);
  } finally {
    await closeAll(...[owner, viewer, editor].filter((user): user is User => user !== undefined));
  }
});

test("the tip waits for the tour and for the device question, one hint at a time", async ({
  browser,
}) => {
  // Neither the tour nor the tip has been seen.
  const owner = await firstTimer(browser, "Order");
  const company = await newUser(browser, "Company");
  try {
    const { page } = owner;
    const id = await createShare(page);
    await joinByLink(company, id);
    await waitForEditor(company.page);
    // The device question is open: neither the tour nor the tip.
    await expect(page.getByTestId("device-choice")).toBeVisible();
    await page.waitForTimeout(3000);
    await expect(tip(page)).toHaveCount(0);
    await expect(tourDialog(page)).toBeHidden();

    await answerDeviceQuestion(page);
    await expect(tourDialog(page)).toBeVisible();
    await expect(tip(page)).toHaveCount(0);

    // After the tour, the tip may come in.
    await page.keyboard.press("Escape");
    await expect(tourDialog(page)).toBeHidden();
    await expect(tip(page)).toBeVisible();
  } finally {
    await closeAll(owner, company);
  }
});

test("at 320px the tip points at the upload button and does not widen the page", async ({
  browser,
}) => {
  const { owner, all } = await ownerWithCompany(browser, "Narrow", {
    viewport: { width: 320, height: 568 },
  });
  try {
    const { page } = owner;
    await expect(tip(page)).toBeVisible();
    await expect(page.getByTestId("drop-tip-text")).toHaveText(
      "Use the upload button to add files, folders or a .zip.",
    );
    const box = await tip(page).boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 320).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    // Both buttons are big enough to hit.
    for (const id of ["drop-tip-open", "drop-tip-dismiss"]) {
      const target = await page.getByTestId(id).boundingBox();
      expect(target?.height ?? 0).toBeGreaterThanOrEqual(24);
      expect(target?.width ?? 0).toBeGreaterThanOrEqual(24);
    }
  } finally {
    await closeAll(...all);
  }
});
