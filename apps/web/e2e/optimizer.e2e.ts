import { expect, test } from "@playwright/test";

// The optimizeListing workflow runs in the server's process with the stand-in model (see
// playwright.config.ts), so this follows a real run: steps appear as the workflow writes them.
test("run optimizer follows the workflow's run as it happens and files a proposal in the inbox", async ({ page }) => {
  // Pick a product with no listing proposal waiting, so the optimizer can run.
  await page.goto("/listings");
  const row = page.getByRole("row").filter({ hasNotText: "Proposal waiting" }).filter({ hasText: "Active" }).first();
  await row.getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Listing optimizer" })).toBeVisible();

  await page.getByRole("button", { name: "Run optimizer" }).click();
  await expect(page.getByRole("button", { name: "Optimizer running" })).toBeDisabled();
  const viewer = page.getByTestId("agent-run-viewer");
  await expect(viewer.getByText("Running", { exact: true })).toBeVisible();

  // The workflow reads the listing first; the drafts and reviews arrive after it, one at a time.
  await expect(viewer.locator('[data-step-kind="plan"]')).toHaveAttribute("data-state", /active|done/, { timeout: 15_000 });
  await expect(viewer.locator('[data-step-kind="draft"]').first()).toBeVisible({ timeout: 15_000 });
  await expect(viewer.locator('[data-step-kind="review"]').first()).toBeAttached({ timeout: 15_000 });

  // The run finishes on its own; the panel stops following it once the proposal is filed.
  await expect(page.getByRole("button", { name: "Run optimizer" })).toBeDisabled({ timeout: 30_000 });
  const skip = viewer.getByRole("button", { name: "Skip" });
  if (await skip.isVisible()) await skip.click();
  await expect(viewer.locator('[data-step-kind="awaiting_approval"]')).toHaveAttribute("data-state", "done");
  await expect(page.getByText("Proposal added to the approval inbox")).toBeVisible();

  // Two rounds: the first draft's prohibited claim shuts the compliance gate, the revision passes the target.
  const reviews = viewer.locator('[data-step-kind="review"]');
  await expect(reviews).toHaveCount(2);
  await expect(reviews.nth(1)).toContainText(/Score (8[5-9]|9\d|100)/);
  // Every model call shows its prompt version, model, tokens and cost: the writer and a different reviewer model.
  const calls = viewer.getByTestId("llm-call");
  await expect(calls).toHaveCount(4);
  for (const call of await calls.all()) {
    for (const part of [/\.\w+ v\d+/, /claude-[\w-]+/, /[\d,.K]+ in · ~?[\d,.K]+ out/, /\$\d+\.\d+/]) await expect(call).toContainText(part);
  }
  await expect(calls.first()).toContainText("listing_writer.rewrite v2");
  await expect(calls.first()).toContainText("claude-opus-5-5");
  await expect(calls.nth(1)).toContainText("listing_reviewer.review v2");
  await expect(calls.nth(1)).toContainText("claude-sonnet-4-6");
  await expect(viewer.getByTestId("llm-usage")).toContainText("4 model calls");

  await viewer.getByRole("link", { name: "Open in Approvals" }).click();
  await expect(page).toHaveURL(/\/approvals\?proposal=prop_/);
  const detail = page.getByTestId("proposal-detail");
  await expect(detail.getByText(/^2 review rounds took the draft from \d+ to \d+\./)).toBeVisible();
  await expect(detail.getByText("/ target 85")).toBeVisible();
  await expect(detail.getByTestId("missed-target")).toHaveCount(0);
  await expect(detail.getByTestId("ai-generated-badge").first()).toBeVisible();
});
