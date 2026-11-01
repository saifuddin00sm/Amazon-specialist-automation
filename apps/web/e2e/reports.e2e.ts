import { expect, test } from "@playwright/test";

test("one click opens the report on its own and the print dialog", async ({ page, context }) => {
  // Count print dialogs instead of opening one.
  await context.addInitScript(() => {
    const counted = window as Window & { printCalls?: number };
    counted.printCalls = 0;
    window.print = () => {
      counted.printCalls = (counted.printCalls ?? 0) + 1;
    };
  });

  await page.goto("/reports");
  const preview = page.getByTestId("report-document");
  await expect(preview.getByText(/^Sales were /)).toBeVisible();
  await expect(preview.getByRole("img", { name: "Sales by day" })).toBeVisible();

  const [report] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "Print report" }).click()]);
  await expect(report).toHaveURL(/\/print\/reports\/sa_.+print=1/);
  await expect(report.getByTestId("report-document")).toBeVisible();
  await expect.poll(() => report.evaluate(() => (window as Window & { printCalls?: number }).printCalls)).toBe(1);
  await expect(report).toHaveTitle(/weekly report, /);

  // Clean: no app shell, and the toolbar doesn't print.
  await expect(report.getByText("Amazon specialist automation")).toHaveCount(0);
  await report.emulateMedia({ media: "print" });
  await expect(report.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
  await expect(report.getByTestId("report-header")).toBeVisible();
});

test("branding saved in settings heads the report", async ({ page }) => {
  await page.goto("/settings/branding");
  const header = page.getByTestId("report-header");
  // Retried: typing before hydration would be lost.
  await expect(async () => {
    await page.getByLabel("Name in the header").fill("Acme Growth Partners");
    await page.getByLabel("Header color", { exact: true }).fill("#0F3D3E");
    await expect(header).toContainText("Acme Growth Partners", { timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByText("Report branding saved")).toBeVisible();

  await page.goto("/reports");
  const reportHeader = page.getByTestId("report-document").getByTestId("report-header");
  await expect(reportHeader).toContainText("Acme Growth Partners");
  await expect(reportHeader).toHaveCSS("background-color", "rgb(15, 61, 62)");
  await expect(reportHeader).toHaveCSS("color", "rgb(255, 255, 255)");
});
