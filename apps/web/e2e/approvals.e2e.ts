import { expect, test, type Page } from "@playwright/test";

const list = (page: Page) => page.getByRole("list", { name: "Proposals" });
const detail = (page: Page) => page.getByTestId("proposal-detail");
const pendingTab = (page: Page) => page.getByRole("tab", { name: /Pending/ });
const pendingCount = async (page: Page) => Number((await pendingTab(page).textContent())?.match(/\d+/)?.[0]);

test.beforeEach(async ({ page }) => {
  await page.goto("/approvals");
  // Keyboard shortcuts attach on hydration.
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
});

test("shows the diff, review and freshness for the active proposal", async ({ page }) => {
  await expect(detail(page).getByTestId("ai-generated-badge").first()).toBeVisible();
  await expect(detail(page).getByRole("heading", { name: "Proposed changes" })).toBeVisible();
  await expect(detail(page).getByTestId("compliance-results")).toBeVisible();
  await expect(detail(page).getByRole("heading", { name: "Data freshness" })).toBeVisible();
});

test("j and k move through the queue", async ({ page }) => {
  const items = list(page).getByRole("listitem");
  await expect(items.first()).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("j");
  await expect(items.nth(1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("k");
  await expect(items.first()).toHaveAttribute("aria-current", "true");
});

test("a approves the active proposal", async ({ page }) => {
  // Start on a proposal compliance doesn't block.
  const ready = list(page).getByRole("listitem").filter({ hasNotText: "Blocked" }).first();
  const title = (await ready.getByRole("button").locator("span").first().textContent())!;
  await ready.getByRole("button").click();
  const before = await pendingCount(page);

  await page.keyboard.press("a");
  await expect(page.getByText("Approved 1 proposal")).toBeVisible();
  await expect(pendingTab(page)).toContainText(String(before - 1));
  await expect(list(page).getByText(title, { exact: true })).toHaveCount(0);
});

test("r rejects only with a reason", async ({ page }) => {
  // Leave blocked proposals for the edit flow below.
  await list(page).getByRole("listitem").filter({ hasNotText: "Blocked" }).last().getByRole("button").click();
  const before = await pendingCount(page);
  await page.keyboard.press("r");
  const reason = page.getByLabel(/Why reject/);
  await expect(reason).toBeFocused();
  await expect(reason).toHaveValue("");
  const submit = detail(page).getByRole("button", { name: "Reject", exact: true });
  await expect(submit).toBeDisabled();

  await reason.fill("Tone doesn't match the brand.");
  await submit.click();
  await expect(page.getByText("Rejected 1 proposal")).toBeVisible();
  await expect(pendingTab(page)).toContainText(String(before - 1));
});

test("a blocked listing is approved after editing out the prohibited claim", async ({ page }) => {
  const blocked = list(page).getByRole("listitem").filter({ hasText: "Blocked" }).first();
  test.skip((await blocked.count()) === 0, "No blocked proposal left in this workspace");
  await blocked.getByRole("button").click();
  await expect(detail(page).getByRole("button", { name: /^Approve/ }).first()).toBeDisabled();

  const failing = await detail(page).locator('[data-status="fail"]').first().textContent();
  const claim = failing?.match(/"([^"]+)"/)?.[1];
  expect(claim).toBeTruthy();

  await page.keyboard.press("e");
  await expect(page.getByTestId("proposal-editor")).toBeVisible();
  for (const field of await page.getByTestId("proposal-editor").locator("textarea, input").all()) {
    const value = await field.inputValue();
    if (value.toLowerCase().includes(claim!.toLowerCase())) {
      await field.fill(value.replace(new RegExp(claim!, "i"), "Built for everyday use"));
    }
  }

  await expect(page.getByTestId("compliance-results")).not.toContainText("blocking");
  await detail(page).getByRole("button", { name: "Approve with edits" }).click();
  await expect(page.getByText("Approved with edits 1 proposal")).toBeVisible();
});

test("bulk snooze moves proposals to the snoozed tab", async ({ page }) => {
  const items = list(page).getByRole("listitem");
  await items.nth(0).getByRole("checkbox").click();
  await items.nth(1).getByRole("checkbox").click();
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("button", { name: "Snooze selected" }).click();
  await page.getByRole("menuitem", { name: "Snooze 1 day" }).click();
  await expect(page.getByText("Snoozed 2 proposals")).toBeVisible();

  await page.getByRole("tab", { name: /Snoozed/ }).click();
  await expect(list(page).getByText(/Until /).first()).toBeVisible();
});
