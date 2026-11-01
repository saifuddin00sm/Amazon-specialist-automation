import { expect, test, type Page } from "@playwright/test";

/** Acts as a member through "View as" (mock mode). `pick` chooses among the matching menu items. */
async function viewAs(page: Page, role: "Specialist" | "Client approver" | null, pick: "first" | "last" = "first") {
  const trigger = page.getByTestId("view-as");
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 1000 });
  }).toPass();
  const items = page.getByRole("menuitem");
  const item = role === null ? items.filter({ hasText: "Owner view" }) : items.filter({ hasText: role });
  await (pick === "last" ? item.last() : item.first()).click();
  await expect(trigger).toContainText(role ?? "Owner view");
}

async function accountsInSwitcher(page: Page): Promise<number> {
  await page.getByRole("button", { name: "Switch seller account" }).click();
  const count = await page.getByRole("menu").getByRole("menuitem").count();
  await page.keyboard.press("Escape");
  return count;
}

const pendingCount = async (page: Page) => Number((await page.getByRole("tab", { name: /Pending/ }).textContent())?.match(/\d+/)?.[0]);

test("a client approver sees only their own account where a specialist sees every client", async ({ page }) => {
  await page.goto("/clients");

  // An agency specialist: every client, a cross-client queue.
  await viewAs(page, "Specialist", "last");
  await expect(page.getByTestId("client-list").locator("[data-client]")).toHaveCount(5);
  expect(await accountsInSwitcher(page)).toBe(5);
  await page.goto("/approvals");
  await expect(page.getByTestId("client-counts").getByRole("button")).toHaveCount(6);
  const specialistPending = await pendingCount(page);

  // The same agency as a client approver: one account, everywhere.
  await viewAs(page, "Client approver");
  await expect(page.getByTestId("client-counts")).toHaveCount(0);
  const clientPending = await pendingCount(page);
  expect(clientPending).toBeGreaterThan(0);
  expect(clientPending).toBeLessThan(specialistPending);
  const account = (await page.getByRole("button", { name: "Switch seller account" }).textContent())!.replace(/(US|CA|UK|DE)$/, "").trim();
  const items = page.getByRole("list", { name: "Proposals" }).getByRole("listitem");
  for (const text of await items.allTextContents()) expect(text).toContain(account);
  expect(await accountsInSwitcher(page)).toBe(1);
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.goto("/clients");
  await expect(page.getByTestId("client-list").locator("[data-client]")).toHaveCount(1);
  await expect(page.getByTestId("client-list")).toContainText(account);

  // Back to the owner view: both workspaces again.
  await viewAs(page, null);
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveCount(2);
});

test("Clients links into a cross-client queue filtered to one client", async ({ page }) => {
  await page.goto("/clients");
  await viewAs(page, "Specialist", "last");
  const row = page.getByTestId("client-list").locator("[data-client]").filter({ has: page.getByRole("link", { name: "Review" }) }).first();
  const name = (await row.getAttribute("data-client"))!;
  await row.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/approvals\?account=sa_/);
  await expect(page.getByTestId("client-counts").getByRole("button", { name: new RegExp(name) })).toHaveAttribute("aria-pressed", "true");
  for (const text of await page.getByRole("list", { name: "Proposals" }).getByRole("listitem").allTextContents()) expect(text).toContain(name);
});
