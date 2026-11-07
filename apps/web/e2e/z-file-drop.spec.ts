import { expect, type JSHandle, type Locator, type Page, test } from "@playwright/test";
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
    await expect(overlay(page)).toHaveCount(0, { timeout: 5000 });
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
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "pasted.txt", { type: "text/plain" }));
      data.setData("text/plain", "pasted.txt");
      document
        .querySelector(".cm-content")
        ?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
    });
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
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["from disk\n"], "disk.txt", { type: "text/plain" }));
      data.setData("text/plain", "disk.txt");
      document
        .querySelector(".cm-content")
        ?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
    });
    await expect(page.getByTestId("tab-disk.txt")).toBeVisible();
    await expect.poll(() => editorText(page)).toBe("from disk");

    await page.getByTestId("add-file").click();
    await page.getByTestId("file-name-input").fill("typed.txt");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tab-typed.txt")).toBeVisible();
    await page.locator(".cm-content").click();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "plain words");
      document
        .querySelector(".cm-content")
        ?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
    });
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
