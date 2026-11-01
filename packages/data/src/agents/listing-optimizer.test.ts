import { AgentRunSchema, checkListingCompliance, hasBlockingFailure } from "@app/core";
import { describe, expect, it } from "vitest";
import { generateMockDataset } from "./generate";
import { planListingOptimizerRun } from "./listing-optimizer";
import { createMockDataSource } from "./mock-data-source";

const dataset = generateMockDataset();
const [merchant] = dataset.workspaces;
const owner = dataset.members.find((member) => member.workspaceId === merchant!.id && member.role === "owner")!;
const viewer = dataset.members.find((member) => member.workspaceId === merchant!.id && member.role === "viewer")!;
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

const setup = () => createMockDataSource(dataset, { now: () => new Date("2026-10-31T09:00:00.000Z") });

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

describe("listing optimizer runs", () => {
  it("starts a running run with a planned timeline and audits it", async () => {
    const source = setup();
    const run = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });

    expect(AgentRunSchema.safeParse(run).success).toBe(true);
    expect(run).toMatchObject({ status: "running", trigger: "manual", subject: { type: "product", id: product.id } });
    expect(await source.listAgentRuns({ workspaceId: merchant!.id, subjectId: product.id })).toEqual([run]);
    const [event] = await source.listAuditEvents({ workspaceId: merchant!.id, limit: 1 });
    expect(event).toMatchObject({ action: "agent_run.started", entity: { id: run.id }, metadata: { requestedBy: owner.id } });
  });

  it("files a pending proposal with a proposed version and review on completion", async () => {
    const source = setup();
    const run = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });
    const { run: finished, proposal } = await source.completeAgentRun(run.id);

    expect(finished).toMatchObject({ status: "succeeded", proposalIds: [proposal!.id] });
    expect(finished.steps?.at(-1)).toMatchObject({ kind: "awaiting_approval", proposalId: proposal!.id });
    expect(proposal).toMatchObject({
      type: "listing_update",
      status: "pending_approval",
      target: { type: "product", id: product.id },
      createdBy: { type: "agent", agent: "listing_writer", agentRunId: run.id },
      scores: { rubric: 88 },
    });

    const review = await source.getReview(proposal!.reviewId!);
    expect(review).toMatchObject({ overall: 88, reviewer: { agent: "listing_reviewer" } });
    const [newest] = await source.listListingVersions(product.id);
    expect(newest).toMatchObject({ id: review!.listingVersionId, status: "proposed" });
    // The live listing is untouched until someone approves.
    expect((await source.listListingVersions(product.id)).find((version) => version.status === "live")).toEqual(live);

    const pending = await source.listProposals({ workspaceId: merchant!.id, status: "pending_approval" });
    expect(pending[0]?.id).toBe(proposal!.id);
    const events = await source.listAuditEvents({ workspaceId: merchant!.id, limit: 2 });
    expect(events.map((event) => event.action).sort()).toEqual(["agent_run.finished", "proposal.created"]);

    // Completing again is a no-op that returns the same result.
    expect(await source.completeAgentRun(run.id)).toEqual({ run: finished, proposal });
  });

  it("refuses viewers, a second run in flight, and products with a proposal waiting", async () => {
    const source = setup();
    await expect(source.startListingOptimizer({ productId: product.id, memberId: viewer.id })).rejects.toMatchObject({ code: "forbidden" });

    const run = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });
    await expect(source.startListingOptimizer({ productId: product.id, memberId: owner.id })).rejects.toMatchObject({ code: "conflict" });
    await source.completeAgentRun(run.id);
    await expect(source.startListingOptimizer({ productId: product.id, memberId: owner.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(source.completeAgentRun("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});
