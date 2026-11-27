import { LISTING_REVIEW_TARGET, reviewListing, type Finding, type ListingReview } from "@app/agents";
import { MARKETPLACE_IDS, MARKETPLACE_LANGUAGES } from "@app/amazon";
import {
  checkLine,
  checkListingCompliance,
  factSheet,
  type AgentRun,
  type AgentRunStep,
  type ComplianceCheck,
  type ListingCopy,
  type ListingDraft,
  type ProposalStatus,
} from "@app/core";
import type { RunStep } from "./catalog-sync";
import type { NewListingDeps } from "./deps";
import { optimizeListing, type ListingOptimizerResult } from "./listing-optimizer";
import { bufferedGateway, recordStepless, violationCheck, type Generated } from "./model-steps";
import { productTypeSchema, seller } from "./new-listing";

/**
 * The listing optimizer as an Inngest workflow, on a run a member started from the product page
 * (DataSource.startListingOptimizer). Up to OPTIMIZE_LISTING_MAX_ROUNDS rounds of
 *
 *   optimizer   the listing writer rewrites the live listing from ProductFacts and the keywords,
 *               fixing the previous round's findings;
 *   rules check the compliance guard, the guardrails and the grounding of every claim, no LLM;
 *   reviewer    the listing reviewer scores the draft against the rubric, behind the compliance
 *               gate those checks decide, on a different model at temperature 0;
 *
 * until a review reaches LISTING_REVIEW_TARGET. Then the last draft is filed as a listing_update
 * Proposal, flagged "did not reach target" when no round got there. Every stage is appended to the
 * run as a step as it finishes, with the model calls behind it, so the AgentRunViewer plays the run
 * as it happens. Nothing here changes Amazon.
 */

export type OptimizeListingDeps = Pick<NewListingDeps, "dataSource" | "authorizations" | "amazon" | "productTypeSchema" | "llm" | "now">;

export type OptimizeListingRequest = { runId: string; productId: string };

export type OptimizeOutcome =
  | { outcome: "stopped"; runId: string; reason: string }
  /** Autonomy L0: the draft was only suggested. */
  | { outcome: "suggested"; runId: string; reachedTarget: boolean }
  | { outcome: "filed"; runId: string; proposalId: string; status: ProposalStatus; reachedTarget: boolean };

export const OPTIMIZE_LISTING_MAX_ROUNDS = 3;

/** Why a run the optimizer gave up on stopped, as a member reads it. */
export const OPTIMIZER_STOPPED = "The listing optimizer stopped unexpectedly before filing a draft. Nothing changed on Amazon.";

/** The product type's schema version, when the account is connected to Amazon and the listing is checked against it. */
type Reading = { productType: string; schemaVersion?: string };

type Round = { round: number; draft: ListingDraft; checks: ComplianceCheck[] };

type Review = Omit<ListingReview, "calls">;

/** The guardrail checks the compliance guard covers in full: Amazon's restricted terms and the product's prohibited claims. */
const GUARDED_PHRASE_CHECKS: ReadonlySet<string> = new Set(["prohibited_claims", "restricted_terms"]);

/** Optimizes a product's listing and files it for approval. */
export async function optimizeListingRun(deps: OptimizeListingDeps, { runId, productId }: OptimizeListingRequest, { run }: { run: RunStep }): Promise<OptimizeOutcome> {
  const read = await run("read the listing", () => readListing(deps, { runId, productId }));
  if ("finished" in read) return read.finished;

  let findings: Finding[] = [];
  let review: Review | undefined;
  for (let round = 1; round <= OPTIMIZE_LISTING_MAX_ROUNDS; round += 1) {
    const written = await run(`optimizer round ${round}`, () => writeDraft(deps, { runId, productId, read, round, findings }));
    const checked = await run(`rules check round ${round}`, () => checkDraft(deps, { runId, productId, read, round, findings, written }));
    const scored = await run(`reviewer round ${round}`, () => reviewDraft(deps, { runId, productId, read, checked }));
    review = await run(`record review round ${round}`, () => recordReview(deps, { runId, round, scored }));
    if (review.reachedTarget) break;
    findings = review.fixes;
  }
  if (!review) throw new Error("No round ran.");
  const reachedTarget = review.reachedTarget;

  const filed = await run("file for approval", async () => {
    const at = deps.now().toISOString();
    await deps.dataSource.appendAgentRunSteps({
      runId,
      steps: [
        {
          id: `${runId}_awaiting`,
          kind: "awaiting_approval",
          title: "Awaiting approval",
          text: reachedTarget
            ? "Created a listing update proposal. Nothing changes on Amazon until a member approves it."
            : `No draft reached ${LISTING_REVIEW_TARGET} in ${OPTIMIZE_LISTING_MAX_ROUNDS} rounds, so the last one is proposed flagged "did not reach target", for a member to judge. Nothing changes on Amazon until a member approves it.`,
          startedAt: at,
          finishedAt: at,
        },
      ],
    });
    const { proposal } = await deps.dataSource.completeAgentRun(runId);
    return proposal ? { proposalId: proposal.id, status: proposal.status } : undefined;
  });
  if (!filed) return { outcome: "suggested", runId, reachedTarget };
  return { outcome: "filed", runId, ...filed, reachedTarget };
}

/** The run, the product and its facts, and the limits the copy must keep to. Records what it read. */
async function readListing(deps: OptimizeListingDeps, { runId, productId }: OptimizeListingRequest): Promise<Reading | { finished: OptimizeOutcome }> {
  const at = deps.now().toISOString();
  const agentRun = await deps.dataSource.getAgentRun(runId);
  if (!agentRun || agentRun.agent !== "listing_writer" || agentRun.subject?.id !== productId) throw new Error("That listing optimizer run doesn't exist.");
  // A repeated request for a run that already finished.
  if (agentRun.status !== "running") return { finished: finishedOutcome(agentRun) };

  const { product, facts, live } = await listing(deps, productId);
  const account = await deps.dataSource.getSellerAccount(product.sellerAccountId);
  if (!account) throw new Error("That seller account no longer exists.");
  // The product type's schema tightens the limits and checks the copy as Amazon would, when Amazon can be asked.
  let schemaVersion: string | undefined;
  let source = "Amazon's limits for every product: this account isn't connected to Amazon, so its product type schema wasn't read.";
  if (await deps.authorizations.get(account.sellerId)) {
    const loaded = await productTypeSchema(deps, await seller(deps, account.id), product.category, undefined, "LISTING");
    schemaVersion = loaded.version;
    source = `the limits in Amazon's ${loaded.productType.displayName} (${product.category}) schema.`;
  }
  const keywords = facts.targetKeywords;
  const step: AgentRunStep = {
    id: `${runId}_read`,
    kind: "plan",
    agent: "listing_writer",
    title: "Read the listing",
    text: [
      `Reading ProductFacts: ${facts.material}, ${facts.color}, ${facts.features.length} features, ${facts.includedComponents.length} included items.`,
      keywords.length > 0 ? `Target keywords: ${keywords.join(", ")}.` : "No target keywords: the copy is judged on the facts alone.",
      facts.prohibitedClaims.length > 0 ? `Never claim: ${facts.prohibitedClaims.join(", ")}.` : "No product-specific prohibited claims; Amazon's still apply.",
      `The copy keeps to ${source}`,
      `Up to ${OPTIMIZE_LISTING_MAX_ROUNDS} rounds of draft, rules check and review, until the reviewer scores ${LISTING_REVIEW_TARGET} or more.`,
      "",
      "The live listing",
      copyText(live),
    ].join("\n"),
    changes: [],
    startedAt: at,
    finishedAt: deps.now().toISOString(),
  };
  await deps.dataSource.appendAgentRunSteps({ runId, steps: [step] });
  return { productType: product.category, ...(schemaVersion ? { schemaVersion } : {}) };
}

/** The listing optimizer: one call through the gateway, with the guard's verdict on what came back. Records nothing. */
async function writeDraft(
  deps: OptimizeListingDeps,
  { runId, productId, read, round, findings }: { runId: string; productId: string; read: Reading; round: number; findings: Finding[] },
): Promise<Generated<Omit<ListingOptimizerResult, "calls">>> {
  const startedAt = deps.now().toISOString();
  const { product, facts, live, marketplaceId, languageTag, schema } = await context(deps, productId, read);
  const { gateway, calls } = bufferedGateway(deps);
  try {
    const { calls: made, ...output } = await optimizeListing(gateway, {
      brand: product.brand,
      productType: read.productType,
      productTypeSchema: schema,
      facts,
      keywords: facts.targetKeywords,
      live,
      marketplaceId,
      languageTag,
      findings,
      stepId: `${runId}_draft${round}`,
    });
    return { output, calls: made, startedAt, finishedAt: deps.now().toISOString() };
  } catch (error) {
    await recordStepless(deps, runId, calls);
    throw error;
  }
}

/**
 * A round's rules check, no LLM: the compliance guard's verdict on the draft as it came back (title
 * policy, prohibited claims and, when it was read, the product type's schema), the guardrails a
 * proposal is held to, and the grounding of every claim. Records the draft and its checks, with the
 * model calls behind the draft, in one write.
 */
async function checkDraft(
  deps: OptimizeListingDeps,
  {
    runId,
    productId,
    read,
    round,
    findings,
    written,
  }: { runId: string; productId: string; read: Reading; round: number; findings: Finding[]; written: Generated<Omit<ListingOptimizerResult, "calls">> },
): Promise<Round> {
  const { facts } = await listing(deps, productId);
  const { draft, violations, grounding } = written.output;
  const checks: ComplianceCheck[] = [
    // The guard checks every phrase these two do, and the product's own, so they'd only say it twice.
    ...checkListingCompliance(draft.listing, facts).filter((check) => !GUARDED_PHRASE_CHECKS.has(check.id)),
    violationCheck("listing_policy", read.schemaVersion ? "Title policy, prohibited claims and the product type schema" : "Title policy and prohibited claims", violations),
    grounding.length > 0
      ? { id: "grounding", label: "Claims cite the facts", status: "fail", detail: grounding.map((problem) => problem.message).join(" ") }
      : { id: "grounding", label: "Claims cite the facts", status: "pass", detail: `${draft.claims.length} ${draft.claims.length === 1 ? "claim" : "claims"}, each citing a fact.` },
  ];

  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  await deps.dataSource.appendAgentRunSteps({
    runId,
    steps: [
      {
        id: `${runId}_draft${round}`,
        kind: "draft",
        agent: "listing_writer",
        round,
        title: round === 1 ? "Optimizer draft" : `Revised draft ${round}`,
        text: draftText(draft, findings),
        listing: draft.listing,
        startedAt: written.startedAt,
        finishedAt: written.finishedAt,
      },
      {
        id: `${runId}_checks${round}`,
        kind: "compliance_check",
        title: round === 1 ? "Rules check" : `Rules check round ${round}`,
        text: [
          `Running ${checks.length} checks on draft ${round}. No model is asked: these are rules.`,
          ...checks.map(checkLine),
          "",
          failed > 0
            ? `${failed} blocking: the compliance gate is shut, so this draft scores 0 until they're fixed.`
            : warned > 0
              ? `Nothing blocking; ${warned} ${warned === 1 ? "warning" : "warnings"} for the reviewer.`
              : "Every check passes.",
        ].join("\n"),
        checks,
        startedAt: written.finishedAt,
        finishedAt: deps.now().toISOString(),
      },
    ],
    llmCalls: written.calls,
  });
  return { round, draft, checks };
}

/** The listing reviewer on a round's draft and checks. Records nothing. */
async function reviewDraft(
  deps: OptimizeListingDeps,
  { runId, productId, read, checked }: { runId: string; productId: string; read: Reading; checked: Round },
): Promise<Generated<Review>> {
  const startedAt = deps.now().toISOString();
  const { product, facts } = await listing(deps, productId);
  const { gateway, calls } = bufferedGateway(deps);
  try {
    const { calls: made, ...output } = await reviewListing(gateway, {
      productType: read.productType,
      facts: factSheet(product.brand, facts),
      keywords: facts.targetKeywords,
      draft: checked.draft,
      checks: checked.checks,
      stepId: `${runId}_review${checked.round}`,
    });
    return { output, calls: made, startedAt, finishedAt: deps.now().toISOString() };
  } catch (error) {
    await recordStepless(deps, runId, calls);
    throw error;
  }
}

/** Records a review, with the model calls behind it, in one write. */
async function recordReview(deps: OptimizeListingDeps, { runId, round, scored }: { runId: string; round: number; scored: Generated<Review> }): Promise<Review> {
  const { output } = scored;
  await deps.dataSource.appendAgentRunSteps({
    runId,
    steps: [
      {
        id: `${runId}_review${round}`,
        kind: "review",
        agent: "listing_reviewer",
        round,
        title: `Reviewer round ${round}`,
        text: output.reachedTarget || round === OPTIMIZE_LISTING_MAX_ROUNDS ? output.report : `${output.report}\n\nSending the fix list back to the optimizer.`,
        scores: output.scores,
        overall: output.overall,
        findings: output.findings,
        summary: output.summary,
        target: output.target,
        gate: output.gate,
        startedAt: scored.startedAt,
        finishedAt: scored.finishedAt,
      },
    ],
    llmCalls: scored.calls,
  });
  return output;
}

/** What a finished run came to, for a request that arrives after it. */
function finishedOutcome(run: AgentRun): OptimizeOutcome {
  if (run.status === "failed" || run.status === "cancelled") return { outcome: "stopped", runId: run.id, reason: run.error ?? `The run was ${run.status}.` };
  const last = run.steps?.filter((step) => step.kind === "review").at(-1);
  const reachedTarget = last?.kind === "review" && last.target !== undefined && last.overall >= last.target;
  const [proposalId] = run.proposalIds;
  // The proposal's status at filing isn't on the run; a decision since then is the proposal's own business.
  return proposalId ? { outcome: "filed", runId: run.id, proposalId, status: "pending_approval", reachedTarget } : { outcome: "suggested", runId: run.id, reachedTarget };
}

async function listing(deps: Pick<OptimizeListingDeps, "dataSource">, productId: string) {
  const [product, facts, versions] = await Promise.all([
    deps.dataSource.getProduct(productId),
    deps.dataSource.getProductFacts(productId),
    deps.dataSource.listListingVersions(productId),
  ]);
  const live = versions.find((version) => version.status === "live");
  if (!product || !facts || !live) throw new Error("That product has no live listing to optimize.");
  const copy: ListingCopy = { title: live.title, bullets: live.bullets, description: live.description, backendKeywords: live.backendKeywords };
  return { product, facts, live: copy };
}

/**
 * Everything a draft works from. The schema stays out of step results (it can run to megabytes);
 * each step reads it again, from Amazon once per version, and only when the account is connected.
 */
async function context(deps: OptimizeListingDeps, productId: string, read: Reading) {
  const found = await listing(deps, productId);
  const account = await deps.dataSource.getSellerAccount(found.product.sellerAccountId);
  if (!account) throw new Error("That seller account no longer exists.");
  const schema = read.schemaVersion
    ? (await productTypeSchema(deps, await seller(deps, account.id), read.productType, read.schemaVersion, "LISTING")).schema
    : undefined;
  return { ...found, marketplaceId: MARKETPLACE_IDS[account.marketplace], languageTag: MARKETPLACE_LANGUAGES[account.marketplace], schema };
}

function draftText(draft: ListingDraft, findings: readonly Finding[]): string {
  return [
    findings.length > 0 ? `Fixing ${findings.length} ${findings.length === 1 ? "finding" : "findings"} from the reviewer:` : "Rewriting the live listing from ProductFacts and the keywords.",
    ...findings.map((finding) => `– ${finding.message}`),
    "",
    copyText(draft.listing),
    "",
    `${draft.changes.length} ${draft.changes.length === 1 ? "change" : "changes"} explained, ${draft.claims.length} ${draft.claims.length === 1 ? "claim" : "claims"} cited.`,
  ].join("\n");
}

function copyText(copy: ListingCopy): string {
  return ["Title", copy.title, "", "Bullets", ...copy.bullets.map((bullet) => `• ${bullet}`), "", "Description", copy.description, "", "Backend search terms", copy.backendKeywords || "(none)"].join("\n");
}
