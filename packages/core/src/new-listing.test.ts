import { describe, expect, it } from "vitest";
import { checkProposalCompliance, hasBlockingFailure } from "./compliance";
import {
  NewProductFactsSchema,
  ProductTypeSchema,
  newListingBriefProblem,
  newListingDiff,
  newListingName,
  parseNewListing,
  planNewListingAttributes,
  sellerAttributesSchema,
  type NewListingAttribute,
  type NewListingBrief,
  type NewProductFacts,
  type ProductType,
  type ProductTypeAttribute,
} from "./new-listing";

const attribute = (name: string, requirement: ProductTypeAttribute["requirement"], rest: Partial<ProductTypeAttribute> = {}): ProductTypeAttribute => ({
  name,
  label: name.replaceAll("_", " "),
  description: `About ${name}.`,
  requirement,
  multiple: false,
  draftable: false,
  ...rest,
});

const bottle: ProductType = ProductTypeSchema.parse({
  name: "BOTTLE",
  displayName: "Water Bottle",
  description: "Reusable bottles.",
  attributes: [
    attribute("item_name", "required", { draftable: true }),
    attribute("brand", "required", { fromFact: "brand" }),
    attribute("bullet_point", "required", { draftable: true, multiple: true }),
    attribute("main_product_image_locator", "required", { fromFact: "mainPhoto" }),
    attribute("country_of_origin", "required", { options: ["China", "Vietnam"] }),
    attribute("capacity", "required"),
    attribute("color", "recommended"),
    attribute("product_description", "recommended", { draftable: true }),
    attribute("generic_keyword", "recommended", { draftable: true }),
    attribute("other_product_image_locator", "recommended", { fromFact: "otherPhotos", multiple: true }),
    attribute("regulatory_compliance_certification", "recommended", { fromFact: "certifications", multiple: true }),
  ],
});

const facts: NewProductFacts = {
  brand: "Trailcraft",
  productName: "Insulated Water Bottle",
  materials: ["18/8 Stainless Steel"],
  dimensions: { lengthCm: 7.5, widthCm: 7.5, heightCm: 26 },
  certifications: [],
  photos: ["https://images.example.com/main.jpg"],
};
const brief: NewListingBrief = { productType: "BOTTLE", facts, attributes: { country_of_origin: "Vietnam", capacity: "750 ml" } };

describe("NewProductFactsSchema", () => {
  it("accepts a product with a brand, name, material, size and main photo", () => {
    expect(NewProductFactsSchema.safeParse(facts).success).toBe(true);
  });

  it("says what is missing in words a seller can act on", () => {
    const parsed = NewProductFactsSchema.safeParse({
      ...facts,
      brand: "  ",
      materials: [],
      dimensions: { lengthCm: 0, widthCm: Number.NaN, heightCm: 26 },
      photos: ["http://images.example.com/main.jpg"],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["brand", "Enter the brand."],
      ["materials", "Add at least one material."],
      ["dimensions.lengthCm", "The length must be above 0 cm."],
      ["dimensions.widthCm", "Enter the width in cm."],
      ["photos.0", "Use an https:// link to the image."],
    ]);
  });

  it("needs a main photo and allows nine at most", () => {
    expect(NewProductFactsSchema.safeParse({ ...facts, photos: [] }).error?.issues[0]?.message).toBe("Add the main photo.");
    const photos = Array.from({ length: 10 }, (_, i) => `https://images.example.com/${i}.jpg`);
    expect(NewProductFactsSchema.safeParse({ ...facts, photos }).success).toBe(false);
  });
});

describe("ProductTypeSchema", () => {
  it("needs the listing copy attributes", () => {
    const parsed = ProductTypeSchema.safeParse({ ...bottle, attributes: bottle.attributes.filter((candidate) => candidate.name !== "bullet_point") });
    expect(parsed.error?.issues[0]?.message).toBe("Every product type needs bullet_point");
  });

  it("keeps seller-entered attributes to one value", () => {
    const parsed = ProductTypeSchema.safeParse({ ...bottle, attributes: [...bottle.attributes, attribute("features", "recommended", { multiple: true })] });
    expect(parsed.success).toBe(false);
  });
});

describe("planNewListingAttributes", () => {
  it("fills attributes from facts, then the seller, and leaves the rest to the agent", () => {
    const plan = planNewListingAttributes(bottle, facts, { capacity: " 750 ml " });
    expect(Object.fromEntries(plan.map(({ attribute: { name }, status, value }) => [name, value === undefined ? status : [status, value]]))).toEqual({
      item_name: "agent",
      brand: ["facts", "Trailcraft"],
      bullet_point: "agent",
      main_product_image_locator: ["facts", "https://images.example.com/main.jpg"],
      // Required, and only the seller knows it.
      country_of_origin: "missing",
      capacity: ["seller", "750 ml"],
      color: "empty",
      product_description: "agent",
      generic_keyword: "agent",
      // A single photo has no others; no certifications leaves that empty too.
      other_product_image_locator: "empty",
      regulatory_compliance_certification: "empty",
    });
  });
});

describe("sellerAttributesSchema", () => {
  const schema = sellerAttributesSchema(bottle);

  it("requires the required ones and allows the recommended ones", () => {
    expect(schema.safeParse({ country_of_origin: "Vietnam", capacity: "750 ml" }).success).toBe(true);
    expect(schema.safeParse({ country_of_origin: "Vietnam", capacity: "750 ml", color: "Sage" }).success).toBe(true);
    expect(schema.safeParse({ country_of_origin: "Vietnam" }).error?.issues[0]).toMatchObject({ path: ["capacity"], message: "Enter the capacity." });
  });

  it("keeps enumerated values to Amazon's options and refuses other attributes", () => {
    expect(schema.safeParse({ country_of_origin: "Atlantis", capacity: "750 ml" }).error?.issues[0]?.message).toBe("Pick a country of origin.");
    expect(schema.safeParse({ ...brief.attributes, brand: "Other" }).success).toBe(false);
  });

  it("explains a brief that doesn't fit its product type", () => {
    expect(newListingBriefProblem(brief, bottle)).toBeUndefined();
    expect(newListingBriefProblem({ ...brief, attributes: { country_of_origin: "Vietnam" } }, bottle)).toBe("Enter the capacity.");
    expect(newListingBriefProblem({ ...brief, attributes: { ...brief.attributes, flavor: "Mint" } }, bottle)).toBe("Water Bottle has no attribute flavor.");
    expect(newListingBriefProblem({ ...brief, productType: "CANDLE" }, bottle)).toBe("The brief is for CANDLE, not BOTTLE.");
  });
});

describe("new_listing diffs", () => {
  const attributes: { name: string; attribute: NewListingAttribute }[] = [
    { name: "item_name", attribute: { value: "Trailcraft Insulated Water Bottle – 18/8 Stainless Steel, 750 ml", source: "agent" } },
    { name: "brand", attribute: { value: "Trailcraft", source: "facts" } },
    { name: "bullet_point", attribute: { value: ["MATERIALS – Made from 18/8 stainless steel.", "SIZE – Measures 7.5 × 7.5 × 26 cm."], source: "agent" } },
    { name: "capacity", attribute: { value: "750 ml", source: "seller" } },
  ];
  const diff = newListingDiff(brief, attributes);

  it("reads back the brief and every attribute", () => {
    const parsed = parseNewListing(diff);
    expect(parsed.brief).toEqual(brief);
    expect([...parsed.attributes.keys()]).toEqual(["item_name", "brand", "bullet_point", "capacity"]);
    expect(parsed.unreadable).toEqual([]);
    expect(parseNewListing([...diff, { path: "price", before: 10, after: 12 }]).unreadable).toHaveLength(1);
  });

  it("passes the listing copy checks, warning about too few photos", () => {
    const checks = checkProposalCompliance({ type: "new_listing", diff });
    expect(hasBlockingFailure(checks)).toBe(false);
    expect(checks.find((check) => check.id === "photos")).toMatchObject({ status: "warn" });
    expect(checks.map((check) => check.id)).not.toContain("prohibited_claims");
  });

  it("fails claims the seller has no certification for", () => {
    const claiming = newListingDiff(brief, [...attributes, { name: "product_description", attribute: { value: "BPA free and non-toxic.", source: "agent" } }]);
    expect(checkProposalCompliance({ type: "new_listing", diff: claiming }).find((check) => check.id === "unbacked_claims")).toMatchObject({
      status: "fail",
      detail: 'Says "BPA free", "non-toxic" without a matching certification in the product facts.',
    });

    const certified = newListingDiff({ ...brief, facts: { ...facts, certifications: ["BPA free (LFGB tested)", "Non-toxic"] } }, attributes);
    const certifiedClaims = certified.map((entry) => (entry.path === "attributes.item_name" ? { ...entry, after: { value: "BPA free and non-toxic bottle", source: "agent" } } : entry));
    expect(checkProposalCompliance({ type: "new_listing", diff: certifiedClaims }).find((check) => check.id === "unbacked_claims")?.status).toBe("pass");
  });

  it("fails a draft without its brief", () => {
    expect(checkProposalCompliance({ type: "new_listing", diff: diff.slice(1) })).toEqual([
      { id: "plan_lines", label: "Listing attributes", status: "fail", detail: "The draft has no brief." },
    ]);
  });
});

describe("newListingName", () => {
  it("doesn't repeat the brand", () => {
    expect(newListingName(facts)).toBe("Trailcraft Insulated Water Bottle");
    expect(newListingName({ brand: "Trailcraft", productName: "trailcraft Bottle" })).toBe("trailcraft Bottle");
  });
});
