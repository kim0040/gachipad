import { expect, type Page, test } from "@playwright/test";
import { BASE_URL, TIP_UNSEEN_STORAGE } from "./env";
import { closeAll, createShare, joinByLink, newUser, type User, waitForEditor } from "./helpers";

/** Pictures of the new teaching surfaces for review; they land in .box-out/shots (git-ignored). */
const SHOTS = "../../.box-out/shots";

const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "320", width: 320, height: 640 },
] as const;

for (const colorScheme of ["light", "dark"] as const) {
  for (const { name, width, height } of SIZES) {
    test(`shot: contribute block and footer, ${colorScheme}, ${name}`, async ({ browser }) => {
      const user = await newUser(browser, "Shot", { colorScheme, viewport: { width, height } });
      const { page } = user;
      try {
        await page.goto("/");
        const footer = page.locator("footer.ix-footer");
        await footer.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await page.getByTestId("contribute").screenshot({
          path: `${SHOTS}/contribute-${colorScheme}-${name}.png`,
        });
        await footer.screenshot({ path: `${SHOTS}/footer-${colorScheme}-${name}.png` });
        await expect(page.getByTestId("contribute")).toBeVisible();
      } finally {
        await closeAll(user);
      }
    });
  }
}

for (const { name, width, height } of SIZES) {
  test(`shot: the file tip, ${name}`, async ({ browser }) => {
    // The owner has seen the tour, not the tip, and someone else is in the share.
    const context = await browser.newContext({
      baseURL: BASE_URL,
      locale: "en-US",
      extraHTTPHeaders: { "X-Gachipad": "1" },
      storageState: TIP_UNSEEN_STORAGE,
      viewport: { width, height },
    });
    const owner: User = { context, page: await context.newPage(), name: "ShotOwner" };
    const company = await newUser(browser, "Company");
    try {
      const patch = await context.request.patch("/api/session", { data: { name: "ShotOwner" } });
      expect(patch.ok()).toBe(true);
      const id = await createShare(owner.page);
      await joinByLink(company, id);
      await waitForEditor(company.page);
      await owner.page.getByTestId("device-choice-skip").click();
      await expect(owner.page.getByTestId("drop-tip")).toBeVisible();
      await owner.page.waitForTimeout(600);
      await owner.page.screenshot({ path: `${SHOTS}/tip-${name}.png` });
    } finally {
      await closeAll(owner, company);
    }
  });

  test(`shot: the files step of the tour, ${name}`, async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      locale: "en-US",
      extraHTTPHeaders: { "X-Gachipad": "1" },
      storageState: { cookies: [], origins: [] },
      viewport: { width, height },
    });
    const page: Page = await context.newPage();
    try {
      const patch = await context.request.patch("/api/session", {
        data: { name: `Tour${Date.now().toString(36).slice(-4)}` },
      });
      expect(patch.ok()).toBe(true);
      await createShare(page);
      await page.getByTestId("device-choice-skip").click();
      await expect(page.getByTestId("tour")).toBeVisible();
      for (let guard = 0; guard < 6; guard++) {
        const title = (await page.getByRole("dialog").getByRole("heading").textContent()) ?? "";
        if (title === "Files") break;
        await page.keyboard.press("Enter");
      }
      await expect(page.getByTestId("tour-illustration")).toBeVisible();
      // The finished picture (what reduced motion shows), not a frame of the loop.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/tour-files-${name}.png` });
    } finally {
      await context.close();
    }
  });
}
