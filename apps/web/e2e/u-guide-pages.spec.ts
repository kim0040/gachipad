import { expect, type Page, test } from "@playwright/test";
import { closeAll, newUser } from "./helpers";

type Locale = "en" | "ko";

const PAGES = [
  { slug: "how", title: { en: "How it works", ko: "이렇게 써요" } },
  { slug: "features", title: { en: "Features", ko: "기능" } },
  {
    slug: "network",
    title: { en: "Faster on the same network", ko: "같은 네트워크라서 더 빠르게" },
  },
  { slug: "security", title: { en: "Privacy and safety", ko: "개인정보와 안전" } },
  { slug: "faq", title: { en: "Questions", ko: "자주 묻는 질문" } },
] as const;

// Words that tie the copy to one kind of organisation or network (written as escapes so this file
// does not contain them itself).
const WHERE_WORDS = /사내|내부망|회사|intranet|company/i;
// Product scope: no calls, chat or code execution may be promised.
const OUT_OF_SCOPE = /\b(video call|voice|webcam|microphone)\b|화상|음성 통화|채팅/i;

async function openGuide(page: Page, slug: string, locale: Locale, hash = "") {
  await page.addInitScript((value) => {
    localStorage.setItem("gachipad.locale", value);
  }, locale);
  await page.goto(`/guide/${slug}${hash}`);
  await expect(page.locator("main h1")).toBeVisible();
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** What an automated accessibility scan would flag first, checked without a library. */
async function structureProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const visible = (node: Element) => {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(visible);
    if (headings.filter((node) => node.tagName === "H1").length !== 1) problems.push("one h1");
    let level = 0;
    for (const heading of headings) {
      const next = Number(heading.tagName.slice(1));
      if (level && next > level + 1) problems.push(`heading jumps to ${heading.tagName}`);
      level = next;
      if (!heading.textContent?.trim()) problems.push(`empty ${heading.tagName}`);
    }
    for (const node of document.querySelectorAll("a[href], button")) {
      if (!visible(node) || node.closest("[aria-hidden='true'], [inert]")) continue;
      const name =
        node.getAttribute("aria-label") ?? node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!name) problems.push(`unnamed ${node.tagName.toLowerCase()}`);
    }
    for (const image of document.querySelectorAll("img")) {
      if (!image.hasAttribute("alt")) problems.push("img without alt");
    }
    for (const svg of document.querySelectorAll("svg")) {
      const hidden = svg.closest("[aria-hidden='true']") || svg.getAttribute("aria-hidden");
      if (!hidden && !svg.getAttribute("aria-label") && !svg.querySelector("title")) {
        problems.push("svg neither hidden nor named");
      }
    }
    for (const input of document.querySelectorAll("input, select, textarea")) {
      if (!visible(input) || input.closest("[inert]")) continue;
      const labelled =
        input.getAttribute("aria-label") ||
        input.getAttribute("aria-labelledby") ||
        (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) ||
        input.closest("label");
      if (!labelled) problems.push(`unlabelled ${input.tagName.toLowerCase()}`);
    }
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
    const doubled = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (doubled.length > 0) problems.push(`duplicate ids ${[...new Set(doubled)].join(",")}`);
    if (document.querySelectorAll("main").length !== 1) problems.push("one main");
    if (document.documentElement.lang === "") problems.push("html lang");
    return problems;
  });
}

for (const locale of ["en", "ko"] as const) {
  for (const { slug, title } of PAGES) {
    test(`/guide/${slug} (${locale}): title, lead, contents, active link, structure`, async ({
      browser,
    }) => {
      const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
      const { page } = user;
      try {
        await openGuide(page, slug, locale);
        await expect(page.locator("main h1")).toHaveText(title[locale]);
        await expect(page).toHaveTitle(new RegExp(`^${title[locale]} .{1,3} gachipad$`));
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("main .ix-lead")).not.toBeEmpty();

        // The header marks this page, and only this page.
        const current = page.locator('header.ix-header nav a[aria-current="page"]');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAttribute("href", `/guide/${slug}`);

        // The contents list points at sections that exist.
        const links = page.locator("main nav.ix-toc a");
        expect(await links.count()).toBeGreaterThanOrEqual(3);
        for (const href of await links.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("href") ?? ""),
        )) {
          expect(href).toMatch(/^#.+/);
          await expect(page.locator(href), `${slug} ${href}`).toHaveCount(1);
        }

        // Skip link, brand and footer.
        await expect(page.locator('a[href="#main"]').first()).toHaveText(/./);
        await expect(page.locator("header.ix-header a.ix-brand")).toHaveAttribute("href", "/");
        await expect(page.locator("footer.ix-footer")).toBeVisible();

        expect(await structureProblems(page)).toEqual([]);

        // Closed FAQ answers are hidden, so read the DOM text rather than what is rendered.
        const text = await page
          .locator("main, footer")
          .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? "").join(" "));
        expect(text).not.toMatch(WHERE_WORDS);
        expect(text).not.toMatch(OUT_OF_SCOPE);
        expect(text).not.toMatch(/\{\w+\}/);
        expect(await page.title()).not.toMatch(WHERE_WORDS);
      } finally {
        await closeAll(user);
      }
    });

    test(`/guide/${slug} (${locale}): 320px has no horizontal scroll and nothing pokes out`, async ({
      browser,
    }) => {
      const user = await newUser(browser, "Maya", { viewport: { width: 320, height: 700 } });
      const { page } = user;
      try {
        await openGuide(page, slug, locale);
        // Scroll through so every reveal has run before measuring.
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < height; y += 500) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          await page.waitForTimeout(30);
        }
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        const wide = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("main *, footer *")]
            .filter((node) => !node.closest(".ix-table-wrap, .ix-langs-scroll, .ix-code"))
            .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
            .map((node) => `${node.tagName}.${String(node.className).slice(0, 30)}`)
            .slice(0, 5),
        );
        expect(wide).toEqual([]);
      } finally {
        await closeAll(user);
      }
    });
  }
}

test("/guide goes to the first page", async ({ browser }) => {
  const user = await newUser(browser, "Maya");
  try {
    await user.page.goto("/guide");
    await expect(user.page).toHaveURL(/\/guide\/how$/);
    await expect(user.page.locator("main h1")).toBeVisible();
  } finally {
    await closeAll(user);
  }
});

test("the old one-page anchors lead to the right pages", async ({ browser }) => {
  const user = await newUser(browser, "Maya");
  const { page } = user;
  try {
    for (const [anchor, slug] of [
      ["how", "how"],
      ["fast", "network"],
      ["features", "features"],
      ["different", "security"],
      ["faq", "faq"],
    ] as const) {
      await page.goto(`/#${anchor}`);
      await expect(page, anchor).toHaveURL(new RegExp(`/guide/${slug}$`));
      await expect(page.locator("main h1"), anchor).toBeVisible();
    }
    // An unknown anchor stays on the home page.
    await page.goto("/#nothing");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    await expect(page).toHaveURL(/\/#nothing$/);
    // The redirect replaces the entry, so Back does not bounce.
    await page.goto("/");
    await page.goto("/#faq");
    await expect(page).toHaveURL(/\/guide\/faq$/);
    await page.goBack();
    await expect(page.getByTestId("start-panel")).toBeVisible();
  } finally {
    await closeAll(user);
  }
});

test("previous and next walk the pages in the header order", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await openGuide(page, "how", "en");
    const pager = page.locator("nav.ix-pn");
    // The first page has no previous link, the last has no next link.
    await expect(pager.locator('a[data-dir="prev"]')).toHaveCount(0);
    await expect(pager.locator('a[data-dir="next"]')).toHaveAttribute("href", "/guide/features");

    for (let index = 1; index < PAGES.length; index++) {
      const current = PAGES[index];
      await page.locator('nav.ix-pn a[data-dir="next"]').click();
      await expect(page).toHaveURL(new RegExp(`/guide/${PAGES[index]?.slug}$`));
      await expect(page.locator("main h1")).toHaveText(current?.title.en ?? "");
      // A new page starts at the top, with the focus on its title.
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await expect(page.locator("main h1")).toBeFocused();
      await expect(page.locator('nav.ix-pn a[data-dir="prev"]')).toHaveAttribute(
        "href",
        `/guide/${PAGES[index - 1]?.slug}`,
      );
    }
    await expect(page.locator('nav.ix-pn a[data-dir="next"]')).toHaveCount(0);
  } finally {
    await closeAll(user);
  }
});

test("header links go to the pages and mark the current one", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await page.goto("/");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    // No guide page is current on the home page, and the brand leads back to it.
    await expect(page.locator('header.ix-header nav a[aria-current="page"]')).toHaveCount(0);
    for (const { slug, title } of PAGES) {
      await page.locator(`header.ix-header nav a[href="/guide/${slug}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/guide/${slug}$`));
      await expect(page.locator("main h1")).toHaveText(title.en);
      await expect(page.locator('header.ix-header nav a[aria-current="page"]')).toHaveAttribute(
        "href",
        `/guide/${slug}`,
      );
    }
    await page.locator("header.ix-header a.ix-brand").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("start-panel")).toBeVisible();
  } finally {
    await closeAll(user);
  }
});

test("the skip link moves the focus into the content", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await openGuide(page, "how", "en");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" }).first();
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator("main")).toBeFocused();
  } finally {
    await closeAll(user);
  }
});

test("the first move from the home page into the guide, and back, keeps the focus in the content", async ({
  browser,
}) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await page.goto("/");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    // By keyboard: the link that was followed is gone with the home page.
    const link = page.locator('header.ix-header nav a[href="/guide/how"]');
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/guide\/how$/);
    await expect(page.locator("main h1")).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("H1");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    // Back to the home page through the brand link: focus lands on its content.
    await page.locator("header.ix-header a.ix-brand").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("start-panel")).toBeVisible();
    await expect(page.locator("main")).toBeFocused();

    // Browser Back returns to the guide page with the focus on its title.
    await page.goBack();
    await expect(page).toHaveURL(/\/guide\/how$/);
    await expect(page.locator("main h1")).toBeFocused();

    // Loading a page is not a move: the skip link stays the first stop.
    await page.reload();
    await expect(page.locator("main h1")).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  } finally {
    await closeAll(user);
  }
});

test("the home page has one skip link and it leads into the content", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await page.goto("/");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(1);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  } finally {
    await closeAll(user);
  }
});

test("a malformed fragment is ignored instead of breaking the page", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    for (const path of ["/guide/how#%E0%A4%A", "/guide/faq#%", "/guide/security#100%"]) {
      await page.goto(path);
      await expect(page.locator("main h1"), path).toBeVisible();
      await expect(page.getByText("This screen could not be displayed"), path).toHaveCount(0);
    }
    // And one that is valid but names nothing.
    await page.goto("/guide/how#nothing-here");
    await expect(page.locator("main h1")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await closeAll(user);
  }
});

test("faq: a new fragment on the open page opens that answer", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await openGuide(page, "faq", "en");
    const pin = page.locator("#pin button[aria-expanded]");
    const save = page.locator("#save button[aria-expanded]");
    await expect(pin).toHaveAttribute("aria-expanded", "false");

    await page.evaluate(() => {
      window.location.hash = "#pin";
    });
    await expect(pin).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#pin")).toBeInViewport();

    // Closed by hand, then reached again by Back and Forward.
    await pin.click();
    await expect(pin).toHaveAttribute("aria-expanded", "false");
    await page.evaluate(() => {
      window.location.hash = "#save";
    });
    await expect(save).toHaveAttribute("aria-expanded", "true");
    await page.goBack();
    await expect(page).toHaveURL(/\/guide\/faq#pin$/);
    await expect(pin).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#pin")).toBeInViewport();
  } finally {
    await closeAll(user);
  }
});

test("features: the language list is searchable and loads on demand", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    const loaded: string[] = [];
    page.on("request", (request) => loaded.push(request.url()));
    await openGuide(page, "features", "en");
    const list = page.locator(".ix-langs li");
    await page.locator("#languages").scrollIntoViewIfNeeded();
    await expect.poll(() => list.count()).toBeGreaterThan(200);
    const status = page.locator(".ix-langbox-status");
    await expect(status).toContainText(/\d+/);

    const search = page.getByRole("searchbox");
    await search.fill("rust");
    await expect(list.first()).toContainText("Rust");
    expect(await list.count()).toBeLessThan(10);
    await search.fill(".py");
    await expect(page.locator(".ix-langs")).toContainText("Python");
    await search.fill("zzzzzzzz");
    await expect(list).toHaveCount(0);
    await expect(status).toContainText("zzzzzzzz");
    // No request leaves the app's own origin.
    const origin = new URL(page.url()).origin;
    expect(loaded.filter((url) => url.startsWith("http") && !url.startsWith(origin))).toEqual([]);
  } finally {
    await closeAll(user);
  }
});

test("features: the shortcut table switches between Mac and Windows keys", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await openGuide(page, "features", "en");
    const section = page.locator("#shortcuts");
    await expect(section.locator("table")).toHaveCount(3);
    const mac = section.getByRole("button", { name: "Mac" });
    const windows = section.getByRole("button", { name: "Windows and Linux" });
    await windows.click();
    await expect(windows).toHaveAttribute("aria-pressed", "true");
    await expect(mac).toHaveAttribute("aria-pressed", "false");
    await expect(section.locator("kbd", { hasText: "Ctrl" }).first()).toBeVisible();
    await expect(section.locator("kbd", { hasText: "⌘" })).toHaveCount(0);
    await mac.click();
    await expect(mac).toHaveAttribute("aria-pressed", "true");
    await expect(section.locator("kbd", { hasText: "⌘" }).first()).toBeVisible();
    // Every row has a name and keys.
    for (const row of await section.locator("tbody tr").all()) {
      await expect(row.locator("th")).not.toBeEmpty();
      expect(await row.locator("kbd").count()).toBeGreaterThan(0);
    }
  } finally {
    await closeAll(user);
  }
});

test("faq: questions open and close, and a link to a question opens it", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await openGuide(page, "faq", "en", "#pin");
    const question = page.locator("#pin button[aria-expanded]");
    await expect(question).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#pin")).toBeInViewport();
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "false");

    // Keyboard: the question is a real button.
    const save = page.locator("#save button[aria-expanded]");
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(save).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#save-answer")).toBeVisible();
    // The expiry answer quotes the server's value, not a placeholder.
    await page.locator("#expiry button[aria-expanded]").click();
    await expect(page.locator("#expiry-answer")).toContainText(/\d/);
  } finally {
    await closeAll(user);
  }
});

test("reduced motion: nothing on a guide page stays hidden or moves", async ({ browser }) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const { slug } of PAGES) {
      await openGuide(page, slug, "en");
      const hidden = await page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>("[data-reveal]")].filter(
            (node) => getComputedStyle(node).opacity !== "1",
          ).length,
      );
      expect(hidden, slug).toBe(0);
      await expect(page.locator("main h1")).toHaveCSS("animation-name", /^(none|ix-rise)$/);
      await expect(page.locator("main h1")).toHaveCSS(
        "animation-duration",
        /^(0s|1e-05s|0\.00001s)$/,
      );
    }
  } finally {
    await closeAll(user);
  }
});

test("a scroll jump reveals passed content even when the observer misses it", async ({
  browser,
}) => {
  const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
  const { page } = user;
  try {
    await page.addInitScript(() => {
      const Observer = window.IntersectionObserver;
      window.IntersectionObserver = class extends Observer {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          // A fast jump can leave a short reveal target non-intersecting at both samples.
          super(options?.threshold === 0.08 ? () => {} : callback, options);
        }
      };
    });
    await openGuide(page, "features", "en");
    const hidden = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>("main [data-reveal]")].filter(
            (node) => getComputedStyle(node).opacity !== "1",
          ).length,
      );
    await expect.poll(hidden).toBeGreaterThan(0);
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
    );
    await expect.poll(hidden).toBe(0);
  } finally {
    await closeAll(user);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme}: scrolling reveals every part of every page`, async ({ browser }) => {
    const user = await newUser(browser, "Maya", {
      viewport: { width: 1280, height: 800 },
      colorScheme: scheme,
    });
    const { page } = user;
    try {
      for (const { slug } of PAGES) {
        await openGuide(page, slug, "en");
        for (
          let y = 0;
          y < (await page.evaluate(() => document.documentElement.scrollHeight));
          y += 400
        ) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          await page.waitForTimeout(40);
        }
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  [...document.querySelectorAll<HTMLElement>("main [data-reveal]")].filter(
                    (node) => getComputedStyle(node).opacity !== "1",
                  ).length,
              ),
            { message: slug },
          )
          .toBe(0);
      }
    } finally {
      await closeAll(user);
    }
  });
}

// ── Adding files, the cursor display setting and the questions around them ──

test("how: the adding-files section covers the ways in, duplicates and what is skipped", async ({
  browser,
}) => {
  for (const [locale, heading, duplicate, skipped] of [
    ["en", "Adding files", "When the name already exists", "What is skipped"],
    ["ko", "파일 넣는 방법", "같은 이름의 파일이 있으면", "건너뛰는 파일"],
  ] as const) {
    const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
    const { page } = user;
    try {
      await openGuide(page, "how", locale, "#files");
      const section = page.locator("section#files");
      await expect(section.getByRole("heading", { level: 2 })).toHaveText(heading);
      await expect(page.locator('nav.ix-toc a[href="#files"]')).toHaveText(heading);
      // Four ways in, then the two rules people ask about.
      await expect(section.locator(".ix-gcard")).toHaveCount(4);
      await expect(section).toContainText(duplicate);
      await expect(section).toContainText(skipped);
      await expect(section).toContainText("main (2).py");
      await expect(section).toContainText(".zip");
      // The numbers are the ones the product uses, not placeholders.
      await expect(section).not.toContainText(/\{\w+\}/);
      await expect(section).toContainText("5");
      await expect(section).toContainText("100");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    } finally {
      await closeAll(user);
    }
  }
});

test("features: the cursor display section explains each mode, and the files section links to adding files", async ({
  browser,
}) => {
  for (const [locale, heading, auto] of [
    ["en", "Other people's cursors", "Auto (default)"],
    ["ko", "다른 사람 커서", "자동 (기본)"],
  ] as const) {
    const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
    const { page } = user;
    try {
      await openGuide(page, "features", locale, "#cursors");
      const section = page.locator("section#cursors");
      await expect(section.getByRole("heading", { level: 2 })).toHaveText(heading);
      await expect(section).toContainText(auto);
      await expect(section).not.toContainText(/\{\w+\}/);
      await expect(page.locator('nav.ix-toc a[href="#cursors"]')).toHaveCount(1);
      const more = page.locator('section#files a[href="/guide/how#files"]');
      await expect(more).toHaveCount(1);
    } finally {
      await closeAll(user);
    }
  }
});

test("faq: the questions about duplicate names, upload problems and cursors are there", async ({
  browser,
}) => {
  for (const [locale, questions] of [
    [
      "en",
      [
        ["duplicate", "What if a file with the same name is uploaded?"],
        ["uploadFails", "My files won't upload"],
        ["cursors", "Other people's cursors are distracting"],
      ],
    ],
    [
      "ko",
      [
        ["duplicate", "같은 이름 파일을 올리면?"],
        ["uploadFails", "파일이 안 올라가요"],
        ["cursors", "다른 사람 커서가 거슬려요"],
      ],
    ],
  ] as const) {
    const user = await newUser(browser, "Maya", { viewport: { width: 1280, height: 800 } });
    const { page } = user;
    try {
      for (const [id, question] of questions) {
        await openGuide(page, "faq", locale, `#${id}`);
        // A link to a question opens its answer.
        const button = page.locator(`#${id} button[aria-expanded]`);
        await expect(button).toHaveAttribute("aria-expanded", "true");
        await expect(button).toContainText(question);
      }
    } finally {
      await closeAll(user);
    }
  }
});
