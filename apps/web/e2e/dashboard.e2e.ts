import { expect, test } from "@playwright/test";

test("dashboard follows the selected seller account and links into approvals", async ({ page }) => {
  await page.goto("/dashboard");
  const dashboard = page.getByTestId("dashboard");
  await expect(dashboard).toBeVisible();

  for (const title of ["Average listing score", "Pending approvals", "Ad spend", "ACoS"]) {
    await expect(dashboard.getByText(title, { exact: true }).first()).toBeVisible();
  }
  await expect(dashboard.getByText(/^Target \d+\.\d%$/)).toBeVisible();
  await expect(dashboard.getByText(/· Totals for \w{3} \d+ – \w{3} \d+/)).toBeVisible();
  await expect(dashboard.getByText("Sales and ad spend", { exact: true })).toBeVisible();
  await expect(page.getByTestId("agent-activity").getByTestId("ai-generated-badge").first()).toBeVisible();

  // Another account's dashboard replaces this one.
  const accountLine = dashboard.locator("p").first();
  const before = await accountLine.textContent();
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem").nth(1).click();
  await expect(accountLine).not.toHaveText(before ?? "");

  // An opportunity opens that proposal in the approval queue.
  const opportunity = page.getByTestId("top-opportunities").getByRole("link").first();
  const title = (await opportunity.locator("span.truncate").textContent()) ?? "";
  await opportunity.click();
  await expect(page).toHaveURL(/\/approvals\?proposal=prop_/);
  await expect(page.getByTestId("proposal-detail")).toHaveAttribute("aria-label", title);
});
