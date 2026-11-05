import { expect, test } from "@playwright/test";

test("the New listing wizard turns a blank form into an agent draft waiting in the inbox", async ({ page }) => {
  await page.goto("/listings");
  await page.getByRole("link", { name: "New listing" }).click();
  await expect(page).toHaveURL(/\/listings\/new$/);

  // Step 1: a blank form doesn't pass, and says what's missing.
  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.click();
  await expect(page.getByText("Enter the brand.")).toBeVisible();
  await expect(page.getByText("Add at least one material.")).toBeVisible();
  await expect(page.getByText("Add the main photo.")).toBeVisible();

  await page.getByLabel("Brand").fill("Trailcraft");
  await page.getByLabel("Product name").fill("Insulated Water Bottle");
  await page.getByLabel("Length (cm)").fill("7.5");
  await page.getByLabel("Width (cm)").fill("7.5");
  await page.getByLabel("Height (cm)").fill("26");
  const materials = page.getByRole("textbox", { name: /^Materials/ });
  await materials.fill("18/8 Stainless Steel");
  await materials.press("Enter");
  await materials.fill("Silicone");
  await page.getByRole("button", { name: "Add to materials" }).click();
  await expect(page.getByRole("list", { name: "Materials" }).getByRole("listitem")).toHaveCount(2);
  const certifications = page.getByRole("textbox", { name: /^Certifications/ });
  await certifications.fill("BPA free");
  await certifications.press("Enter");
  const photos = page.getByRole("textbox", { name: /^Photos/ });
  await photos.fill("http://images.example.com/bottle.jpg");
  await photos.press("Enter");
  await expect(page.getByText("Use an https:// link to the image.")).toBeVisible();
  await photos.fill("https://images.example.com/bottle.jpg");
  await photos.press("Enter");
  await expect(page.getByRole("list", { name: "Photos" })).toContainText("Main");
  await continueButton.click();

  // Step 2: search the product types and see the schema's attributes.
  await page.getByRole("textbox", { name: "Search product types" }).fill("water bottle");
  await page.getByRole("radio", { name: /Water Bottle/ }).check();
  const schema = page.getByTestId("product-type-attributes");
  await expect(schema.getByRole("list", { name: "required attributes" })).toContainText("Capacity");
  await expect(schema.getByRole("list", { name: "recommended attributes" })).toContainText("Description");
  await continueButton.click();

  // Step 3: what's filled, what the agent drafts, and what only the seller can fill.
  await expect(page.getByTestId("attribute-group-facts")).toContainText("Trailcraft");
  await expect(page.getByTestId("attribute-group-agent")).toContainText("Bullet points");
  const draftButton = page.getByRole("button", { name: "Draft listing" });
  await draftButton.click();
  await expect(page.getByText("Enter the capacity.")).toBeVisible();
  await expect(page.getByText("Pick a country of origin.")).toBeVisible();
  await page.getByLabel("Capacity").fill("750 ml");
  await page.getByLabel("Country of origin").click();
  await page.getByRole("option", { name: "Vietnam" }).click();
  await draftButton.click();

  // Submit: the listing creator's run replays, then files the draft.
  const viewer = page.getByTestId("agent-run-viewer");
  await expect(viewer).toContainText("Listing creator");
  await viewer.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("New listing draft added to the approval inbox")).toBeVisible();

  // In the inbox, with the agent's draft marked as AI generated.
  await page.getByRole("link", { name: "Review the draft in Approvals" }).click();
  await expect(page).toHaveURL(/\/approvals\?proposal=prop_/);
  await expect(page.getByRole("list", { name: "Proposals" }).getByRole("button", { name: /New listing: Trailcraft Insulated Water Bottle/ })).toBeVisible();
  const detail = page.getByTestId("proposal-detail");
  await expect(detail.getByText("New listing", { exact: true })).toBeVisible();
  const draft = detail.getByTestId("new-listing-draft");
  await expect(draft).toContainText("Trailcraft Insulated Water Bottle – 18/8 Stainless Steel and Silicone, 750 ml");
  await expect(draft).toContainText("CERTIFIED – BPA free.");
  await expect(draft.getByTestId("ai-generated-badge").first()).toBeVisible();
  await expect(draft.getByTestId("new-listing-attribute").filter({ hasText: "Capacity" })).toContainText("From seller");
});
