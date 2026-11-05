import { expect, test } from "@playwright/test";

test("the New campaign wizard files a plan that lands in the inbox and opens as a tree", async ({ page }) => {
  await page.goto("/campaigns");
  await page.getByRole("link", { name: "New campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\/new$/);

  // Step 1: products from the catalog.
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  const products = page.getByTestId("catalog-product");
  const first = products.first();
  const title = (await first.locator("label").textContent())!;
  await first.getByRole("checkbox").click();
  await products.nth(1).getByRole("checkbox").click();
  await expect(page.getByText(/2 selected/)).toBeVisible();
  await continueButton.click();

  // Step 2: the goal, and a target ACoS that follows breakeven.
  await page.getByRole("radio", { name: /Launch/ }).check();
  await page.getByLabel("Selling price").fill("40");
  await page.getByLabel("Product cost").fill("10");
  await page.getByLabel("Fulfillment fee").fill("6");
  await page.getByLabel(/Referral fee/).fill("15");
  await expect(page.getByTestId("wizard-breakeven")).toHaveText("45.0%");
  // Launch bids 1.25× breakeven.
  await expect(page.getByLabel("Target ACoS (%)")).toHaveValue("56");
  await page.getByRole("radio", { name: /Grow/ }).check();
  await expect(page.getByLabel("Target ACoS (%)")).toHaveValue("45");
  await page.getByRole("radio", { name: /Launch/ }).check();
  await page.getByLabel(/Daily budget/).fill("80");
  await page.getByRole("button", { name: "Preview" }).click();

  // Step 3: the structure the strategist will build.
  const preview = page.getByTestId("new-campaign-tree");
  await expect(preview.getByTestId("new-campaign").first()).toContainText("Auto discovery");
  await expect(preview).toContainText(title);
  await expect(page.getByText("Bids within guardrails")).toBeVisible();

  // Submit: the strategist's run replays, then files the plan.
  await page.getByRole("button", { name: "Create plan" }).click();
  const viewer = page.getByTestId("agent-run-viewer");
  await expect(viewer).toContainText("Campaign strategist");
  await viewer.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("New campaign plan added to the approval inbox")).toBeVisible();

  // In the inbox, opened in the plan tree view.
  await page.getByRole("link", { name: "Review the plan in Approvals" }).click();
  await expect(page).toHaveURL(/\/approvals\?proposal=prop_/);
  await expect(page.getByRole("list", { name: "Proposals" }).getByRole("button", { name: /New campaigns for 2 products/ })).toBeVisible();
  const detail = page.getByTestId("proposal-detail");
  await expect(detail.getByText("New campaign", { exact: true })).toBeVisible();
  await expect(detail.getByTestId("ai-generated-badge").first()).toBeVisible();
  const tree = detail.getByTestId("new-campaign-tree");
  await expect(tree).toContainText(title);
  await expect(tree.getByTestId("new-campaign").first()).toContainText("$");
  await expect(tree.getByTestId("new-ad-group").first()).toBeVisible();
});
