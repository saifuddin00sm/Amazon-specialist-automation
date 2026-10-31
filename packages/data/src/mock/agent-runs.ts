import {
  AgentRunSchema,
  ListingVersionSchema,
  ProposalSchema,
  ReviewSchema,
  canActOnAccount,
  type Actor,
  type AgentRun,
  type AuditEvent,
  type DiffEntry,
  type ListingVersion,
  type Member,
  type Product,
  type ProductFacts,
  type Proposal,
  type ProposalRisk,
  type Review,
  type SellerAccount,
} from "@app/core";
import { AgentRunError } from "../data-source";
import { planListingOptimizerRun } from "./listing-optimizer";

/** The parts of the mock's in-memory store that agent runs read. */
export type RunStore = {
  members: readonly Member[];
  sellerAccounts: readonly SellerAccount[];
  products: readonly Product[];
  productFacts: readonly ProductFacts[];
  listingVersions: readonly ListingVersion[];
  proposals: readonly Proposal[];
  agentRuns: readonly AgentRun[];
  liveListing: (productId: string) => ListingVersion | undefined;
  nextId: { run: () => string; listingVersion: () => string; review: () => string; proposal: () => string };
};

type AuditDraft = Omit<AuditEvent, "id">;

const LISTING_FIELDS = ["title", "bullets", "description", "backendKeywords"] as const;

/** Plans a listing optimizer run on a product and returns it running, with the audit event to record. */
export function startListingOptimizerRun(
  store: RunStore,
  { productId, memberId, at }: { productId: string; memberId: string; at: Date },
): { run: AgentRun; events: AuditDraft[] } {
  const product = store.products.find((candidate) => candidate.id === productId);
  const account = product && store.sellerAccounts.find((candidate) => candidate.id === product.sellerAccountId);
  const facts = store.productFacts.find((candidate) => candidate.productId === productId);
  const live = store.liveListing(productId);
  if (!product || !account || !facts || !live) throw new AgentRunError("not_found", "That product has no live listing to optimize.");

  const member = store.members.find((candidate) => candidate.id === memberId);
  if (!member || !canActOnAccount(member, { workspaceId: account.workspaceId, sellerAccountId: account.id })) {
    throw new AgentRunError("forbidden", "You don't have permission to run agents on this account.");
  }
  if (store.agentRuns.some((run) => run.subject?.id === productId && run.status === "running")) {
    throw new AgentRunError("conflict", "The optimizer is already running on this product.");
  }
  if (
    store.proposals.some(
      (proposal) => proposal.target.id === productId && proposal.type === "listing_update" && proposal.status === "pending_approval",
    )
  ) {
    throw new AgentRunError("conflict", "A listing proposal for this product is already waiting for approval.");
  }

  const id = store.nextId.run();
  const run = AgentRunSchema.parse({
    id,
    workspaceId: account.workspaceId,
    sellerAccountId: account.id,
    agent: "listing_writer",
    status: "running",
    autonomyLevel: account.autonomyLevel,
    trigger: "manual",
    subject: { type: "product", id: productId },
    summary: `Rewriting the listing for ${product.title}.`,
    proposalIds: [],
    steps: planListingOptimizerRun({ runId: id, product, facts, live, startedAt: at.getTime() }).steps,
    startedAt: at.toISOString(),
  });

  return {
    run,
    events: [
      {
        workspaceId: run.workspaceId,
        sellerAccountId: run.sellerAccountId,
        at: run.startedAt,
        actor: { type: "agent", agent: run.agent, agentRunId: run.id },
        action: "agent_run.started",
        entity: { type: "agent_run", id: run.id },
        metadata: { trigger: "manual", requestedBy: memberId },
      },
    ],
  };
}

/**
 * Files a running optimizer run's output: the revised draft as a proposed ListingVersion, the last
 * reviewer round as its Review, and a pending listing_update Proposal. Nothing goes live here.
 */
export function completeListingOptimizerRun(
  store: RunStore,
  run: AgentRun,
  at: string,
): { run: AgentRun; version: ListingVersion; review: Review; proposal: Proposal; events: AuditDraft[] } {
  if (run.agent !== "listing_writer" || run.subject?.type !== "product") {
    throw new AgentRunError("conflict", "Only listing optimizer runs can be completed here.");
  }
  const productId = run.subject.id;
  const product = store.products.find((candidate) => candidate.id === productId);
  const facts = store.productFacts.find((candidate) => candidate.productId === productId);
  const live = store.liveListing(productId);
  const finalDraft = run.steps?.filter((step) => step.kind === "draft").at(-1);
  const reviewRounds = run.steps?.filter((step) => step.kind === "review") ?? [];
  const finalReview = reviewRounds.at(-1);
  if (!product || !facts || !live || !finalDraft || !finalReview) {
    throw new AgentRunError("not_found", "The product this run worked on is no longer available.");
  }

  const writer: Actor = { type: "agent", agent: "listing_writer", agentRunId: run.id };
  const reviewer: Actor = { type: "agent", agent: "listing_reviewer", agentRunId: run.id };
  const versions = store.listingVersions.filter((candidate) => candidate.productId === productId);

  const version = ListingVersionSchema.parse({
    id: store.nextId.listingVersion(),
    productId,
    version: Math.max(0, ...versions.map((candidate) => candidate.version)) + 1,
    status: "proposed",
    ...finalDraft.listing,
    createdBy: writer,
    createdAt: at,
  });

  const review = ReviewSchema.parse({
    id: store.nextId.review(),
    listingVersionId: version.id,
    scores: finalReview.scores,
    overall: finalReview.overall,
    report: { summary: "Strong listing after one revision; ready to publish.", findings: finalReview.findings },
    reviewer,
    createdAt: at,
  });

  const diff: DiffEntry[] = LISTING_FIELDS.filter((field) => JSON.stringify(live[field]) !== JSON.stringify(version[field])).map(
    (field) => ({ path: field, before: live[field], after: version[field] }),
  );
  const severities = new Set(review.report.findings.map((finding) => finding.severity));
  const risk: ProposalRisk = severities.has("error") ? "high" : severities.has("warning") || review.overall < 70 ? "medium" : "low";
  const gained = keywordsGained(facts.targetKeywords, live, version);
  const firstScore = reviewRounds[0]?.overall ?? review.overall;

  const proposal = ProposalSchema.parse({
    id: store.nextId.proposal(),
    workspaceId: run.workspaceId,
    sellerAccountId: run.sellerAccountId,
    type: "listing_update",
    status: "pending_approval",
    risk,
    title: `Rewrite listing for ${product.title}`,
    rationale: [
      `${reviewRounds.length} review rounds took the draft from ${firstScore} to ${review.overall}.`,
      gained.length > 0
        ? `It adds ${gained.length} target ${gained.length === 1 ? "keyword" : "keywords"} missing from the live copy and uses all ${version.bullets.length} bullets.`
        : `It uses all ${version.bullets.length} bullets and grounds every claim in ProductFacts.`,
    ].join(" "),
    target: { type: "product", id: productId },
    diff,
    scores: { confidence: 86, impact: 60, rubric: review.overall },
    freshness: [
      { source: "live_listing", asOf: run.startedAt },
      { source: "product_facts", asOf: facts.updatedAt < run.startedAt ? facts.updatedAt : run.startedAt },
    ],
    reviewId: review.id,
    createdBy: writer,
    createdAt: at,
  });

  const finished = AgentRunSchema.parse({
    ...run,
    status: "succeeded",
    finishedAt: at,
    summary: `Drafted 1 listing update after ${reviewRounds.length} review rounds.`,
    proposalIds: [proposal.id],
    steps: run.steps?.map((step) => (step.kind === "awaiting_approval" ? { ...step, proposalId: proposal.id } : step)),
  });

  const base = { workspaceId: run.workspaceId, sellerAccountId: run.sellerAccountId, at, actor: writer };
  return {
    run: finished,
    version,
    review,
    proposal,
    events: [
      { ...base, action: "agent_run.finished", entity: { type: "agent_run", id: run.id }, metadata: { status: "succeeded", proposals: 1 } },
      { ...base, action: "proposal.created", entity: { type: "proposal", id: proposal.id }, metadata: { type: proposal.type, risk } },
    ],
  };
}

function keywordsGained(keywords: string[], live: ListingVersion, next: ListingVersion): string[] {
  const text = (version: ListingVersion) => [version.title, ...version.bullets, version.backendKeywords].join(" ").toLowerCase();
  const before = text(live);
  const after = text(next);
  return keywords.filter((keyword) => !before.includes(keyword) && after.includes(keyword));
}
