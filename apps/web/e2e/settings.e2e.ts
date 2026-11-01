import { expect, test, type Page } from "@playwright/test";

/** Settings forms are client components: wait for hydration before typing, or the input is lost. */
async function fillWhenReady(page: Page, label: string | RegExp, value: string) {
  await expect(async () => {
    await page.getByLabel(label, { exact: typeof label === "string" }).fill(value);
    await expect(page.getByLabel(label, { exact: typeof label === "string" })).toHaveValue(value, { timeout: 500 });
  }).toPass();
}

test("guardrails and autonomy persist", async ({ page }) => {
  await page.goto("/settings/guardrails");
  await fillWhenReady(page, "Bid cap", "4.5");
  await page.getByLabel("Daily budget cap").fill("750");
  await page.getByRole("button", { name: "Save guardrails" }).click();
  await expect(page.getByText(/Guardrails saved for/)).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Campaign plans autonomy").click();
  await page.getByRole("option", { name: "L0" }).click();
  await page.getByRole("button", { name: "Save autonomy" }).click();
  await expect(page.getByText(/Autonomy saved for/)).toBeVisible();

  // A fresh load reads both back from the data source.
  await page.reload();
  await expect(page.getByLabel("Campaign plans autonomy")).toContainText("L0");
  await page.goto("/settings/guardrails");
  await expect(page.getByLabel("Bid cap")).toHaveValue("4.5");
  await expect(page.getByLabel("Daily budget cap")).toHaveValue("750");
});

test("the kill switch pauses agents across the app until resumed", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Pause all agents" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause all agents" }).click();
  await expect(page.getByText("All agents paused")).toBeVisible();

  // Every page carries the banner, and no agent can be started.
  const banner = page.getByTestId("agents-paused-banner");
  await expect(banner).toBeVisible();
  for (const path of ["/dashboard", "/approvals", "/reports"]) {
    await page.goto(path);
    await expect(banner).toBeVisible();
  }
  await page.goto("/listings");
  await page.getByRole("row").filter({ hasText: "Active" }).first().getByRole("link").click();
  await expect(page.getByRole("button", { name: "Run optimizer" })).toBeDisabled();
  await expect(page.getByText(/Agents are paused in this workspace/).first()).toBeVisible();
  await page.goto("/campaigns");
  await page.getByRole("row").filter({ hasText: "SP Keywords" }).first().getByRole("link").click();
  await expect(page.getByRole("button", { name: "Run optimizer" })).toBeDisabled();

  await banner.getByRole("button", { name: "Resume agents" }).click();
  await expect(page.getByText("Agents resumed")).toBeVisible();
  await expect(banner).toBeHidden();
  await expect(page.getByRole("button", { name: "Run optimizer" })).toBeEnabled();
});

test("connect Amazon adds an account to the top bar", async ({ page }) => {
  await page.goto("/settings/connections");
  await expect(async () => {
    await page.getByRole("button", { name: "Connect Amazon" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByLabel("Account name").fill("Northlane DE");
  await page.getByLabel("Marketplace").click();
  await page.getByRole("option", { name: /Germany/ }).click();
  await page.getByRole("button", { name: "Continue to Amazon" }).click();
  await expect(page.getByTestId("amazon-consent")).toContainText("amazon.de");
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByText("Northlane DE is connected")).toBeVisible();
  await page.getByRole("button", { name: "Switch to it" }).click();

  await expect(page.getByTestId("connections")).toContainText("Northlane DE");
  await expect(page.getByRole("button", { name: /Switch seller account/ })).toContainText("Northlane DE");
});

test("owners invite, change and remove team members", async ({ page }) => {
  await page.goto("/settings/team");
  await expect(async () => {
    await page.getByRole("button", { name: "Invite member" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByLabel("Name").fill("Ida Berg");
  await page.getByLabel("Email").fill("ida.berg@example.com");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invited Ida Berg")).toBeVisible();
  const row = page.locator('[data-member="ida.berg@example.com"]');
  await expect(row).toContainText("Specialist");

  await row.getByRole("button", { name: "Edit Ida Berg" }).click();
  await page.getByLabel("Role").click();
  await page.getByRole("option", { name: "Viewer" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("Viewer");

  await row.getByRole("button", { name: "Remove Ida Berg" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);
});
