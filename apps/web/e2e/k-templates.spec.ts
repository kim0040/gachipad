import { expect, test } from "@playwright/test";
import { ADMIN_TOKEN } from "./env";
import { closeAll, editorText, newUser, shareIdOf, waitForEditor } from "./helpers";

const bearer = { Authorization: `Bearer ${ADMIN_TOKEN}` };

test("create a share from the Java template and see Main.java highlighted as Java", async ({
  browser,
}) => {
  const user = await newUser(browser, "Tpl");
  try {
    await user.page.goto("/");
    await user.page.getByTestId("new-from-template").click();
    const dialog = user.page.getByRole("dialog", { name: "Start from a template" });
    await expect(dialog).toBeVisible();

    // The search narrows the list, the preview lists the files of the active template.
    await dialog.getByTestId("template-search").fill("java");
    await expect(dialog.getByTestId("template-builtin-java")).toBeVisible();
    await expect(dialog.getByTestId("template-builtin-python")).toHaveCount(0);
    await expect(dialog.getByTestId("template-files")).toContainText("Main.java");
    await dialog.getByTestId("template-create").click();

    await user.page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(user.page);
    await expect(user.page.getByTestId("tab-Main.java")).toBeVisible();
    await expect.poll(() => editorText(user.page)).toContain("public class Main");
    await expect(user.page.getByTestId("language-button")).toContainText("Java");
    // Highlighted text is wrapped in token spans; plain text would be a bare text node.
    await expect(
      user.page.locator(".cm-line", { hasText: "public class Main" }).locator("span").first(),
    ).toBeVisible();
    expect(shareIdOf(user.page)).toMatch(/^[0-9A-Za-z]{8}$/);
  } finally {
    await closeAll(user);
  }
});

test("the picker works with the keyboard and from the command palette", async ({ browser }) => {
  const user = await newUser(browser, "Keys");
  try {
    await user.page.goto("/");
    // The shortcut is bound once the app has loaded.
    await expect(user.page.getByTestId("new-from-template")).toBeVisible();
    await user.page.keyboard.press("ControlOrMeta+k");
    const palette = user.page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await user.page.keyboard.type("template");
    await user.page.getByRole("option", { name: "New share from template" }).click();

    const picker = user.page.getByRole("dialog", { name: "Start from a template" });
    await expect(picker).toBeVisible();
    const search = picker.getByTestId("template-search");
    await expect(search).toBeFocused();
    await search.fill("python");
    // Arrow keys move the active template, Enter creates the share.
    await search.press("ArrowDown");
    await expect(picker.getByRole("option", { selected: true })).toContainText(
      "package with tests",
    );
    await search.press("ArrowUp");
    await expect(picker.getByRole("option", { selected: true })).toContainText("script");
    await search.press("Enter");
    await user.page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(user.page);
    await expect.poll(() => editorText(user.page)).toContain("def main()");
  } finally {
    await closeAll(user);
  }
});

test("a multi-file template creates every file", async ({ browser }) => {
  const user = await newUser(browser, "Multi");
  try {
    await user.page.goto("/");
    await user.page.getByTestId("new-from-template").click();
    const picker = user.page.getByRole("dialog", { name: "Start from a template" });
    await picker.getByTestId("template-search").fill("tests");
    await picker.getByTestId("template-builtin-python-package").click();
    await expect(picker.getByTestId("template-files")).toContainText("tests/test_ops.py");
    await picker.getByTestId("template-create").click();
    await user.page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(user.page);
    for (const name of ["__init__.py", "ops.py", "test_ops.py", "README.md"]) {
      await expect(user.page.getByRole("button", { name, exact: true }).first()).toBeVisible();
    }
  } finally {
    await closeAll(user);
  }
});

test("the picker shows an empty search result and fits 320px", async ({ browser }) => {
  const user = await newUser(browser, "Narrow", { viewport: { width: 320, height: 700 } });
  try {
    await user.page.goto("/");
    await user.page.getByTestId("new-from-template").click();
    const picker = user.page.getByRole("dialog", { name: "Start from a template" });
    await expect(picker.getByTestId("template-builtin-java")).toBeVisible();
    const overflow = await user.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await picker.getByTestId("template-search").fill("zzzz-nothing");
    await expect(picker.getByText(/No templates match/)).toBeVisible();
    await picker.getByRole("button", { name: "Clear search" }).click();
    await expect(picker.getByTestId("template-builtin-java")).toBeVisible();
  } finally {
    await closeAll(user);
  }
});

test("admin adds a template and sets the contact; both reach the picker and the intro footer", async ({
  browser,
}) => {
  const admin = await newUser(browser, "Admin");
  const visitor = await newUser(browser, "Visitor");
  const name = `Team service ${Date.now().toString(36)}`;
  try {
    await admin.page.goto("/admin");
    await admin.page.getByTestId("admin-token").fill(ADMIN_TOKEN);
    await admin.page.getByTestId("admin-login").click();
    // The console opens on the overview; templates and the contact are under Settings.
    await admin.page.getByRole("tab", { name: "Settings", exact: true }).click();
    const editor = admin.page.getByTestId("templates-editor");
    await expect(editor).toBeVisible();

    await editor.getByTestId("template-add").click();
    const dialog = admin.page.getByRole("dialog", { name: "Add template" });
    // Validation: the schema of the server runs in the browser first.
    await dialog.getByTestId("template-done").click();
    await expect(dialog.getByText("Enter a name of up to 60 characters.")).toBeVisible();
    await dialog.getByTestId("template-name").fill(name);
    await dialog.getByTestId("template-description").fill("Our service skeleton");
    await dialog.getByRole("combobox", { name: "Language" }).click();
    await admin.page.getByRole("option", { name: "Go", exact: true }).click();
    await dialog.getByTestId("template-file-path").fill("cmd/main.go");
    await dialog.getByTestId("template-file-content").fill("package main\n\nfunc main() {}\n");
    await dialog.getByTestId("template-add-file").click();
    await dialog.getByTestId("template-file-path").last().fill("../escape.go");
    await dialog.getByTestId("template-done").click();
    await expect(dialog.getByText(/Use a relative path/)).toBeVisible();
    await dialog.getByTestId("template-file-path").last().fill("README.md");
    await dialog.getByTestId("template-done").click();
    await expect(dialog).toBeHidden();
    await expect(editor.getByText(name)).toBeVisible();
    // Confirming the template only changes the draft; nothing is saved until Save.
    await expect(admin.page.getByText("Settings saved", { exact: true })).toHaveCount(0);

    await admin.page.getByLabel("Contact in the footer").fill("it-help@example.org");
    await admin.page.getByTestId("admin-save").click();
    await expect(admin.page.getByText("Settings saved", { exact: true })).toBeVisible();

    // The picker lists it after the built-in ones, in its own group.
    await visitor.page.goto("/");
    await expect(visitor.page.locator("footer")).toContainText("it-help@example.org");
    // With a contact set, GitHub is said to be for the software and the contact for this server.
    await expect(visitor.page.getByTestId("contribute-note")).toContainText(
      "GitHub is for the software itself",
    );
    await visitor.page.getByTestId("new-from-template").click();
    const picker = visitor.page.getByRole("dialog", { name: "Start from a template" });
    await picker.getByTestId("template-search").fill("service skeleton");
    const option = picker.getByRole("option", { name });
    await expect(option).toBeVisible();
    await expect(picker.getByText("Our templates")).toBeVisible();
    await option.click();
    await expect(picker.getByTestId("template-files")).toContainText("cmd/main.go");
    await picker.getByTestId("template-create").click();
    await visitor.page.waitForURL((url) => url.pathname !== "/");
    await waitForEditor(visitor.page);
    await expect.poll(() => editorText(visitor.page)).toContain("func main()");

    // Deleting asks first, and applies with the next save.
    await editor.getByRole("button", { name: `Delete template: ${name}` }).click();
    const confirm = admin.page.getByRole("dialog", { name: `Delete “${name}”?` });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(editor.getByText(name)).toBeVisible();
    await editor.getByRole("button", { name: `Delete template: ${name}` }).click();
    await admin.page.getByTestId("template-delete-confirm").click();
    await expect(editor.getByText(name)).toHaveCount(0);
    await admin.page.getByTestId("admin-save").click();
    const templates = await admin.context.request.get("/api/templates");
    expect(((await templates.json()) as { name: string }[]).some((t) => t.name === name)).toBe(
      false,
    );
  } finally {
    // Leave the shared stack as it was found: no contact, no templates.
    const current = await admin.context.request.get("/api/admin/settings", { headers: bearer });
    if (current.ok()) {
      await admin.context.request.put("/api/admin/settings", {
        headers: bearer,
        data: { ...((await current.json()) as object), contact: "", templates: [] },
      });
    }
    await closeAll(admin, visitor);
  }
});

test("the picker names its groups and the preview can be scrolled with the keyboard", async ({
  browser,
}) => {
  const user = await newUser(browser, "A11y");
  try {
    await user.page.goto("/");
    await user.page.getByTestId("new-from-template").click();
    const picker = user.page.getByRole("dialog", { name: "Start from a template" });
    const group = picker.getByRole("group", { name: "Built-in" });
    await expect(group).toBeVisible();
    await expect(group.getByTestId("template-builtin-java")).toBeVisible();

    await picker.getByTestId("template-builtin-java").click();
    const code = picker.getByTestId("template-preview").getByRole("region", { name: /Start of/ });
    await expect(code).toHaveAttribute("tabindex", "0");
    await code.focus();
    await expect(code).toBeFocused();
  } finally {
    await closeAll(user);
  }
});

test("admin: templates share one size limit, and a refused save shows the reason and keeps the edits", async ({
  browser,
}) => {
  // Nothing here is saved: the draft lives in the page and the one PUT is answered by the test, so the
  // settings other specs share on this stack stay as they are.
  const admin = await newUser(browser, "Limit");
  try {
    await admin.page.goto("/admin");
    await admin.page.getByTestId("admin-token").fill(ADMIN_TOKEN);
    await admin.page.getByTestId("admin-login").click();
    // The console opens on the overview; templates and the contact are under Settings.
    await admin.page.getByRole("tab", { name: "Settings", exact: true }).click();
    const editor = admin.page.getByTestId("templates-editor");
    await expect(editor).toBeVisible();

    const addTemplate = async (name: string, size: number) => {
      await editor.getByTestId("template-add").click();
      const dialog = admin.page.getByRole("dialog", { name: "Add template" });
      await dialog.getByTestId("template-name").fill(name);
      await dialog.getByTestId("template-file-content").fill("y".repeat(size));
      await dialog.getByTestId("template-done").click();
      return dialog;
    };
    await expect(await addTemplate("First", 1_500_000)).toBeHidden();
    await expect(editor.getByTestId("templates-total")).toContainText("used by all templates");

    const dialog = await addTemplate("Second", 1_000_000);
    await expect(dialog.getByText(/The templates together can have up to/)).toBeVisible();
    // Under the limit it goes through.
    await dialog.getByTestId("template-file-content").fill("y".repeat(1000));
    await dialog.getByTestId("template-done").click();
    await expect(dialog).toBeHidden();

    // The server refuses the save: its reason is shown, and the form still holds the edits.
    await admin.page.route("**/api/admin/settings", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      return route.fulfill({
        status: 413,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "too_large", message: "too large" } }),
      });
    });
    await admin.page.getByLabel("Contact in the footer").fill("keep-me@example.org");
    await admin.page.getByTestId("admin-save").click();
    await expect(admin.page.getByText("That's too large to save", { exact: true })).toBeVisible();
    await expect(admin.page.getByLabel("Contact in the footer")).toHaveValue("keep-me@example.org");
    await expect(editor.getByText("Second")).toBeVisible();
    await expect(admin.page.getByTestId("admin-save")).toBeEnabled();
  } finally {
    await closeAll(admin);
  }
});
