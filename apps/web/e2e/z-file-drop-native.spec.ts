import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { closeAll, createShare, editorText, newUser, waitForEditor } from "./helpers";

/**
 * Dropping real files on disk through Chromium's own drag input (CDP), the path an OS file manager
 * takes: trusted events, a browser-built DataTransfer and real folder entries, which script-built
 * events in z-file-drop.spec.ts cannot produce.
 */

test.skip(({ browserName }) => browserName !== "chromium", "CDP drag input is Chromium only");

function fixtures() {
  const dir = mkdtempSync(join(tmpdir(), "gachipad-drop-"));
  writeFileSync(join(dir, "main.py"), "print('from disk')\n");
  mkdirSync(join(dir, "project/src"), { recursive: true });
  mkdirSync(join(dir, "project/node_modules/dep"), { recursive: true });
  writeFileSync(join(dir, "project/src/app.py"), "x = 1\n");
  writeFileSync(join(dir, "project/README.md"), "# hello\n");
  writeFileSync(join(dir, "project/node_modules/dep/index.js"), "module.exports = 1;\n");
  return dir;
}

async function nativeDrop(page: Page, files: string[], point: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  await cdp.send("Input.setInterceptDrags", { enabled: false });
  await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", ...point, data });
  await cdp.send("Input.dispatchDragEvent", { type: "dragOver", ...point, data });
  await expect(page.getByTestId("file-drop-overlay")).toBeVisible();
  await cdp.send("Input.dispatchDragEvent", { type: "drop", ...point, data });
  await cdp.detach();
}

test("a real file dropped on the top bar is added and the page stays", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    await waitForEditor(owner.page);
    const url = owner.page.url();
    await nativeDrop(owner.page, [join(fixtures(), "main.py")], { x: 400, y: 20 });
    await expect(owner.page.getByText("main.py").first()).toBeVisible();
    await expect.poll(() => editorText(owner.page)).toContain("from disk");
    expect(owner.page.url()).toBe(url);
    await expect(owner.page.getByTestId("file-drop-overlay")).toBeHidden();
  } finally {
    await closeAll(owner);
  }
});

test("a real folder keeps its paths and leaves dependencies out", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    await waitForEditor(owner.page);
    await nativeDrop(owner.page, [join(fixtures(), "project")], { x: 640, y: 400 });
    await expect(owner.page.getByText(/project\/README\.md|README\.md/).first()).toBeVisible();
    await expect(owner.page.getByText(/app\.py/).first()).toBeVisible();
    await expect(owner.page.getByText(/index\.js/)).toHaveCount(0);
  } finally {
    await closeAll(owner);
  }
});

test("a real file dropped on the landing page opens a new share", async ({ browser }) => {
  const visitor = await newUser(browser, "Visitor");
  try {
    await visitor.page.goto("/");
    await expect(visitor.page.getByTestId("new-share")).toBeVisible();
    await nativeDrop(visitor.page, [join(fixtures(), "main.py")], { x: 640, y: 300 });
    await visitor.page.waitForURL(/\/[A-Za-z0-9_-]{6,}(?:[?#].*)?$/);
    await waitForEditor(visitor.page);
    await expect.poll(() => editorText(visitor.page)).toContain("from disk");
  } finally {
    await closeAll(visitor);
  }
});
