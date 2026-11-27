import { createStandInProvider, standInRewrite } from "@app/agents";
import { AgentRunSchema, missedRubricTarget, type AgentRun } from "@app/core";
import { createMockDataSource, generateMockDataset, type AmazonAuthorizationStore } from "@app/data";
import { PROMPTS, type CompletionRequest, type LlmProvider, type PromptInput, type PromptOutput } from "@app/llm";
import { describe, expect, it } from "vitest";
import type { RunStep } from "./catalog-sync";
import { OPTIMIZE_LISTING_MAX_ROUNDS, optimizeListingRun, type OptimizeListingDeps } from "./optimize-listing";

const dataset = generateMockDataset();
const [merchant] = dataset.workspaces;
const owner = dataset.members.find((member) => member.workspaceId === merchant!.id && member.role === "owner")!;
const account = dataset.sellerAccounts.find((candidate) => candidate.workspaceId === merchant!.id)!;
// An active product with a live listing, a prohibited claim for the stand-in's first draft to trip on, and no proposal waiting.
const product = dataset.products.find(
  (candidate) =>
    candidate.sellerAccountId === account.id &&
    candidate.status === "active" &&
    dataset.listingVersions.some((version) => version.productId === candidate.id && version.status === "live") &&
    (dataset.productFacts.find((facts) => facts.productId === candidate.id)?.prohibitedClaims.length ?? 0) > 0 &&
    !dataset.proposals.some((proposal) => proposal.target.id === candidate.id && proposal.status === "pending_approval"),
)!;

/** Not connected to Amazon: the copy keeps to Amazon's limits for every product, and Amazon is never called. */
const NOT_CONNECTED: AmazonAuthorizationStore = { get: async () => undefined, set: async () => {}, sellerIds: async () => [] };

/** A provider whose writer is the stand-in's and whose reviewer scores every draft `scores`. */
function strictReviewer(scores: PromptOutput<typeof PROMPTS.listingReview>["scores"]) {
  const requests: CompletionRequest[] = [];
  const provider: LlmProvider = {
    name: "anthropic",
    dataPolicy: { trainsOnInputs: false, basis: "test" },
    complete: async (request) => {
      requests.push(request);
      const answer =
        request.prompt.task === "listing_rewrite"
          ? standInRewrite(request.prompt.input as PromptInput<typeof PROMPTS.listingRewrite>)
          : { scores, summary: "Readable, but the copy undersells the product.", findings: [{ criterion: "conversion_copy", severity: "warning", message: "Lead every bullet with the benefit." }] };
      return { model: request.model, text: JSON.stringify(answer), stopReason: "end", usage: { inputTokens: 1_500, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    },
  };
  return { provider, requests };
}

async function setup(provider: LlmProvider = createStandInProvider()) {
  let clock = Date.parse("2026-11-26T09:00:00.000Z");
  const now = () => new Date((clock += 1_000));
  const dataSource = createMockDataSource(dataset, { now });
  const deps: OptimizeListingDeps = {
    dataSource,
    authorizations: NOT_CONNECTED,
    amazon: () => {
      throw new Error("Amazon isn't called for an account that isn't connected.");
    },
    productTypeSchema: async () => {
      throw new Error("No schema is read for an account that isn't connected.");
    },
    llm: () => provider,
    now,
  };
  // Like Inngest: each step's result is kept as JSON and handed back from it.
  const steps: string[] = [];
  const run: RunStep = async (name, fn) => {
    steps.push(name);
    const result = await fn();
    return result === undefined ? result : JSON.parse(JSON.stringify(result));
  };
  const started = await dataSource.startListingOptimizer({ productId: product.id, memberId: owner.id });
  const optimize = () => optimizeListingRun(deps, { runId: started.id, productId: product.id }, { run });
  const runOf = async () => (await dataSource.getAgentRun(started.id)) as AgentRun;
  return { dataSource, steps, optimize, runOf, runId: started.id };
}

describe("optimizeListing", () => {
  it("drafts, checks and reviews until the reviewer reaches the target, then files a proposal", async () => {
    const { dataSource, steps, optimize, runOf, runId } = await setup();
    const outcome = await optimize();

    expect(outcome).toMatchObject({ outcome: "filed", runId, status: "pending_approval", reachedTarget: true });
    expect(steps).toEqual([
      "read the listing",
      "optimizer round 1",
      "rules check round 1",
      "reviewer round 1",
      "record review round 1",
      "optimizer round 2",
      "rules check round 2",
      "reviewer round 2",
      "record review round 2",
      "file for approval",
    ]);

    const run = await runOf();
    expect(AgentRunSchema.safeParse(run).success).toBe(true);
    expect(run.status).toBe("succeeded");
    expect(run.steps!.map((step) => [step.kind, step.title])).toEqual([
      ["plan", "Read the listing"],
      ["draft", "Optimizer draft"],
      ["compliance_check", "Rules check"],
      ["review", "Reviewer round 1"],
      ["draft", "Revised draft 2"],
      ["compliance_check", "Rules check round 2"],
      ["review", "Reviewer round 2"],
      ["awaiting_approval", "Awaiting approval"],
    ]);
    const [first, second] = run.steps!.filter((step) => step.kind === "review");
    // The first draft makes a prohibited claim: the rules check shuts the gate, so it scores 0 and the claim is first on the fix list.
    expect(first).toMatchObject({ overall: 0, target: 85, gate: { passed: false } });
    expect(first!.kind === "review" && first!.findings[0]).toMatchObject({ criterion: "compliance", severity: "error" });
    expect(second).toMatchObject({ gate: { passed: true }, target: 85 });
    expect(second!.kind === "review" && second!.overall).toBeGreaterThanOrEqual(85);
    // The revision was asked to fix what the reviewer found.
    const revision = run.steps!.find((step) => step.kind === "draft" && step.round === 2)!;
    expect(revision.text).toMatch(/^Fixing \d+ findings from the reviewer:/);

    // Each model call sits on its step: the writer on Opus, the reviewer on a different model at temperature 0.
    expect(run.llmCalls!.map((call) => [call.stepId, call.promptId, call.promptVersion, call.model])).toEqual([
      [`${runId}_draft1`, "listing_writer.rewrite", 2, "claude-opus-5-5"],
      [`${runId}_review1`, "listing_reviewer.review", 2, "claude-sonnet-4-6"],
      [`${runId}_draft2`, "listing_writer.rewrite", 2, "claude-opus-5-5"],
      [`${runId}_review2`, "listing_reviewer.review", 2, "claude-sonnet-4-6"],
    ]);
    expect(run.llmCalls!.every((call) => call.provider === "scripted" && call.costUsd > 0)).toBe(true);

    const proposal = (await dataSource.getProposal(outcome.outcome === "filed" ? outcome.proposalId : ""))!;
    expect(proposal).toMatchObject({ type: "listing_update", status: "pending_approval", target: { id: product.id }, title: `Rewrite listing for ${product.title}` });
    expect(proposal.rationale).toMatch(/^2 review rounds took the draft from 0 to \d+\./);
    expect(missedRubricTarget(proposal.scores)).toBe(false);
    expect(run.steps!.at(-1)).toMatchObject({ kind: "awaiting_approval", proposalId: proposal.id });
  });

  it("stops at three rounds and files the last draft flagged when the reviewer never reaches the target", async () => {
    const reviewer = strictReviewer({ keyword_coverage: 8, grounding: 9, conversion_copy: 6, title_structure: 8, attributes: 8, voice: 8 });
    const { dataSource, steps, optimize, runOf } = await setup(reviewer.provider);
    const outcome = await optimize();

    expect(outcome).toMatchObject({ outcome: "filed", status: "pending_approval", reachedTarget: false });
    expect(steps.filter((name) => name.startsWith("reviewer round"))).toHaveLength(OPTIMIZE_LISTING_MAX_ROUNDS);
    // Every round after the first gets the previous round's fix list.
    const rewrites = reviewer.requests.filter((request) => request.prompt.task === "listing_rewrite");
    expect(rewrites).toHaveLength(3);
    expect(rewrites[2]!.user).toContain("Lead every bullet with the benefit.");

    const run = await runOf();
    expect(run.steps!.filter((step) => step.kind === "review").map((step) => step.kind === "review" && step.overall)).toEqual([0, 78, 78]);
    expect(run.steps!.at(-1)!.text).toContain('did not reach target');
    const proposal = (await dataSource.getProposal(run.proposalIds[0]!))!;
    expect(proposal).toMatchObject({ title: `Rewrite listing for ${product.title} (did not reach target)`, scores: { rubric: 78, rubricTarget: 85 } });
    expect(missedRubricTarget(proposal.scores)).toBe(true);
  });

  it("does nothing more for a run that already finished", async () => {
    const { optimize, runOf } = await setup();
    const first = await optimize();
    const before = await runOf();
    expect(await optimize()).toEqual({ ...first, reachedTarget: true });
    expect(await runOf()).toEqual(before);
  });
});
