import { describe, expect, it } from "vitest";
import type { ProductFacts } from "./catalog";
import { checkListingCompliance, checkProposalCompliance, hasBlockingFailure, proposedListingCopy, type ListingCopy } from "./compliance";
import { freshnessAgeHours, isStale } from "./freshness";
import { canDecideProposal } from "./permissions";
import { applyDiffEdits, type DiffEntry } from "./proposal";
import type { Member } from "./workspace";

const live: ListingCopy = {
  title: "Northlane Insulated Water Bottle for Gym – Stainless Steel, Sage Green",
  bullets: ["A", "B", "C", "D", "E"].map((letter) => `FEATURE ${letter} – A plain sentence about it.`),
  description: "Meet the bottle.",
  backendKeywords: "insulated bottle gym",
};

const facts: ProductFacts = {
  productId: "prod_1",
  material: "Stainless Steel",
  color: "Sage Green",
  dimensions: { lengthCm: 8, widthCm: 8, heightCm: 26 },
  weightGrams: 380,
  includedComponents: ["Lid"],
  features: ["Keeps drinks cold for 24 hours"],
  prohibitedClaims: ["BPA free", "FDA approved"],
  targetKeywords: ["insulated bottle"],
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const statusOf = (checks: ReturnType<typeof checkListingCompliance>, id: string) => checks.find((check) => check.id === id)?.status;

describe("checkListingCompliance", () => {
  it("passes clean copy", () => {
    const checks = checkListingCompliance(live, facts);
    expect(hasBlockingFailure(checks)).toBe(false);
    expect(checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("fails prohibited claims from ProductFacts, case-insensitively", () => {
    const checks = checkListingCompliance({ ...live, bullets: [...live.bullets.slice(0, 4), "SAFE – bpa free plastic."] }, facts);
    expect(statusOf(checks, "prohibited_claims")).toBe("fail");
    expect(checks.find((check) => check.id === "prohibited_claims")?.detail).toContain("bullets");
  });

  it("fails restricted terms on word boundaries only", () => {
    expect(statusOf(checkListingCompliance({ ...live, title: `${live.title} #1 Best Seller` }, facts), "restricted_terms")).toBe("fail");
    expect(statusOf(checkListingCompliance({ ...live, description: "Great for wholesale buyers." }, facts), "restricted_terms")).toBe("pass");
  });

  it("enforces Amazon limits", () => {
    expect(statusOf(checkListingCompliance({ ...live, title: "x".repeat(201) }, facts), "title_length")).toBe("fail");
    expect(statusOf(checkListingCompliance({ ...live, title: "Bottle!" }, facts), "title_characters")).toBe("fail");
    expect(statusOf(checkListingCompliance({ ...live, bullets: [...live.bullets, "F"] }, facts), "bullets")).toBe("fail");
    expect(statusOf(checkListingCompliance({ ...live, bullets: ["Only one"] }, facts), "bullets")).toBe("warn");
    expect(statusOf(checkListingCompliance({ ...live, backendKeywords: "é".repeat(125) }, facts), "backend_keywords")).toBe("fail");
  });

  it("warns when there are no ProductFacts to check claims against", () => {
    expect(statusOf(checkListingCompliance(live, undefined), "prohibited_claims")).toBe("warn");
  });
});

describe("checkProposalCompliance", () => {
  it("checks the full proposed listing, not only the changed fields", () => {
    const diff: DiffEntry[] = [{ path: "title", before: live.title, after: "New title, FDA approved" }];
    expect(proposedListingCopy(live, diff).bullets).toEqual(live.bullets);
    expect(hasBlockingFailure(checkProposalCompliance({ type: "listing_update", diff, liveListing: live, facts }))).toBe(true);
  });

  it("applies bid and budget guardrails", () => {
    const bid = (after: number) => checkProposalCompliance({ type: "bid_change", diff: [{ path: "bid", before: 1, after }] });
    expect(hasBlockingFailure(bid(0.9))).toBe(false);
    expect(bid(1.8).find((check) => check.id === "bid_step")?.status).toBe("warn");
    expect(hasBlockingFailure(bid(0.01))).toBe(true);
    const budget = checkProposalCompliance({ type: "budget_change", diff: [{ path: "dailyBudget", before: 20, after: 50 }] });
    expect(budget.find((check) => check.id === "budget_step")?.status).toBe("warn");
  });

  it("checks only the newly negated keywords", () => {
    const checks = checkProposalCompliance({ type: "keyword_negate", diff: [{ path: "negativeKeywords", before: ["free"], after: ["free", "bottle cheap"] }] });
    expect(checks).toEqual([{ id: "keyword_format", label: "Keyword format", status: "pass" }]);
  });

  it("has no checks for pausing a target", () => {
    expect(checkProposalCompliance({ type: "target_pause", diff: [{ path: "state", before: "enabled", after: "paused" }] })).toEqual([]);
  });
});

describe("applyDiffEdits", () => {
  const diff: DiffEntry[] = [
    { path: "title", before: "Old", after: "New" },
    { path: "bullets", before: ["a"], after: ["b"] },
  ];

  it("replaces after values and keeps before values", () => {
    const result = applyDiffEdits(diff, [{ path: "title", after: "Edited" }]);
    expect(result).toEqual({ diff: [{ path: "title", before: "Old", after: "Edited" }, diff[1]] });
  });

  it("rejects unknown paths, duplicates and shape changes", () => {
    expect(applyDiffEdits(diff, [{ path: "price", after: 3 }])).toHaveProperty("error");
    expect(applyDiffEdits(diff, [{ path: "title", after: "a" }, { path: "title", after: "b" }])).toHaveProperty("error");
    expect(applyDiffEdits(diff, [{ path: "bullets", after: "not a list" }])).toHaveProperty("error");
  });
});

describe("freshness", () => {
  it("measures age at a point in time against per-source limits", () => {
    const entry = { source: "ad_metrics" as const, asOf: "2026-10-29T00:00:00.000Z" };
    expect(freshnessAgeHours(entry, "2026-10-30T12:00:00.000Z")).toBe(36);
    expect(isStale(entry, "2026-10-30T12:00:00.000Z")).toBe(false);
    expect(isStale(entry, "2026-10-30T13:00:00.000Z")).toBe(true);
  });
});

describe("canDecideProposal", () => {
  const member = (role: Member["role"], sellerAccountIds: string[] = []): Member => ({
    id: "mem_1",
    workspaceId: "ws_1",
    name: "Sam Lee",
    email: "sam@example.com",
    role,
    sellerAccountIds,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const proposal = { workspaceId: "ws_1", sellerAccountId: "sa_1" };

  it("lets editors decide and keeps viewers and other workspaces out", () => {
    expect(canDecideProposal(member("owner"), proposal)).toBe(true);
    expect(canDecideProposal(member("specialist"), proposal)).toBe(true);
    expect(canDecideProposal(member("viewer"), proposal)).toBe(false);
    expect(canDecideProposal(member("owner"), { ...proposal, workspaceId: "ws_2" })).toBe(false);
  });

  it("scopes client approvers to their accounts", () => {
    expect(canDecideProposal(member("client_approver", ["sa_1"]), proposal)).toBe(true);
    expect(canDecideProposal(member("client_approver", ["sa_2"]), proposal)).toBe(false);
  });
});
