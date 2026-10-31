import { expect, test } from "@playwright/test";

test("run optimizer replays the run and files a proposal in the inbox", async ({ page }) => {
  // Pick a product with no listing proposal waiting, so the optimizer can run.
  await page.goto("/listings");
  const row = page.getByRole("row").filter({ hasNotText: "Proposal waiting" }).filter({ hasText: "Active" }).first();
  await row.getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Listing optimizer" })).toBeVisible();

  await page.getByRole("button", { name: "Run optimizer" }).click();
  const viewer = page.getByTestId("agent-run-viewer");
  await expect(viewer).toBeVisible();

  // Streams step by step: the first draft is in progress while later steps are still pending.
  await expect(viewer.locator('[data-step-kind="draft"]').first()).toHaveAttribute("data-state", "active");
  await expect(viewer.locator('[data-step-kind="awaiting_approval"]')).toHaveAttribute("data-state", "pending");
  await expect(viewer.locator('[data-step-kind="compliance_check"]')).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await expect(viewer.getByText("Score 71")).toBeVisible({ timeout: 20_000 });

  await viewer.getByRole("button", { name: "Skip" }).click();
  await expect(viewer.getByText("Score 88")).toBeVisible();
  await expect(page.getByText("Proposal added to the approval inbox")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run optimizer" })).toBeDisabled();

  await viewer.getByRole("link", { name: "Open in Approvals" }).click();
  await expect(page).toHaveURL(/\/approvals\?proposal=prop_/);
  const detail = page.getByTestId("proposal-detail");
  await expect(detail.getByText("2 review rounds took the draft from 71 to 88.")).toBeVisible();
  await expect(detail.getByTestId("ai-generated-badge").first()).toBeVisible();
});
