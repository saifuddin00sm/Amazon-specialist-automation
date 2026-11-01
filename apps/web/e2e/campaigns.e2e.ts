import { expect, test } from "@playwright/test";

test("a campaign plan from the optimizer is approved from the inbox like a listing", async ({ page }) => {
  // The list: spend, sales, ACoS and a trend for each campaign of the selected account.
  await page.goto("/campaigns");
  const row = page.getByRole("row").filter({ hasText: "SP Keywords" }).filter({ hasNotText: "Plan waiting" }).first();
  await expect(row.getByRole("img")).toBeVisible();
  await expect(row).toContainText("%");
  await row.getByRole("link").click();

  // The plan view: the campaign tree and the breakeven calculator.
  await expect(page.getByRole("heading", { name: "Campaign optimizer", exact: true })).toBeVisible();
  await expect(page.getByTestId("ad-group").first()).toBeVisible();
  await page.getByLabel("Selling price").fill("40");
  await page.getByLabel("Product cost").fill("10");
  await page.getByLabel("Fulfillment fee").fill("6");
  await page.getByLabel(/Referral fee/).fill("15");
  await expect(page.getByTestId("breakeven-acos")).toHaveText("45.0%");

  // Run the optimizer and let it file its plan.
  await page.getByRole("button", { name: "Run optimizer" }).click();
  const viewer = page.getByTestId("agent-run-viewer");
  await expect(viewer.locator('[data-step-kind="plan"]').first()).toHaveAttribute("data-state", "active");
  await viewer.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Campaign plan added to the approval inbox")).toBeVisible();
  await expect(page.getByTestId("plan-suggestions")).toBeVisible();
  await expect(page.locator('[data-suggestion="bid"], [data-suggestion="keyword"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run optimizer" })).toBeDisabled();

  // Decide it in the inbox: skip one line, approve the rest.
  await viewer.getByRole("link", { name: "Open in Approvals" }).click();
  await expect(page).toHaveURL(/\/approvals\?proposal=prop_/);
  const detail = page.getByTestId("proposal-detail");
  await expect(detail.getByText("Campaign plan", { exact: true })).toBeVisible();
  await expect(detail.getByTestId("campaign-plan-diff")).toBeVisible();
  await expect(detail.getByTestId("ai-generated-badge").first()).toBeVisible();

  await detail.getByRole("button", { name: /Approve with edits/ }).click();
  const editor = page.getByTestId("proposal-editor");
  await editor.getByRole("checkbox").first().click();
  await expect(editor.locator('[data-skipped="true"]')).toHaveCount(1);
  await detail.getByRole("button", { name: "Approve with edits" }).click();
  await expect(page.getByText("Approved with edits 1 proposal")).toBeVisible();
});
