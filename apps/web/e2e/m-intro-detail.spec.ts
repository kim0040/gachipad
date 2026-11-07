import { expect, type Page, test } from "@playwright/test";
import { closeAll, createShare, newUser } from "./helpers";

async function openIntro(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByTestId("start-panel")).toBeVisible();
}

const hiddenReveals = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("[data-reveal]")].filter(
        (node) => getComputedStyle(node).opacity !== "1",
      ).length,
  );

// Words that tie the copy to one kind of organisation or network (written as escapes so this file
// does not contain them itself).
const WHERE_WORDS = /\uc0ac\ub0b4|\ub0b4\ubd80\ub9dd|\ud68c\uc0ac|\u0069ntranet|\u0063ompany/i;

for (const locale of ["ko", "en"] as const) {
  test(`intro (${locale}): copy does not assume where it is deployed`, async ({ browser }) => {
    const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
    try {
      await user.context.addInitScript((value) => {
        localStorage.setItem("gachipad.locale", value);
      }, locale);
      await openIntro(user.page);
      // Closed FAQ answers are hidden, so read the DOM text rather than what is rendered.
      const text = await user.page
        .locator("main, footer")
        .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? "").join(" "));
      expect(text).not.toMatch(WHERE_WORDS);
      expect(await user.page.title()).not.toMatch(WHERE_WORDS);
    } finally {
      await closeAll(user);
    }
  });
}

test("scroll reveal never leaves content invisible", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    // Landing far down the page skips everything above it; none of it may stay blank.
    await openIntro(page, "/#ix-faq-title");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            ["#ix-how-title", "#ix-fast-title"]
              .flatMap((id) => [
                ...(document
                  .querySelector(id)
                  ?.closest("section")
                  ?.querySelectorAll("[data-reveal]") ?? []),
              ])
              .filter((node) => getComputedStyle(node).opacity !== "1").length,
        ),
      )
      .toBe(0);

    // Scrolling down in steps reveals the rest.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 400) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(40);
    }
    await expect.poll(() => hiddenReveals(page)).toBe(0);
  } finally {
    await closeAll(user);
  }
});

test("reduced motion: every section is visible at once", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  try {
    await user.page.emulateMedia({ reducedMotion: "reduce" });
    await openIntro(user.page);
    expect(await hiddenReveals(user.page)).toBe(0);
    await expect(user.page.locator(".ix-stage-art")).toHaveCSS(
      "animation-duration",
      /^(0s|1e-05s|0\.00001s)$/,
    );
  } finally {
    await closeAll(user);
  }
});

test("the language chips switch the example and show its own highlighting", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await openIntro(page);
    const tile = page.locator(".ix-fx-highlight");
    await tile.scrollIntoViewIfNeeded();
    const typescript = tile.getByRole("button", { name: "TypeScript" });
    const python = tile.getByRole("button", { name: "Python" });
    await expect(typescript).toHaveAttribute("aria-pressed", "true");
    await expect(tile.locator(".ix-code")).toContainText("export function total");

    // Keyboard: chips are real buttons.
    await python.focus();
    await page.keyboard.press("Enter");
    await expect(python).toHaveAttribute("aria-pressed", "true");
    await expect(typescript).toHaveAttribute("aria-pressed", "false");
    await expect(tile.locator(".ix-code")).toContainText("def total");
    // Token colours come from the editor theme, so keywords are not the plain text colour.
    const colours = await tile
      .locator('.ix-code .tk[data-k="keyword"]')
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    const plain = await tile.locator(".ix-code").evaluate((node) => getComputedStyle(node).color);
    expect(colours).not.toBe(plain);
  } finally {
    await closeAll(user);
  }
});

test("the keyboard tile lists shortcuts as key caps", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  try {
    await openIntro(user.page);
    const tile = user.page.locator(".ix-fx-keys");
    await expect(tile.locator("kbd")).toHaveCount(11);
    await expect(tile.locator("dt")).toHaveCount(4);
  } finally {
    await closeAll(user);
  }
});

for (const locale of ["ko", "en"] as const) {
  test(`320px (${locale}): header controls share one row and no section overflows`, async ({
    browser,
  }) => {
    const user = await newUser(browser, "Maya", { viewport: { width: 320, height: 700 } });
    const { page } = user;
    try {
      await user.context.addInitScript((value) => {
        localStorage.setItem("gachipad.locale", value);
      }, locale);
      await openIntro(page);
      // Closed, the header is the brand and the menu button.
      const tops = await page
        .locator("header.ix-header .ix-menu-btn, header.ix-header .ix-brand")
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
      expect(tops).toHaveLength(2);
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(12);

      // The page does not scroll sideways, and no part of a section pokes out of the viewport
      // (the start panel scrolls its own recent shares, so the hero is left to the first check).
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const wide = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".ix-section *, .ix-footer *")]
          .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
          .filter((node) => !node.closest(".ix-code"))
          .map((node) => `${node.tagName}.${String(node.className).slice(0, 30)}`)
          .slice(0, 5),
      );
      expect(wide).toEqual([]);
    } finally {
      await closeAll(user);
    }
  });
}

test("the home page sums up each topic and links to its page", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await openIntro(page);
    const main = page.locator("main");
    for (const [slug, name] of [
      ["how", "How it works"],
      ["features", "Features"],
      ["network", "Network"],
      ["security", "Privacy"],
      ["faq", "All questions"],
    ] as const) {
      const link = main.locator(`a.ix-more[href="/guide/${slug}"]`);
      await expect(link, slug).toHaveCount(1);
      await expect(link, slug).toContainText(name === "All questions" ? name : "Read more");
    }
    // Only a few questions are on the home page; the rest are on the FAQ page.
    expect(await main.locator(".ix-faq-item").count()).toBe(3);
  } finally {
    await closeAll(user);
  }
});

// ── The contribute block above the footer ──

const GITHUB_LINKS = [
  { id: "contribute-report", href: "https://github.com/kim0040/gachipad/issues/new" },
  {
    id: "contribute-guide",
    href: "https://github.com/kim0040/gachipad/blob/main/CONTRIBUTING.md",
  },
  { id: "contribute-repo", href: "https://github.com/kim0040/gachipad" },
] as const;

for (const path of ["/", "/guide/how", "/guide/faq"]) {
  test(`${path}: the contribute block has three plain links to GitHub and asks GitHub for nothing`, async ({
    browser,
  }) => {
    const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
    const { page } = user;
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    try {
      await page.goto(path);
      await expect(page.locator("footer.ix-footer")).toBeVisible();
      const block = page.getByTestId("contribute");
      await block.scrollIntoViewIfNeeded();
      await expect(block).toBeVisible();
      await expect(block.getByRole("heading", { level: 2 })).toHaveText(
        "Found a bug, or want to contribute?",
      );
      await expect(block).toContainText("Tell us on GitHub");

      for (const { id, href } of GITHUB_LINKS) {
        const link = page.getByTestId(id);
        await expect(link).toHaveAttribute("href", href);
        await expect(link).toHaveAttribute("target", "_blank");
        // noopener keeps the new tab from reaching back; noreferrer keeps this address private.
        const rel = ((await link.getAttribute("rel")) ?? "").split(/\s+/);
        expect(rel).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
        await expect(link).toContainText("(opens in a new tab)");
        await expect(link.locator("svg")).toHaveCount(1);
      }

      // Plain links: the page never talked to GitHub, loading or scrolling to the block.
      await page.waitForLoadState("networkidle");
      expect(requested.filter((url) => new URL(url).hostname.endsWith("github.com"))).toEqual([]);
      expect(
        requested.filter((url) => new URL(url).hostname.endsWith("githubusercontent.com")),
      ).toEqual([]);
      expect(requested.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(
        true,
      );
    } finally {
      await closeAll(user);
    }
  });
}

test("the share page has no contribute block", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  try {
    await createShare(user.page);
    await expect(user.page.getByTestId("contribute")).toHaveCount(0);
    await expect(user.page.locator('a[href*="github.com"]')).toHaveCount(0);
  } finally {
    await closeAll(user);
  }
});

test("the contribute block is reachable by keyboard, readable, and fits at 320px in both themes", async ({
  browser,
}) => {
  for (const [colorScheme, width] of [
    ["light", 320],
    ["dark", 320],
    ["light", 1280],
    ["dark", 1280],
  ] as const) {
    const user = await newUser(browser, "Maya", {
      colorScheme,
      viewport: { width, height: width === 320 ? 700 : 800 },
    });
    const { page } = user;
    try {
      await page.goto("/");
      const block = page.getByTestId("contribute");
      await block.scrollIntoViewIfNeeded();
      await expect(block).toBeVisible();
      const label = `${colorScheme} ${width}`;

      // Tab reaches all three, in order, each with a visible focus ring.
      await page.getByTestId("contribute-report").focus();
      for (const [index, { id }] of GITHUB_LINKS.entries()) {
        if (index > 0) await page.keyboard.press("Tab");
        const link = page.getByTestId(id);
        await expect(link, label).toBeFocused();
        const ring = await link.evaluate((node) => {
          const style = getComputedStyle(node);
          return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
        });
        expect(ring, label).toEqual({ style: "solid", width: 2 });
      }

      // Nothing leaves the block's width, and the page does not scroll sideways.
      const fit = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="contribute"]') as HTMLElement;
        const box = root.getBoundingClientRect();
        const stray = [...root.querySelectorAll<HTMLElement>("*")].filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.right > box.right + 1 || rect.left < box.left - 1;
        });
        return {
          stray: stray.length,
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          left: box.left,
          right: box.right,
          width: innerWidth,
        };
      });
      expect(fit.stray, label).toBe(0);
      expect(fit.sideways, label).toBeLessThanOrEqual(0);
      expect(fit.left, label).toBeGreaterThanOrEqual(0);
      expect(fit.right, label).toBeLessThanOrEqual(fit.width);

      // The links are big enough to hit (WCAG 2.5.8 asks 24px).
      for (const { id } of GITHUB_LINKS) {
        const rect = await page.getByTestId(id).boundingBox();
        expect(rect?.height ?? 0, label).toBeGreaterThanOrEqual(40);
      }

      // The block sits above the footer's link grid.
      const order = await page.evaluate(() => {
        const top = (selector: string) =>
          document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
        return top('[data-testid="contribute"]') < top(".ix-footer-grid");
      });
      expect(order, label).toBe(true);
    } finally {
      await closeAll(user);
    }
  }
});

test("reduced motion: the contribute block is visible at once", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto("/");
    const block = page.getByTestId("contribute");
    await block.scrollIntoViewIfNeeded();
    await expect(block).toHaveCSS("opacity", "1");
    await expect(block).toHaveCSS("transform", "none");
  } finally {
    await context.close();
  }
});
