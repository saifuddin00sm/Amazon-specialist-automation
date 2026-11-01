import { checkListingCompliance, hasBlockingFailure } from "@app/core";
import { describe, expect, it } from "vitest";
import { generateMockDataset } from "../mock/generate";
import { planListingOptimizerRun } from "./listing-optimizer";

const dataset = generateMockDataset();
const [merchant] = dataset.workspaces;
const busy = new Set(
  dataset.proposals.filter((proposal) => proposal.status === "pending_approval").map((proposal) => proposal.target.id),
);
/** An active merchant product with a live listing and no listing proposal waiting. */
const product = dataset.products.find(
  (candidate) =>
    candidate.sellerAccountId === dataset.sellerAccounts.find((account) => account.workspaceId === merchant!.id)?.id &&
    candidate.status === "active" &&
    !busy.has(candidate.id) &&
    dataset.listingVersions.some((version) => version.productId === candidate.id && version.status === "live"),
)!;
const facts = dataset.productFacts.find((candidate) => candidate.productId === product.id)!;
const live = dataset.listingVersions.find((version) => version.productId === product.id && version.status === "live")!;

describe("planListingOptimizerRun", () => {
  const plan = planListingOptimizerRun({ runId: "run_x", product, facts, live, startedAt: Date.parse("2026-10-31T09:00:00.000Z") });

  it("lays out the six stages in order with back-to-back timings", () => {
    expect(plan.steps.map((step) => step.kind)).toEqual([
      "draft",
      "compliance_check",
      "review",
      "draft",
      "review",
      "awaiting_approval",
    ]);
    plan.steps.forEach((step, i) => {
      expect(step.finishedAt > step.startedAt).toBe(true);
      if (i > 0) expect(step.startedAt).toBe(plan.steps[i - 1]!.finishedAt);
      expect(step.text.length).toBeGreaterThan(0);
    });
  });

  it("catches draft 1's prohibited claim and clears it in the revision", () => {
    const [draft1, compliance, , draft2] = plan.steps;
    expect(draft1?.kind === "draft" && hasBlockingFailure(checkListingCompliance(draft1.listing, facts))).toBe(true);
    expect(compliance?.kind === "compliance_check" && hasBlockingFailure(compliance.checks)).toBe(true);
    expect(draft2?.kind === "draft" && hasBlockingFailure(checkListingCompliance(draft2.listing, facts))).toBe(false);
    expect(plan.final.bullets).toHaveLength(5);
  });

  it("scores round 1 below and round 2 above the bar, with a fix list", () => {
    const reviews = plan.steps.filter((step) => step.kind === "review");
    expect(reviews.map((review) => review.overall)).toEqual([71, 88]);
    expect(reviews[0]!.findings.length).toBeGreaterThanOrEqual(3);
    expect(reviews[0]!.text).toContain("Fix list");
  });
});
