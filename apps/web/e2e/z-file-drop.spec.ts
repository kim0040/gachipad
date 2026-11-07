import { expect, type JSHandle, type Locator, type Page, type Route, test } from "@playwright/test";
import { BASE_URL } from "./env";
import {
  closeAll,
  closeDialog,
  createShare,
  editorText,
  joinByLink,
  newUser,
  openShareDialog,
  shareIdOf,
  waitForEditor,
} from "./helpers";

/**
 * Dropping files anywhere on the site. The events are real DOM drag events carrying a real
 * DataTransfer built in the page; a synthetic drop has no default action, so whether the browser
 * would have navigated is read from `defaultPrevented`.
 */

interface DropFile {
  name: string;
  content: string | number[];
  type?: string;
}

const SHOTS = "../../.box-out/file-drop";

async function transferOf(
  page: Page,
  files: DropFile[],
  data: [string, string][] = [],
): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle(
    ([list, extra]) => {
      const transfer = new DataTransfer();
      for (const file of list) {
        const body = typeof file.content === "string" ? file.content : new Uint8Array(file.content);
        transfer.items.add(new File([body], file.name, { type: file.type ?? "text/plain" }));
      }
      for (const [type, value] of extra) transfer.setData(type, value);
      return transfer;
    },
    [files, data] as const,
  );
}

/** A paste on `selector`. Firefox ignores `clipboardData` in the constructor, so the event gets it. */
async function paste(page: Page, selector: string, files: DropFile[], data: [string, string][]) {
  const transfer = await transferOf(page, files, data);
  await page.evaluate(
    ([where, handle]) => {
      const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: handle });
      document.querySelector(where as string)?.dispatchEvent(event);
    },
    [selector, transfer] as const,
  );
  await transfer.dispose();
}

/** A drag that enters the page at `target`, and keeps sending `dragover` like a browser does. */
async function dragOver(page: Page, target: Locator, transfer: JSHandle<DataTransfer>) {
  await target.dispatchEvent("dragenter", { dataTransfer: transfer });
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await page.evaluate((handle) => {
    const w = window as unknown as { __dragTimer?: number };
    window.clearInterval(w.__dragTimer);
    w.__dragTimer = window.setInterval(() => {
      document.body.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: handle }),
      );
    }, 300);
  }, transfer);
}

async function stopDrag(page: Page) {
  await page.evaluate(() => {
    window.clearInterval((window as unknown as { __dragTimer?: number }).__dragTimer);
  });
}

async function drop(page: Page, target: Locator, transfer: JSHandle<DataTransfer>) {
  await stopDrag(page);
  await target.dispatchEvent("drop", { dataTransfer: transfer });
}

/** Drops files on `target` the way a person would: enter, over, drop. */
async function dropFiles(page: Page, target: Locator, files: DropFile[]) {
  const transfer = await transferOf(page, files);
  await dragOver(page, target, transfer);
  await drop(page, target, transfer);
  await transfer.dispose();
}

type Node = { file: string; body: string } | { dir: string; children: Node[] };

/** A drop of one folder. A script cannot make a real folder drop, so the entry tree is faked in the shape webkitGetAsEntry returns. */
async function folderTransfer(page: Page, root: Node): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle((tree) => {
    type Spec = { file: string; body: string } | { dir: string; children: Spec[] };
    const entry = (node: Spec, parent: string): unknown => {
      if ("file" in node) {
        const path = `${parent}/${node.file}`;
        return {
          isFile: true,
          isDirectory: false,
          name: node.file,
          fullPath: path,
          file: (ok: (f: File) => void) => ok(new File([node.body], node.file)),
        };
      }
      const path = `${parent}/${node.dir}`;
      return {
        isFile: false,
        isDirectory: true,
        name: node.dir,
        fullPath: path,
        createReader: () => {
          let done = false;
          return {
            readEntries: (ok: (e: unknown[]) => void) => {
              ok(done ? [] : node.children.map((child) => entry(child, path)));
              done = true;
            },
          };
        },
      };
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([""], "folder"));
    const root = entry(tree, "");
    Object.defineProperty(transfer, "items", {
      value: [{ kind: "file", webkitGetAsEntry: () => root, getAsFile: () => null }],
    });
    return transfer;
  }, root);
}

const overlay = (page: Page) => page.getByTestId("file-drop-overlay");
const tabs = (page: Page) => page.locator('[data-testid^="tab-"]');
/** A toast is also announced in a hidden live region, so the same text can be found twice. */
const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

const targets = {
  tabs: (page: Page) => page.getByTestId("files-toggle"),
  topBar: (page: Page) => page.getByTestId("share-button"),
  editor: (page: Page) => page.locator(".cm-content"),
  statusBar: (page: Page) => page.getByTestId("cursor-position"),
};

test("a file dropped on the tabs, the top bar, the editor or the status bar is added once, with its language", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    const url = page.url();
    const cases = [
      ["tabs", "first.py", "print('a')\n", /python/i],
      ["topBar", "second.js", "export const b = 2;\n", /javascript/i],
      ["editor", "third.md", "# third\n", /markdown/i],
      ["statusBar", "fourth.json", '{"d": 4}\n', /json/i],
    ] as const;
    let expected = 1;
    for (const [where, name, content, language] of cases) {
      await dropFiles(page, targets[where](page), [{ name, content }]);
      await expect(page.getByTestId(`tab-${name}`)).toBeVisible();
      await expect(toastText(page, `Added ${name}`)).toBeVisible();
      await expect(page.getByTestId("language-button")).toContainText(language);
      await expect.poll(() => editorText(page)).toBe(content.replace(/\n/g, ""));
      // The first file fills the empty placeholder; every other one is a new file, never two.
      if (where !== "tabs") expected++;
      await expect(tabs(page), where).toHaveCount(expected);
    }
    // The editor's own drop handler inserted nothing into the file that was open before.
    await page.getByTestId("tab-second.js").click();
    await expect.poll(() => editorText(page)).toBe("export const b = 2;");
    expect(page.url()).toBe(url);
    await expect(page.getByTestId("editor")).toBeVisible();
  } finally {
    await closeAll(owner);
  }
});

test("a file dropped on no target never makes the browser leave", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  try {
    const page = owner.page;
    const prevented = async (selector: string) => {
      const transfer = await transferOf(page, [{ name: "a.txt", content: "a" }]);
      const result = await page.evaluate(
        ([sel, handle]) => {
          const target = document.querySelector(sel as string) ?? document.body;
          const run = (type: string) => {
            const event = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: handle as DataTransfer,
            });
            target.dispatchEvent(event);
            return event.defaultPrevented;
          };
          return { over: run("dragover"), drop: run("drop") };
        },
        [selector, transfer] as const,
      );
      await transfer.dispose();
      return result;
    };
    // Routes without any drop handling of their own.
    for (const path of ["/guide", "/me", "/nothing-here-at-all"]) {
      await page.goto(path);
      await expect(page.getByRole("main").first()).toBeVisible();
      await expect
        .poll(() => prevented("body"), { message: path })
        .toEqual({
          over: true,
          drop: true,
        });
    }
    // A real file input keeps its own behaviour.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "plain-file-input";
      document.body.append(input);
    });
    expect(await prevented("#plain-file-input")).toEqual({ over: false, drop: false });
    // Dragging text is not a file drag and is left alone.
    const text = await transferOf(page, [], [["text/plain", "hello"]]);
    const textPrevented = await page.evaluate((handle) => {
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: handle,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    }, text);
    expect(textPrevented).toBe(false);
  } finally {
    await closeAll(owner);
  }
});

test("the overlay shows for files only, and goes away when the drag does", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    const editor = targets.editor(page);

    // Text and an internal tab drag never show it.
    const text = await transferOf(page, [], [["text/plain", "just words"]]);
    await editor.dispatchEvent("dragenter", { dataTransfer: text });
    await editor.dispatchEvent("dragover", { dataTransfer: text });
    await expect(overlay(page)).toHaveCount(0);
    const tab = await transferOf(
      page,
      [],
      [
        ["application/x-gachipad-file", "some-id"],
        ["text/plain", "some-id"],
      ],
    );
    await editor.dispatchEvent("dragenter", { dataTransfer: tab });
    await expect(overlay(page)).toHaveCount(0);

    const files = await transferOf(page, [{ name: "a.txt", content: "a" }]);
    await dragOver(page, targets.tabs(page), files);
    await expect(overlay(page)).toBeVisible();
    await expect(overlay(page)).toContainText("Drop to add to this share");
    await expect(overlay(page)).toContainText("Files, folders and .zip archives all work");
    // It never takes the pointer, so what is underneath still receives the events.
    expect(await overlay(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

    // Leaving the window ends it ...
    await stopDrag(page);
    await page.evaluate((handle) => {
      document.body.dispatchEvent(
        new DragEvent("dragleave", {
          bubbles: true,
          clientX: 0,
          clientY: 0,
          dataTransfer: handle,
        }),
      );
    }, files);
    await expect(overlay(page)).toHaveCount(0);

    // ... and so does Esc (a cancelled drag sends no more events).
    await dragOver(page, editor, files);
    await expect(overlay(page)).toBeVisible();
    await stopDrag(page);
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveCount(0);

    // A drag that just stops sending events ends too.
    await stopDrag(page);
    await editor.dispatchEvent("dragenter", { dataTransfer: files });
    await expect(overlay(page)).toBeVisible();
    await expect(overlay(page)).toHaveCount(0, { timeout: 8000 });
  } finally {
    await closeAll(owner);
  }
});

test("the same file dropped again is not added twice; a different file with its name gets a number", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    const editor = targets.editor(page);
    await dropFiles(page, editor, [{ name: "main.py", content: "print(1)\n" }]);
    await expect(page.getByTestId("tab-main.py")).toBeVisible();

    await dropFiles(page, editor, [{ name: "main.py", content: "print(1)\n" }]);
    await expect(toastText(page, /main\.py with the same content is already here/)).toBeVisible();
    await expect(tabs(page)).toHaveCount(1);

    await dropFiles(page, editor, [{ name: "main.py", content: "print(2)\n" }]);
    await expect(page.getByTestId("tab-main (2).py")).toBeVisible();
    await expect(
      toastText(
        page,
        "main.py already exists with different content, so this file was added as main (2).py.",
      ),
    ).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);
    await expect.poll(() => editorText(page)).toBe("print(2)");
    // The first file is as it was.
    await page.getByTestId("tab-main.py").click();
    await expect.poll(() => editorText(page)).toBe("print(1)");

    // Dropping the numbered one again finds it instead of making main (3).py.
    await dropFiles(page, editor, [{ name: "main.py", content: "print(2)\n" }]);
    await expect(tabs(page)).toHaveCount(2);
  } finally {
    await closeAll(owner);
  }
});

test("a binary file is skipped by name, and the rest of the drop still arrives", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    await dropFiles(page, targets.editor(page), [
      { name: "logo.png", content: [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1], type: "image/png" },
      { name: "ok.txt", content: "fine\n" },
    ]);
    await expect(page.getByTestId("tab-ok.txt")).toBeVisible();
    await expect(page.getByTestId("tab-logo.png")).toHaveCount(0);
    await expect(toastText(page, "Added ok.txt")).toBeVisible();
    await expect(toastText(page, "1 item was skipped")).toBeVisible();
    await expect(toastText(page, "logo.png (not a text file)")).toBeVisible();
  } finally {
    await closeAll(owner);
  }
});

test("a folder keeps its paths and leaves dependency folders out, saying so", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    const transfer = await folderTransfer(page, {
      dir: "proj",
      children: [
        { file: "app.py", body: "print('app')\n" },
        { dir: "src", children: [{ file: "util.py", body: "x = 1\n" }] },
        { dir: "node_modules", children: [{ file: "index.js", body: "1" }] },
        { dir: ".git", children: [{ file: "HEAD", body: "ref" }] },
      ],
    });
    await dragOver(page, targets.editor(page), transfer);
    await drop(page, targets.editor(page), transfer);
    await expect(page.getByTestId("tab-proj/app.py")).toBeVisible();
    await expect(page.getByTestId("tab-proj/src/util.py")).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);
    await expect(toastText(page, "2 items were skipped")).toBeVisible();
    await expect(
      toastText(page, /proj\/node_modules \(folders like this are skipped\)/),
    ).toBeVisible();
  } finally {
    await closeAll(owner);
  }
});

test("a view-only visitor sees why nothing can be added, and a drop says so", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Owner");
  const viewer = await newUser(browser, "Viewer");
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
    await closeDialog(owner.page);

    const page = viewer.page;
    await page.goto(new URL(viewUrl).pathname);
    await waitForEditor(page);
    await expect(page.getByTestId("banner-readonly")).toBeVisible();
    const before = await tabs(page).count();

    const transfer = await transferOf(page, [{ name: "a.txt", content: "a" }]);
    await dragOver(page, targets.editor(page), transfer);
    await expect(overlay(page)).toHaveAttribute("data-mode", "denied");
    await expect(overlay(page)).toContainText("This share is view-only, so files can't be added");
    await expect(overlay(page)).toContainText("Nothing will be added if you drop here");
    const effect = await page.evaluate((handle) => {
      const event = new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: handle,
      });
      document.body.dispatchEvent(event);
      return handle.dropEffect;
    }, transfer);
    expect(effect).toBe("none");
    await page.screenshot({ path: `${SHOTS}/overlay-view-only.png` });

    await drop(page, targets.editor(page), transfer);
    await expect(toastText(page, "This share is view-only, so files can't be added")).toBeVisible();
    await expect(overlay(page)).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(before);
    // Pasting a copied file is refused the same way.
    await paste(
      page,
      ".cm-content",
      [{ name: "pasted.txt", content: "x" }],
      [["text/plain", "pasted.txt"]],
    );
    await expect(tabs(page)).toHaveCount(before);
    await transfer.dispose();
  } finally {
    await closeAll(owner, viewer);
  }
});

test("a drop on a person in the share dialog still goes to that person, not into the share", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Sender");
  const receiver = await newUser(browser, "Receiver");
  try {
    await receiver.page.goto("/");
    await expect(receiver.page.getByTestId("start-panel")).toBeVisible();
    await createShare(owner.page);
    const page = owner.page;
    const before = await tabs(page).count();
    const dialog = await openShareDialog(page, "Send");
    const target = dialog.getByTestId(`presence-${receiver.name}`);
    await expect(target).toBeVisible({ timeout: 20_000 });

    const transfer = await transferOf(page, [{ name: "send-me.txt", content: "for you" }]);
    // With a dialog open the page offers no overlay of its own.
    await dragOver(page, target, transfer);
    await expect(overlay(page)).toHaveCount(0);
    await drop(page, target, transfer);
    await expect(toastText(page, `Sent to ${receiver.name}`)).toBeVisible();
    await expect(receiver.page.getByText(`${owner.name} sent you a share`).first()).toBeVisible({
      timeout: 15_000,
    });
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(tabs(page)).toHaveCount(before);
    await expect(page.getByTestId("tab-send-me.txt")).toHaveCount(0);
    await transfer.dispose();
  } finally {
    await closeAll(owner, receiver);
  }
});

test("a drop on a person in the top bar is left to that person, with no overlay", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Sender");
  const receiver = await newUser(browser, "Receiver");
  try {
    await createShare(owner.page);
    await joinByLink(receiver, shareIdOf(owner.page));
    await waitForEditor(receiver.page);
    const page = owner.page;
    const person = page.getByTestId("people").locator("button[data-file-drop-target]");
    await expect(person).toBeVisible({ timeout: 20_000 });
    const before = await tabs(page).count();
    const transfer = await transferOf(page, [{ name: "for-them.txt", content: "x" }]);
    await dragOver(page, person, transfer);
    await expect(overlay(page)).toHaveCount(0);
    await drop(page, person, transfer);
    await expect(tabs(page)).toHaveCount(before);
    await transfer.dispose();
  } finally {
    await closeAll(owner, receiver);
  }
});

test("the landing page turns a drop anywhere into a new share, and shows it is working", async ({
  browser,
}) => {
  const visitor = await newUser(browser, "Visitor");
  try {
    const page = visitor.page;
    await page.goto("/");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    const transfer = await transferOf(page, [{ name: "hello.py", content: "print('hi')\n" }]);
    await dragOver(page, page.locator("body"), transfer);
    await expect(overlay(page)).toContainText("Drop to start a new share");
    await expect(overlay(page)).toContainText("Files, folders and .zip archives all work");
    await page.screenshot({ path: `${SHOTS}/overlay-landing.png` });

    await page.route("**/api/uploads*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await drop(page, page.locator("body"), transfer);
    await expect(overlay(page)).toHaveAttribute("data-mode", "busy");
    await expect(overlay(page)).toContainText("Creating a new share");
    await page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(page);
    await expect(page.getByTestId("tab-hello.py")).toBeVisible();
    await expect.poll(() => editorText(page)).toBe("print('hi')");
    await transfer.dispose();
  } finally {
    await closeAll(visitor);
  }
});

test("a drop on the landing page that cannot become a share says exactly why", async ({
  browser,
}) => {
  const visitor = await newUser(browser, "Visitor");
  try {
    const page = visitor.page;
    await page.goto("/");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    const attempt = async () => {
      await dropFiles(page, page.locator("body"), [{ name: "a.txt", content: "a" }]);
    };
    const reply = (status: number, code: string) =>
      page.route("**/api/uploads*", (route) =>
        route.fulfill({ status, json: { error: { code, message: code } } }),
      );

    await reply(413, "too_large");
    await attempt();
    await expect(toastText(page, "That's too large to save")).toBeVisible();

    await page.unroute("**/api/uploads*");
    await reply(429, "rate_limited");
    await attempt();
    await expect(toastText(page, "Too many attempts")).toBeVisible();

    await page.unroute("**/api/uploads*");
    await reply(429, "upload_pool_limited");
    await attempt();
    await expect(
      toastText(page, "This address has reached its upload storage limit"),
    ).toBeVisible();

    await page.unroute("**/api/uploads*");
    await reply(400, "validation");
    await attempt();
    await expect(toastText(page, "No text files found")).toBeVisible();

    await page.unroute("**/api/uploads*");
    await page.route("**/api/uploads*", (route) => route.abort("connectionrefused"));
    await attempt();
    await expect(toastText(page, "Can't reach the server")).toBeVisible();
    // Still on the landing page, and still usable.
    await expect(page.getByTestId("new-share")).toBeEnabled();

    // Only a dependency folder: no request at all, and it says what was left out.
    await page.unroute("**/api/uploads*");
    let requested = false;
    await page.route("**/api/uploads*", (route) => {
      requested = true;
      return route.abort();
    });
    const folder = await folderTransfer(page, {
      dir: "node_modules",
      children: [{ file: "index.js", body: "1" }],
    });
    await dragOver(page, page.locator("body"), folder);
    await drop(page, page.locator("body"), folder);
    await expect(toastText(page, "1 item was skipped")).toBeVisible();
    await expect(toastText(page, "node_modules (folders like this are skipped)")).toBeVisible();
    expect(requested).toBe(false);
    await folder.dispose();
  } finally {
    await closeAll(visitor);
  }
});

test("crossing a person keeps the drag alive: the overlay steps aside and comes back, with no reset", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Sender");
  const receiver = await newUser(browser, "Receiver");
  try {
    await createShare(owner.page);
    await joinByLink(receiver, shareIdOf(owner.page));
    await waitForEditor(receiver.page);
    const page = owner.page;
    const person = page.getByTestId("people").locator("button[data-file-drop-target]");
    await expect(person).toBeVisible({ timeout: 20_000 });
    const editor = targets.editor(page);
    const files = await transferOf(page, [{ name: "a.txt", content: "a" }]);
    const event = (target: Locator, type: string) =>
      target.dispatchEvent(type, { dataTransfer: files });

    await event(editor, "dragenter");
    await event(editor, "dragover");
    await expect(overlay(page)).toBeVisible();

    // Into the person: entering comes before leaving, as in a browser.
    await event(person, "dragenter");
    await event(editor, "dragleave");
    await event(person, "dragover");
    await expect(overlay(page)).toHaveCount(0);

    // And back out: the count of what the pointer is inside has to be right all along.
    await event(editor, "dragenter");
    await event(person, "dragleave");
    await event(editor, "dragover");
    await expect(overlay(page)).toBeVisible();
    await page.waitForTimeout(300);
    await expect(overlay(page)).toBeVisible();

    // Only leaving the last element ends the drag.
    await event(editor, "dragleave");
    await expect(overlay(page)).toHaveCount(0);
    await files.dispose();
  } finally {
    await closeAll(owner, receiver);
  }
});

for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["320", { width: 320, height: 640 }],
] as const) {
  test(`the overlay leaves the top bar uncovered on a share, ${label}`, async ({ browser }) => {
    const owner = await newUser(browser, "Owner", { viewport });
    try {
      await createShare(owner.page);
      const page = owner.page;
      const transfer = await transferOf(page, [{ name: "a.txt", content: "a" }]);
      await dragOver(page, targets.editor(page), transfer);
      await expect(overlay(page)).toBeVisible();
      const cover = await overlay(page).boundingBox();
      const bar = await page.locator("header").first().boundingBox();
      if (!cover || !bar) throw new Error("no boxes");
      expect(cover.y).toBeGreaterThanOrEqual(bar.y + bar.height);
      expect(cover.y + cover.height).toBe(viewport.height);
      await stopDrag(page);
      await transfer.dispose();
    } finally {
      await closeAll(owner);
    }
  });
}

test("the overlay's words reach a live region that was already there", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    const status = page.getByTestId("file-drop-status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveText("");
    await status.evaluate((el) => {
      (el as HTMLElement & { same?: boolean }).same = true;
    });
    const transfer = await transferOf(page, [{ name: "a.txt", content: "a" }]);
    await dragOver(page, targets.editor(page), transfer);
    await expect(status).toContainText("Drop to add to this share");
    // The same node: a region that is replaced with its text in it is not announced.
    expect(await status.evaluate((el) => (el as HTMLElement & { same?: boolean }).same)).toBe(true);
    await stopDrag(page);
    await page.keyboard.press("Escape");
    await expect(status).toHaveText("");
    await transfer.dispose();
  } finally {
    await closeAll(owner);
  }
});

test("a sheet open on the page does not swallow a drop", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    await page.getByTestId("settings-button").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const transfer = await transferOf(page, [{ name: "while-open.py", content: "print(1)\n" }]);
    await dragOver(page, sheet, transfer);
    await expect(overlay(page)).toBeVisible();
    await drop(page, sheet, transfer);
    await expect(toastText(page, "Added while-open.py")).toBeVisible();
    await expect(page.getByTestId("tab-while-open.py")).toHaveCount(1);
    await transfer.dispose();
  } finally {
    await closeAll(owner);
  }
});

test("a dialog with its own drop zone keeps the drag to itself", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    await page.getByTestId("upload-files").click();
    const zone = page.getByTestId("upload-zone");
    await expect(zone).toBeVisible();
    const transfer = await transferOf(page, [{ name: "in-zone.py", content: "print(1)\n" }]);
    await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
    await zone.dispatchEvent("dragover", { dataTransfer: transfer });
    await expect(overlay(page)).toHaveCount(0);
    await zone.dispatchEvent("drop", { dataTransfer: transfer });
    await expect(toastText(page, "Added in-zone.py")).toBeVisible();
    await expect(page.getByTestId("tab-in-zone.py")).toHaveCount(1);
    await transfer.dispose();
  } finally {
    await closeAll(owner);
  }
});

test("an import shows the new file: it leaves history and closes the narrow file sheet", async ({
  browser,
}) => {
  const wide = await newUser(browser, "Wide");
  const narrow = await newUser(browser, "Narrow", { viewport: { width: 320, height: 640 } });
  try {
    await createShare(wide.page);
    await wide.page.getByTestId("history-button").click();
    await expect(wide.page.getByTestId("history-view")).toBeVisible();
    await dropFiles(wide.page, wide.page.locator("body"), [
      { name: "from-history.py", content: "print(1)\n" },
    ]);
    await expect(wide.page.getByTestId("history-view")).toBeHidden();
    await expect.poll(() => editorText(wide.page)).toBe("print(1)");

    await createShare(narrow.page);
    await narrow.page.getByTestId("files-toggle").click();
    const sheet = narrow.page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await dropFiles(narrow.page, sheet, [{ name: "from-sheet.py", content: "print(2)\n" }]);
    await expect(sheet).toBeHidden();
    await expect.poll(() => editorText(narrow.page)).toBe("print(2)");
  } finally {
    await closeAll(wide, narrow);
  }
});

test("a file pasted with focus outside the editor is added; a field keeps its own paste", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    const file = (name: string): DropFile[] => [{ name, content: "pasted\n" }];
    await paste(page, "body", file("outside.py"), [["text/plain", "outside.py"]]);
    await expect(page.getByTestId("tab-outside.py")).toBeVisible();

    // What a Linux file manager puts next to the file.
    await paste(page, "body", file("linux.py"), [["text/plain", "file:///home/student/linux.py"]]);
    await expect(page.getByTestId("tab-linux.py")).toBeVisible();

    // A copy from a page or a document, with an image of it attached, is not a file from disk.
    await paste(page, "body", file("image.png"), [
      ["text/plain", "image.png"],
      ["text/html", "<b>words</b>"],
    ]);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("tab-image.png")).toHaveCount(0);

    // In a field the paste is the field's.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "plain-field";
      document.body.append(input);
    });
    await paste(page, "#plain-field", file("field.py"), [["text/plain", "field.py"]]);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("tab-field.py")).toHaveCount(0);
  } finally {
    await closeAll(owner);
  }
});

test("the landing page reads files like the editor does: decoded, normalised, with the same summary", async ({
  browser,
}) => {
  const visitor = await newUser(browser, "Visitor");
  try {
    const page = visitor.page;
    await page.goto("/");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    await dropFiles(page, page.locator("body"), [
      // "hi", CRLF, in UTF-16 with a byte order mark.
      { name: "wide.py", content: [0xff, 0xfe, 0x68, 0, 0x69, 0, 0x0d, 0, 0x0a, 0] },
      // Two Korean syllables in CP949.
      { name: "old.c", content: [0xc7, 0xd1, 0xb1, 0xdb] },
      { name: "logo.png", content: [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1], type: "image/png" },
    ]);
    await page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(page);
    await page.getByTestId("tab-wide.py").click();
    await expect.poll(() => editorText(page)).toBe("hi");
    await page.getByTestId("tab-old.c").click();
    await expect.poll(() => editorText(page)).toBe("한글");
    await expect(tabs(page)).toHaveCount(2);
    await expect(toastText(page, "1 item was skipped")).toBeVisible();
    await expect(toastText(page, "logo.png (not a text file)")).toBeVisible();
  } finally {
    await closeAll(visitor);
  }
});

test("one new share at a time: a drop waits out New share, and New share waits out a drop", async ({
  browser,
}) => {
  const visitor = await newUser(browser, "Visitor");
  try {
    const page = visitor.page;
    await page.goto("/");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    const creates: string[] = [];
    const hold = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      hold.release = resolve;
    });
    const count = async (route: Route) => {
      creates.push(route.request().url());
      await held;
      await route.continue();
    };
    await page.route("**/api/shares", (route) =>
      route.request().method() === "POST" ? count(route) : route.continue(),
    );
    await page.route("**/api/uploads*", count);

    await page.getByTestId("new-share").click();
    await expect.poll(() => creates.length).toBe(1);
    await expect(page.getByTestId("new-from-template")).toBeDisabled();
    await dropFiles(page, page.locator("body"), [{ name: "late.py", content: "print(1)\n" }]);
    await page.waitForTimeout(300);
    expect(creates).toHaveLength(1);
    hold.release();
    await page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(page);
    await expect(page.getByTestId("tab-late.py")).toHaveCount(0);
  } finally {
    await closeAll(visitor);
  }
});

test("a drop in flight leaves New share waiting, and keeps saying it is working", async ({
  browser,
}) => {
  const visitor = await newUser(browser, "Visitor");
  try {
    const page = visitor.page;
    await page.goto("/");
    await expect(page.getByTestId("start-panel")).toBeVisible();
    let shares = 0;
    let uploads = 0;
    const hold = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      hold.release = resolve;
    });
    await page.route("**/api/shares", (route) => {
      if (route.request().method() === "POST") shares++;
      return route.continue();
    });
    await page.route("**/api/uploads*", async (route) => {
      uploads++;
      await held;
      await route.continue();
    });
    await dropFiles(page, page.locator("body"), [{ name: "first.py", content: "print(1)\n" }]);
    await expect.poll(() => uploads).toBe(1);
    await expect(overlay(page)).toHaveAttribute("data-mode", "busy");
    // The overlay takes no pointer, so this is the button itself saying no: loading blocks clicks.
    await expect(page.getByTestId("new-share")).toHaveAttribute("aria-busy", "true");
    await page.evaluate(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="new-share"]')?.click(),
    );
    await dropFiles(page, page.locator("body"), [{ name: "second.py", content: "print(2)\n" }]);
    await page.waitForTimeout(300);
    expect({ shares, uploads }).toEqual({ shares: 0, uploads: 1 });
    hold.release();
    await page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(page);
    await expect(page.getByTestId("tab-first.py")).toBeVisible();
    await expect(page.getByTestId("tab-second.py")).toHaveCount(0);
  } finally {
    await closeAll(visitor);
  }
});

test("a narrow landing page has a real upload button, into the same path as a drop", async ({
  browser,
}) => {
  const visitor = await newUser(browser, "Narrow", { viewport: { width: 320, height: 640 } });
  try {
    const page = visitor.page;
    await page.goto("/");
    const button = page.getByTestId("start-upload");
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
    await page.getByTestId("start-upload-input").setInputFiles([
      { name: "picked.py", mimeType: "text/plain", buffer: Buffer.from("print('a')\r\n") },
      { name: "logo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]) },
    ]);
    await page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(page);
    await expect.poll(() => editorText(page)).toBe("print('a')");
    await expect(toastText(page, "logo.png (not a text file)")).toBeVisible();
  } finally {
    await closeAll(visitor);
  }
});

test("a wide landing page keeps the drop hint, with no upload button in the way", async ({
  browser,
}) => {
  const visitor = await newUser(browser, "Wide", { viewport: { width: 1280, height: 800 } });
  try {
    await visitor.page.goto("/");
    await expect(visitor.page.getByTestId("start-panel")).toContainText(
      "Drop files, a folder or a .zip here",
    );
    await expect(visitor.page.getByTestId("start-upload")).toHaveCount(0);
  } finally {
    await closeAll(visitor);
  }
});

test("a touch device gets the button, no folder picker, and wording that does not offer one", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "only Chromium emulates a touch-only device here");
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: "en-US",
    hasTouch: true,
    isMobile: true,
    viewport: { width: 1024, height: 768 },
    extraHTTPHeaders: { "X-Gachipad": "1" },
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("start-upload")).toBeVisible();
    await page.getByTestId("new-share").click();
    await waitForEditor(page);
    await page.getByTestId("upload-files").click();
    const dialog = page.getByRole("dialog", { name: "Upload files", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Choose files or a .zip");
    await expect(dialog.getByRole("button", { name: "Choose folder" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a second participant sees a dropped file", async ({ browser }) => {
  const owner = await newUser(browser, "Owner");
  const guest = await newUser(browser, "Guest");
  try {
    const id = await createShare(owner.page);
    await joinByLink(guest, id);
    await waitForEditor(guest.page);
    await dropFiles(owner.page, targets.tabs(owner.page), [
      { name: "shared.py", content: "print('both')\n" },
    ]);
    await expect(guest.page.getByTestId("tab-shared.py")).toBeVisible({ timeout: 15_000 });
    await guest.page.getByTestId("tab-shared.py").click();
    await expect.poll(() => editorText(guest.page)).toBe("print('both')");
  } finally {
    await closeAll(owner, guest);
  }
});

test("a file copied in a file manager is pasted as a file; ordinary text still pastes as text", async ({
  browser,
}) => {
  const owner = await newUser(browser, "Owner");
  try {
    await createShare(owner.page);
    const page = owner.page;
    await page.locator(".cm-content").click();
    await paste(
      page,
      ".cm-content",
      [{ name: "disk.txt", content: "from disk\n" }],
      [["text/plain", "disk.txt"]],
    );
    await expect(page.getByTestId("tab-disk.txt")).toBeVisible();
    await expect.poll(() => editorText(page)).toBe("from disk");

    await page.getByTestId("add-file").click();
    await page.getByTestId("file-name-input").fill("typed.txt");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tab-typed.txt")).toBeVisible();
    await page.locator(".cm-content").click();
    await paste(page, ".cm-content", [], [["text/plain", "plain words"]]);
    await expect.poll(() => editorText(page)).toBe("plain words");
    await expect(tabs(page)).toHaveCount(2);
  } finally {
    await closeAll(owner);
  }
});

test("the empty file says what you can do here, and the upload button is in the file bar at every width", async ({
  browser,
}) => {
  const desktop = await newUser(browser, "Desktop", { viewport: { width: 1280, height: 800 } });
  const narrow = await newUser(browser, "Narrow", { viewport: { width: 320, height: 640 } });
  try {
    await createShare(desktop.page);
    await expect(desktop.page.locator(".cm-placeholder")).toContainText("drop a file here");
    await createShare(narrow.page);
    const placeholder = narrow.page.locator(".cm-placeholder");
    await expect(placeholder).toContainText("upload button");
    await expect(placeholder).not.toContainText("drop");
    for (const user of [desktop, narrow]) {
      const upload = user.page.getByTestId("upload-files");
      await expect(upload).toBeVisible();
      const box = await upload.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= (user === narrow ? 320 : 1280)).toBe(true);
      await upload.click();
      await expect(user.page.getByTestId("upload-zone")).toBeVisible();
      await user.page.keyboard.press("Escape");
    }
    // Choosing a file from the dialog goes through the same import and the same summary.
    await narrow.page.getByTestId("upload-files").click();
    await narrow.page.getByTestId("upload-input").setInputFiles({
      name: "picked.py",
      mimeType: "text/plain",
      buffer: Buffer.from("print('picked')\n"),
    });
    await expect(narrow.page.getByTestId("tab-picked.py")).toBeVisible();
    await expect(toastText(narrow.page, "Added picked.py")).toBeVisible();
  } finally {
    await closeAll(desktop, narrow);
  }
});

for (const scheme of ["light", "dark"] as const) {
  for (const [label, viewport] of [
    ["desktop", { width: 1280, height: 800 }],
    ["320", { width: 320, height: 640 }],
  ] as const) {
    test(`screenshot: the overlay on a share, ${label}, ${scheme}`, async ({ browser }) => {
      const owner = await newUser(browser, "Shot", { colorScheme: scheme, viewport });
      try {
        await createShare(owner.page);
        const page = owner.page;
        await dropFiles(page, targets.editor(page), [
          { name: "main.py", content: "def main():\n    pass\n" },
        ]);
        await expect(page.getByTestId("tab-main.py")).toBeVisible();
        const transfer = await transferOf(page, [{ name: "next.py", content: "x" }]);
        await dragOver(page, targets.editor(page), transfer);
        await expect(overlay(page)).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/overlay-share-${label}-${scheme}.png` });
        await stopDrag(page);
        await transfer.dispose();
      } finally {
        await closeAll(owner);
      }
    });
  }
}
