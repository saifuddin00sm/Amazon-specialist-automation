import { describe, expect, it } from "vitest";
import type { ProductFacts } from "./catalog";
import type { ListingCopy } from "./compliance";
import { ListingDraftSchema, changedListingPaths, checkDraftGrounding, factSheet, type ListingDraft } from "./listing-draft";

const facts: ProductFacts = {
  productId: "prd_1",
  material: "18/8 stainless steel",
  color: "Sage Green",
  dimensions: { lengthCm: 9.5, widthCm: 9.5, heightCm: 27 },
  weightGrams: 480,
  includedComponents: ["1 x bottle", "1 x straw lid"],
  features: ["Keeps drinks cold for 24 hours.", "Holds 32 oz."],
  prohibitedClaims: ["BPA free"],
  targetKeywords: ["insulated water bottle"],
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const sheet = factSheet("Northlane", facts);

const live: ListingCopy = {
  title: "Northlane Water Bottle",
  bullets: ["Keeps drinks cold.", "Holds 32 oz."],
  description: "A bottle.",
  backendKeywords: "flask",
};

const draft: ListingDraft = {
  listing: {
    title: "Northlane Insulated Water Bottle, 18/8 Stainless Steel, Sage Green",
    bullets: ["COLD FOR A DAY – Keeps drinks cold for 24 hours.", "Holds 32 oz."],
    description: "Double-wall 18/8 stainless steel. In the box: 1 x bottle, 1 x straw lid.",
    backendKeywords: "flask",
  },
  changes: [
    { path: "title", reason: "Leads with the main keyword." },
    { path: "bullets.0", reason: "Says how long drinks stay cold." },
    { path: "description", reason: "Covers the material and what's in the box." },
  ],
  claims: [
    { path: "title", text: "18/8 Stainless Steel", facts: ["material"] },
    { path: "bullets.0", text: "keeps drinks cold for 24 hours", facts: ["features.0"] },
    { path: "bullets.1", text: "Holds 32 oz", facts: ["features.1"] },
    { path: "description", text: "In the box: 1 x bottle, 1 x straw lid", facts: ["includedComponents.0", "includedComponents.1"] },
  ],
};

describe("factSheet", () => {
  it("gives every fact a ref, leaving out prohibited claims and keywords", () => {
    expect(sheet.map((entry) => entry.ref)).toEqual([
      "brand",
      "material",
      "color",
      "dimensions",
      "weight",
      "features.0",
      "features.1",
      "includedComponents.0",
      "includedComponents.1",
    ]);
    expect(sheet.find((entry) => entry.ref === "dimensions")?.fact).toBe("9.5 × 9.5 × 27 cm");
    expect(JSON.stringify(sheet)).not.toContain("BPA");
  });
});

describe("changedListingPaths", () => {
  it("lists changed fields and bullets in listing order, counting added and dropped bullets", () => {
    expect(changedListingPaths(live, draft.listing)).toEqual(["title", "bullets.0", "description"]);
    expect(changedListingPaths(live, { ...live, bullets: ["Keeps drinks cold."] })).toEqual(["bullets.1"]);
    expect(changedListingPaths(live, live)).toEqual([]);
  });
});

describe("checkDraftGrounding", () => {
  it("passes a draft that explains every change and cites a fact for every claim", () => {
    expect(ListingDraftSchema.parse(draft)).toEqual(draft);
    expect(checkDraftGrounding(draft, live, sheet)).toEqual([]);
  });

  it("finds a change without a reason and a reason without a change", () => {
    const problems = checkDraftGrounding({ ...draft, changes: [...draft.changes.slice(1), { path: "backendKeywords", reason: "More terms." }] }, live, sheet);
    expect(problems.map(({ kind, path }) => [kind, path])).toEqual([
      ["missing_reason", "title"],
      ["reason_for_unchanged", "backendKeywords"],
    ]);
  });

  it("finds a claim citing a fact the sheet doesn't have, or quoting words the copy doesn't contain", () => {
    const claims = [...draft.claims.slice(0, 3), { path: "description" as const, text: "BPA free", facts: ["certifications.0"] }];
    expect(checkDraftGrounding({ ...draft, claims }, live, sheet).map(({ kind, path }) => [kind, path])).toEqual([
      ["unknown_fact", "description"],
      ["claim_not_in_copy", "description"],
    ]);
  });

  it("finds a bullet or description that cites nothing", () => {
    const claims = draft.claims.filter((claim) => claim.path === "title" || claim.path === "bullets.0");
    expect(checkDraftGrounding({ ...draft, claims }, live, sheet).map(({ kind, path }) => [kind, path])).toEqual([
      ["uncited", "bullets.1"],
      ["uncited", "description"],
    ]);
  });
});
