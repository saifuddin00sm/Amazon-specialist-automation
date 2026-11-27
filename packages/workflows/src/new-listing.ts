import {
  MARKETPLACE_IDS,
  MARKETPLACE_LANGUAGES,
  MARKETPLACE_REGIONS,
  SpApiError,
  applicableRestrictions,
  approvalIssues,
  listingAttributes,
  productTypeFromSchema,
  restrictionMessage,
  submittedListing,
  trackedListing,
  type JsonSchema,
  type ListingIssue,
  type ListingsItemChange,
} from "@app/amazon";
import {
  EMPTY_LISTING_COPY,
  LISTING_COPY_ATTRIBUTES,
  LISTING_COPY_ATTRIBUTE_NAMES,
  attributeLabels,
  checkDraftGrounding,
  checkLine,
  checkProposalCompliance,
  newListingBriefProblem,
  newListingDiff,
  newListingFactSheet,
  newListingName,
  newListingSku,
  parseNewListing,
  planNewListingAttributes,
  uncertifiedClaims,
  writerAttributeInput,
  writerAttributes,
  type AgentRunStep,
  type AttributeValue,
  type ComplianceCheck,
  type FactSheetEntry,
  type ListingCopy,
  type ListingDraft,
  type ListingSubmission,
  type MissingFact,
  type NewListingAttribute,
  type NewListingBrief,
  type ProductType,
  type ProductTypeAttribute,
  type ProposalStatus,
  type ReviewReport,
  type SellerAccount,
  type Violation,
} from "@app/core";
import { reviewListing, type ListingReview } from "@app/agents";
import { ProposalWriteError } from "@app/data";
import { PROMPTS, type PromptOutput } from "@app/llm";
import { checkListingCopy, listingLimits, validateAttributes } from "@app/rules";
import type { RunStep } from "./catalog-sync";
import { proposalDecided } from "./client";
import type { NewListingDeps } from "./deps";
import { bufferedGateway, recordStepless, violationCheck, type Generated } from "./model-steps";

/**
 * New listings, from a New listing wizard brief to a listing on Amazon, in three Inngest functions
 * that each start on an event, so none of them can miss one:
 *
 *   draftNewListing    on a member's request: restrictions (when the brief has an ASIN), the product
 *                      type's schema, the listing optimizer in create mode filling every attribute
 *                      from ProductFacts only (or listing the facts it would need), the rules and the
 *                      schema on the draft, the reviewer, Amazon's validation, then a new_listing
 *                      proposal. It stops with a clear reason on the run when the seller is gated,
 *                      facts are missing, or the draft can't be made to pass.
 *   submitNewListing   on a decision: an approved new listing is put to Amazon and Amazon's answer
 *                      recorded on the proposal, which becomes applied or failed.
 *   trackNewListing    on each of Amazon's listing notifications: the listing is read again and its
 *                      submission brought up to date, until it is live.
 */

/** Sends events from a workflow step (Inngest's step.sendEvent). */
export type SendEvent = (name: string, events: ReturnType<typeof proposalDecided.create>[]) => Promise<unknown>;

export type NewListingTools = { run: RunStep; sendEvent: SendEvent };

export type NewListingRequest = {
  /** The request's own id (the event's), so a retried start finds the run it made. */
  requestId: string;
  sellerAccountId: string;
  memberId: string;
  brief: NewListingBrief;
};

export type DraftOutcome =
  | { outcome: "stopped"; runId: string; reason: string }
  /** Autonomy L0: the draft was only suggested. */
  | { outcome: "suggested"; runId: string }
  | { outcome: "filed"; runId: string; proposalId: string; status: ProposalStatus };

export type SubmitOutcome = { outcome: "skipped"; reason: string } | { outcome: "submitted"; proposalId: string; submission: ListingSubmission };

export type TrackOutcome = { outcome: "ignored"; reason: string } | { outcome: "tracked"; proposalId: string; submission: ListingSubmission };

/** A new listing is a new product, listed new. */
export const NEW_LISTING_CONDITION = "new_new";
/** The product's facts only: the wizard collects no price or stock, so no offer goes with it. */
export const NEW_LISTING_REQUIREMENTS = "LISTING_PRODUCT_ONLY";
export const NEW_LISTING_MAX_ROUNDS = 2;
/** The issue code on a submission that never reached Amazon. */
export const NOT_SUBMITTED = "NOT_SUBMITTED";

export const runIdFor = (requestId: string) => `run_nl_${requestId}`;

type Finding = ReviewReport["findings"][number];

type Draft = {
  round: number;
  listing: ListingCopy;
  /** Every attribute the listing will have, in the schema's order. */
  attributes: { name: string; attribute: NewListingAttribute }[];
  checks: ComplianceCheck[];
  missing: MissingFact[];
  /** True when no check fails. */
  passed: boolean;
  /** The product type, and the facts by ref labelled as the writer saw them, for the reviewer. */
  productType: string;
  sheet: FactSheetEntry[];
  /** The facts each claim in the copy cites. */
  claims: ListingDraft["claims"];
  /** The attributes the agent drafted, by label, for the reviewer. */
  drafted: { label: string; value: AttributeValue }[];
};

type Review = Omit<ListingReview, "calls">;

/** Drafts a new listing from a wizard brief and files it for approval. */
export async function draftNewListing(deps: NewListingDeps, request: NewListingRequest, { run, sendEvent }: NewListingTools): Promise<DraftOutcome> {
  const runId = runIdFor(request.requestId);
  const { brief, sellerAccountId } = request;
  const stop = (reason: string) =>
    run("stop", async () => {
      await deps.dataSource.failAgentRun({ runId, error: reason });
      return { outcome: "stopped" as const, runId, reason };
    });

  const started = await run("start", async () => {
    const account = await sellerAccount(deps, sellerAccountId);
    await deps.dataSource.startNewListingRun({ runId, sellerAccountId: account.id, memberId: request.memberId, productType: brief.productType });
    return { connected: (await deps.authorizations.get(account.sellerId)) !== undefined };
  });
  if (!started.connected) return stop("This seller account isn't connected to Amazon yet. Connect it in Settings, then draft the listing again.");

  // Restrictions
  const gate = await run("check listing restrictions", async () => {
    const at = deps.now().toISOString();
    if (!brief.asin) {
      await note(deps, runId, "restrictions", "Listing restrictions", at, "No ASIN yet, so this is a new product. Amazon checks brand and category approval when it validates the listing, before it is filed.");
      return { gated: false as const };
    }
    const where = await seller(deps, sellerAccountId);
    const restrictions = await where.amazon.getListingsRestrictions({
      sellerId: where.sellerId,
      asin: brief.asin,
      marketplaceIds: [where.marketplaceId],
      conditionType: NEW_LISTING_CONDITION,
      reasonLocale: where.languageTag,
    });
    const applicable = applicableRestrictions(restrictions, { marketplaceId: where.marketplaceId, conditionType: NEW_LISTING_CONDITION });
    const reason = applicable.length > 0 ? restrictionMessage(applicable) : undefined;
    await note(deps, runId, "restrictions", "Listing restrictions", at, reason ?? `Amazon lets this seller list ${brief.asin} as new.`);
    return reason ? { gated: true as const, reason } : { gated: false as const };
  });
  if (gate.gated) return stop(gate.reason);

  // The product type's schema
  const loaded = await run("load the product type schema", async () => {
    const at = deps.now().toISOString();
    const { productType, version } = await productTypeSchema(deps, await seller(deps, sellerAccountId), brief.productType);
    const problem = newListingBriefProblem(brief, productType);
    const required = productType.attributes.filter((attribute) => attribute.requirement === "required").length;
    const counts = `${productType.displayName} (${productType.name}): ${required} required and ${productType.attributes.length - required} recommended attributes.`;
    await note(deps, runId, "schema", "Read the product type schema", at, problem ? `${counts}\n${problem}` : counts);
    return problem ? { fits: false as const, reason: `The brief doesn't fit Amazon's ${productType.displayName} schema: ${problem}` } : { fits: true as const, version };
  });
  if (!loaded.fits) return stop(loaded.reason);
  const { version } = loaded;

  // Draft, check and review. Each model call is its own step, and what came of it is recorded in the
  // next one, so a retry records the answer it already has rather than asking the model again.
  let findings: Finding[] = [];
  let draft: Draft | undefined;
  let review: Review | undefined;
  for (let round = 1; round <= NEW_LISTING_MAX_ROUNDS; round += 1) {
    const written = await run(`draft round ${round}`, () => writeDraft(deps, { runId, sellerAccountId, brief, version, round, findings }));
    draft = await run(`check round ${round}`, () => checkDraft(deps, { runId, sellerAccountId, brief, version, round, findings, written }));
    // A revision can't supply facts the seller hasn't given.
    if (draft.missing.length > 0) break;
    const scored = await run(`review round ${round}`, () => reviewDraft(deps, { runId, draft: draft! }));
    review = await run(`record review round ${round}`, () => recordReview(deps, { runId, round, scored }));
    if (draft.passed && blockingFindings(review).length === 0) break;
    // The failing checks come first: the reviewer puts the compliance gate ahead of its own findings.
    findings = review.fixes;
  }
  if (!draft) throw new Error("No draft round ran.");
  if (draft.missing.length > 0) {
    return stop(`Amazon needs facts you haven't given: ${draft.missing.map((fact) => `${fact.label} (${fact.need})`).join("; ")} Add them to the brief and draft the listing again.`);
  }
  if (!draft.passed) {
    return stop(`The draft still fails after ${NEW_LISTING_MAX_ROUNDS} rounds: ${failingChecks(draft.checks).map((finding) => finding.message).join(" ")}`);
  }
  const blocking = review ? blockingFindings(review) : [];
  if (blocking.length > 0) {
    return stop(`The reviewer still blocks the draft after ${NEW_LISTING_MAX_ROUNDS} rounds: ${blocking.map((finding) => finding.message).join(" ")}`);
  }

  // Amazon's validation, then filing for approval
  const sku = newListingSku(runId);
  const preview = await run("validate on Amazon", async () => {
    const at = deps.now().toISOString();
    const where = await seller(deps, sellerAccountId);
    const { schema } = await productTypeSchema(deps, where, brief.productType, version);
    const answer = await where.amazon.putListingsItem({
      sellerId: where.sellerId,
      sku,
      marketplaceIds: [where.marketplaceId],
      body: { productType: brief.productType, requirements: NEW_LISTING_REQUIREMENTS, attributes: putAttributes(schema, draft!.attributes, brief, where) },
      mode: "VALIDATION_PREVIEW",
      includedData: ["issues"],
      issueLocale: where.languageTag,
    });
    const errors = (answer.issues ?? []).filter((issue) => issue.severity === "ERROR");
    const gated = approvalIssues(answer.issues);
    const reason =
      gated.length > 0
        ? `Amazon requires approval before this seller can list this product: ${issueText(gated)}`
        : answer.status === "INVALID" || errors.length > 0
          ? `Amazon's validation refused the draft: ${issueText(errors)}`
          : undefined;
    const check: ComplianceCheck = reason
      ? { id: "amazon_validation", label: "Amazon's validation", status: "fail", detail: reason }
      : { id: "amazon_validation", label: "Amazon's validation", status: "pass", detail: "Amazon checked the listing and found nothing in error." };
    await deps.dataSource.appendAgentRunSteps({
      runId,
      steps: [{ id: `${runId}_preview`, kind: "compliance_check", title: "Amazon's validation", text: checkLine(check), checks: [check], startedAt: at, finishedAt: deps.now().toISOString() }],
    });
    return reason ? { passed: false as const, reason } : { passed: true as const };
  });
  if (!preview.passed) return stop(preview.reason);

  const filed = await run("file for approval", async () => {
    const at = deps.now().toISOString();
    const name = newListingName(brief.facts);
    await deps.dataSource.appendAgentRunSteps({
      runId,
      steps: [
        {
          id: `${runId}_attributes`,
          kind: "plan",
          agent: "listing_creator",
          title: "Listing for Amazon",
          text: `${draft!.attributes.length} attributes for ${name}, as SKU ${sku}. Every value comes from your facts, your entries, or copy that cites them.`,
          changes: newListingDiff(brief, draft!.attributes),
          startedAt: at,
          finishedAt: at,
        },
        {
          id: `${runId}_awaiting`,
          kind: "awaiting_approval",
          title: "Awaiting approval",
          text: `Created a new listing draft for ${name}. It is submitted to Amazon as soon as a member approves it.`,
          startedAt: at,
          finishedAt: deps.now().toISOString(),
        },
      ],
    });
    const { proposal } = await deps.dataSource.completeAgentRun(runId);
    return proposal ? { proposalId: proposal.id, status: proposal.status } : undefined;
  });
  if (!filed) return { outcome: "suggested", runId };
  // Autonomy approved it: nobody will, so say so for submitNewListing.
  if (filed.status === "approved") await sendEvent("announce the approval", [proposalDecided.create({ proposalId: filed.proposalId, status: "approved" })]);
  return { outcome: "filed", runId, proposalId: filed.proposalId, status: filed.status };
}

/**
 * Submits an approved new listing to Amazon and records Amazon's answer on its proposal: applied
 * when Amazon accepts it, failed when it refuses. Anything else (not a new listing, not approved,
 * already submitted) is skipped, so a repeated decision event changes nothing.
 */
export async function submitNewListing(deps: NewListingDeps, proposalId: string, run: RunStep): Promise<SubmitOutcome> {
  const ready = await run("read the proposal", async () => {
    const proposal = await deps.dataSource.getProposal(proposalId);
    if (!proposal || proposal.type !== "new_listing") return { submit: false as const, reason: "It isn't a new listing." };
    if (proposal.listingSubmission) return { submit: false as const, reason: "It was already submitted." };
    if (proposal.status !== "approved") return { submit: false as const, reason: `It is ${proposal.status}, not approved.` };
    return { submit: true as const };
  });
  if (!ready.submit) return { outcome: "skipped", reason: ready.reason };

  const submission = await run("submit to Amazon", async () => {
    const proposal = await deps.dataSource.getProposal(proposalId);
    if (!proposal) throw new Error("The approved proposal no longer exists.");
    // A retried submit: Amazon already answered.
    if (proposal.listingSubmission) return proposal.listingSubmission;
    const { brief, attributes } = parseNewListing(proposal.diff);
    if (!brief) throw new Error("The approved proposal has no brief.");
    const where = await seller(deps, proposal.sellerAccountId);
    if (!(await deps.authorizations.get(where.sellerId))) throw new Error("The seller account isn't connected to Amazon.");
    const { schema } = await productTypeSchema(deps, where, brief.productType);
    const sku = proposalSku(proposal);
    const answer = await where.amazon.putListingsItem({
      sellerId: where.sellerId,
      sku,
      marketplaceIds: [where.marketplaceId],
      body: {
        productType: brief.productType,
        requirements: NEW_LISTING_REQUIREMENTS,
        attributes: putAttributes(schema, [...attributes].map(([name, attribute]) => ({ name, attribute })), brief, where),
      },
      issueLocale: where.languageTag,
      proposal: { id: proposal.id, status: proposal.status },
    });
    const recorded = await deps.dataSource.recordListingSubmission({
      proposalId,
      submission: submittedListing(answer, { sku, marketplaceId: where.marketplaceId, at: deps.now().toISOString() }),
    });
    return recorded.listingSubmission!;
  });
  return { outcome: "submitted", proposalId, submission };
}

/**
 * When submitting gave up: the approved proposal fails, with why, so it doesn't sit approved with
 * nothing on Amazon. Nothing changes when the proposal moved on meanwhile (submitted, or decided again).
 */
export async function failNewListingSubmission(deps: NewListingDeps, proposalId: string, why: string): Promise<void> {
  const proposal = await deps.dataSource.getProposal(proposalId);
  if (!proposal || proposal.type !== "new_listing" || proposal.status !== "approved" || proposal.listingSubmission) return;
  const account = await deps.dataSource.getSellerAccount(proposal.sellerAccountId);
  const at = deps.now().toISOString();
  try {
    await deps.dataSource.recordListingSubmission({
      proposalId,
      submission: {
        sku: proposalSku(proposal),
        marketplaceId: account ? MARKETPLACE_IDS[account.marketplace] : "unknown",
        status: "invalid",
        issues: [{ code: NOT_SUBMITTED, message: `The listing couldn't be submitted to Amazon: ${why.replace(/\.?$/, ".")}`, severity: "ERROR" }],
        submittedAt: at,
        updatedAt: at,
      },
    });
  } catch (error) {
    if (!(error instanceof ProposalWriteError && error.code === "invalid_transition")) throw error;
  }
}

/**
 * Brings a submitted new listing up to date after one of Amazon's notifications about it: Amazon's
 * issues, its ASIN, and whether it is live. Notifications for other listings are ignored.
 */
export async function trackNewListing(deps: NewListingDeps, change: ListingsItemChange, run: RunStep): Promise<TrackOutcome> {
  return run("update the listing", async (): Promise<TrackOutcome> => {
    const proposal = await deps.dataSource.findProposalByListingSku(change.sku);
    const current = proposal?.listingSubmission;
    if (!proposal || !current) return { outcome: "ignored", reason: "No new listing was submitted under that SKU." };
    const where = await seller(deps, proposal.sellerAccountId);
    if (where.sellerId !== change.sellerId || current.marketplaceId !== change.marketplaceId) {
      return { outcome: "ignored", reason: "The notification is for another seller or marketplace." };
    }
    if (current.status === "invalid") return { outcome: "ignored", reason: "Amazon refused that listing; there is nothing to follow." };

    let item;
    try {
      item = await where.amazon.getListingsItem({
        sellerId: where.sellerId,
        sku: current.sku,
        marketplaceIds: [current.marketplaceId],
        includedData: ["summaries", "issues"],
        issueLocale: where.languageTag,
      });
    } catch (error) {
      // Not there yet: Amazon is still creating it, and will say when it changes.
      if (error instanceof SpApiError && error.status === 404) return { outcome: "tracked", proposalId: proposal.id, submission: current };
      throw error;
    }
    const recorded = await deps.dataSource.recordListingSubmission({ proposalId: proposal.id, submission: trackedListing(current, item, deps.now().toISOString()) });
    return { outcome: "tracked", proposalId: proposal.id, submission: recorded.listingSubmission! };
  });
}

/**
 * Approved new listings with no submission: a decision event that never reached Inngest leaves one
 * waiting. The sweep announces them again.
 */
export async function approvedListingsToSubmit(deps: Pick<NewListingDeps, "dataSource">): Promise<string[]> {
  const workspaces = await deps.dataSource.listWorkspaces();
  const approved = await Promise.all(workspaces.map((workspace) => deps.dataSource.listProposals({ workspaceId: workspace.id, type: "new_listing", status: "approved" })));
  return approved.flat().filter((proposal) => !proposal.listingSubmission).map((proposal) => proposal.id);
}

/** The SKU a new listing goes to Amazon under, from the run that drafted it. */
function proposalSku(proposal: { id: string; createdBy: { type: string; agentRunId?: string } }): string {
  return newListingSku(proposal.createdBy.agentRunId ?? proposal.id);
}

/** The listing optimizer in create mode: one call through the gateway. Records nothing. */
async function writeDraft(
  deps: NewListingDeps,
  { runId, sellerAccountId, brief, version, round, findings }: { runId: string; sellerAccountId: string; brief: NewListingBrief; version: string; round: number; findings: Finding[] },
): Promise<Generated<PromptOutput<typeof PROMPTS.listingCreate>>> {
  const startedAt = deps.now().toISOString();
  const { schema, productType } = await productTypeSchema(deps, await seller(deps, sellerAccountId), brief.productType, version);
  const plan = planNewListingAttributes(productType, brief.facts, brief.attributes);
  const { gateway, calls } = bufferedGateway(deps);
  try {
    const { output } = await gateway.generate({
      prompt: PROMPTS.listingCreate,
      input: {
        productType: productType.name,
        limits: listingLimits(schema, productType.name),
        facts: newListingFactSheet(brief, attributeLabels(productType)),
        prohibitedClaims: uncertifiedClaims(brief.facts.certifications),
        attributes: writerAttributes(plan).map(writerAttributeInput),
        findings,
      },
      stepId: `${runId}_draft${round}`,
    });
    return { output, calls, startedAt, finishedAt: deps.now().toISOString() };
  } catch (error) {
    await recordStepless(deps, runId, calls);
    throw error;
  }
}

/**
 * A draft round's checks: the rules, the schema on every attribute, and the grounding of each claim.
 * Records the draft and its checks, with the model calls behind the draft, in one write.
 */
async function checkDraft(
  deps: NewListingDeps,
  {
    runId,
    sellerAccountId,
    brief,
    version,
    round,
    findings,
    written,
  }: { runId: string; sellerAccountId: string; brief: NewListingBrief; version: string; round: number; findings: Finding[]; written: Generated<PromptOutput<typeof PROMPTS.listingCreate>> },
): Promise<Draft> {
  const { output } = written;
  const where = await seller(deps, sellerAccountId);
  const { schema, productType } = await productTypeSchema(deps, where, brief.productType, version);
  const plan = planNewListingAttributes(productType, brief.facts, brief.attributes);
  const sheet = newListingFactSheet(brief, attributeLabels(productType));
  const asked = writerAttributes(plan);

  // Every value: the seller's facts and entries as given, the copy and the agent's attributes as drafted.
  const values = new Map<string, NewListingAttribute>();
  for (const { attribute, status, value } of plan) {
    if ((status === "facts" || status === "seller") && value !== undefined) values.set(attribute.name, { value, source: status });
  }
  const copy: Record<string, AttributeValue | undefined> = {
    [LISTING_COPY_ATTRIBUTES.title]: output.listing.title || undefined,
    [LISTING_COPY_ATTRIBUTES.bullets]: output.listing.bullets.length > 0 ? output.listing.bullets : undefined,
    [LISTING_COPY_ATTRIBUTES.description]: output.listing.description || undefined,
    [LISTING_COPY_ATTRIBUTES.backendKeywords]: output.listing.backendKeywords || undefined,
  };
  for (const { attribute, status } of plan) {
    const value = copy[attribute.name];
    if (status === "agent" && value !== undefined) values.set(attribute.name, { value, source: "agent" });
  }
  const refs = new Set(sheet.map((entry) => entry.ref));
  const attributeProblems: string[] = [];
  for (const filled of output.attributes) {
    const attribute = asked.find((candidate) => candidate.name === filled.name);
    if (!attribute) continue;
    const problem = agentValueProblem(attribute, filled.value, filled.facts, refs);
    if (problem) attributeProblems.push(problem);
    else values.set(attribute.name, { value: single(attribute, filled.value), source: "agent" });
  }
  const order = new Map(productType.attributes.map((attribute, i) => [attribute.name, i]));
  const attributes = [...values].sort(([a], [b]) => order.get(a)! - order.get(b)!).map(([name, attribute]) => ({ name, attribute }));

  // What it takes for Amazon to accept the listing: every attribute, shaped and validated by the schema.
  const shaped = listingAttributes({
    schema,
    values: new Map(attributes.map(({ name, attribute }) => [name, attribute.value])),
    facts: brief.facts,
    marketplaceId: where.marketplaceId,
    languageTag: where.languageTag,
  });
  const schemaViolations = validateAttributes(shaped.attributes, schema);
  const missing = missingFacts(productType, schema, { plan, asked, filled: values, said: output.missingFacts, unexpressed: shaped.unexpressed, violations: schemaViolations });
  const missingNames = new Set(missing.map((fact) => fact.attribute));
  const schemaErrors = schemaViolations.filter((violation) => !(violation.keyword === "required" && missingNames.has(violation.match ?? "")));

  const policy = checkListingCopy(output.listing, {
    brand: brief.facts.brand,
    category: productType.name,
    prohibitedClaims: uncertifiedClaims(brief.facts.certifications),
    marketplaceId: where.marketplaceId,
    languageTag: where.languageTag,
  });
  const grounding = checkDraftGrounding(output, EMPTY_LISTING_COPY, sheet).filter((problem) => problem.kind !== "reason_for_unchanged");
  const checks: ComplianceCheck[] = [
    ...checkProposalCompliance({ type: "new_listing", diff: newListingDiff(brief, attributes) }),
    violationCheck("listing_policy", "Title policy and prohibited claims", policy),
    violationCheck("product_type_schema", `${productType.displayName} schema`, schemaErrors),
    grounding.length > 0
      ? { id: "grounding", label: "Claims cite the facts", status: "fail", detail: grounding.map((problem) => problem.message).join(" ") }
      : { id: "grounding", label: "Claims cite the facts", status: "pass" },
    attributeProblems.length > 0
      ? { id: "agent_attributes", label: "Drafted attributes", status: "fail", detail: attributeProblems.join(" ") }
      : { id: "agent_attributes", label: "Drafted attributes", status: "pass", detail: `${asked.length} drafted from the facts.` },
  ];

  await deps.dataSource.appendAgentRunSteps({
    runId,
    steps: [
      {
        id: `${runId}_draft${round}`,
        kind: "draft",
        agent: "listing_writer",
        round,
        title: round === 1 ? "Draft listing" : "Revised draft",
        text: draftText(output.listing, findings),
        listing: output.listing,
        startedAt: written.startedAt,
        finishedAt: written.finishedAt,
      },
      {
        id: `${runId}_checks${round}`,
        kind: "compliance_check",
        title: round === 1 ? "Compliance check" : "Compliance check on the revision",
        text: [
          `Running ${checks.length} checks on draft ${round}.`,
          ...checks.map(checkLine),
          ...(missing.length > 0 ? ["", "Facts Amazon needs that the brief doesn't have:", ...missing.map((fact) => `• ${fact.label}: ${fact.need}`)] : []),
        ].join("\n"),
        checks,
        startedAt: written.finishedAt,
        finishedAt: deps.now().toISOString(),
      },
    ],
    llmCalls: written.calls,
  });
  return {
    round,
    listing: output.listing,
    attributes,
    checks,
    missing,
    passed: !checks.some((check) => check.status === "fail"),
    productType: productType.name,
    sheet,
    claims: output.claims,
    drafted: attributes.flatMap(({ name, attribute }) =>
      attribute.source === "agent" && !LISTING_COPY_ATTRIBUTE_NAMES.has(name) ? [{ label: attributeLabels(productType)[name] ?? name, value: attribute.value }] : [],
    ),
  };
}

/** The listing reviewer scores a draft against the rubric, behind the compliance gate its checks decide. Records nothing. */
async function reviewDraft(deps: NewListingDeps, { runId, draft }: { runId: string; draft: Draft }): Promise<Generated<Review>> {
  const startedAt = deps.now().toISOString();
  const { gateway, calls } = bufferedGateway(deps);
  try {
    const { calls: made, ...output } = await reviewListing(gateway, {
      productType: draft.productType,
      facts: draft.sheet,
      keywords: [],
      attributes: draft.drafted,
      draft: { listing: draft.listing, claims: draft.claims },
      checks: draft.checks,
      stepId: `${runId}_review${draft.round}`,
    });
    return { output, calls: made, startedAt, finishedAt: deps.now().toISOString() };
  } catch (error) {
    await recordStepless(deps, runId, calls);
    throw error;
  }
}

/** Records a review, with the model calls behind it, in one write. */
async function recordReview(deps: NewListingDeps, { runId, round, scored }: { runId: string; round: number; scored: Generated<Review> }): Promise<Review> {
  const { output } = scored;
  await deps.dataSource.appendAgentRunSteps({
    runId,
    steps: [
      {
        id: `${runId}_review${round}`,
        kind: "review",
        agent: "listing_reviewer",
        round,
        title: round === 1 ? "Reviewer" : `Reviewer round ${round}`,
        text: output.report,
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

function blockingFindings(review: Review): Finding[] {
  return review.findings.filter((finding) => finding.severity === "error");
}

/**
 * Facts Amazon needs that nobody has: required attributes the facts don't fill, ones the agent was
 * asked to fill and couldn't from the facts, values the schema can't take, and attributes the schema
 * requires that the wizard doesn't ask about (a GTIN without an exemption, say).
 */
function missingFacts(
  productType: ProductType,
  schema: JsonSchema,
  {
    plan,
    asked,
    filled,
    said,
    unexpressed,
    violations,
  }: {
    plan: ReturnType<typeof planNewListingAttributes>;
    asked: ProductTypeAttribute[];
    filled: ReadonlyMap<string, NewListingAttribute>;
    said: { attribute: string; need: string }[];
    unexpressed: { attribute: string; label: string; reason: string }[];
    violations: Violation[];
  },
): MissingFact[] {
  const missing = new Map<string, MissingFact>();
  const add = (fact: MissingFact) => missing.has(fact.attribute) || missing.set(fact.attribute, fact);
  const required = (name: string) => productType.attributes.some((attribute) => attribute.name === name && attribute.requirement === "required");

  for (const { attribute, status } of plan) {
    if (status === "missing") add({ attribute: attribute.name, label: attribute.label, need: `Tell us the ${attribute.label.toLowerCase()}.` });
  }
  for (const attribute of asked) {
    if (attribute.requirement !== "required" || filled.has(attribute.name)) continue;
    const need = said.find((fact) => fact.attribute === attribute.name)?.need ?? `Tell us enough to set the ${attribute.label.toLowerCase()}.`;
    add({ attribute: attribute.name, label: attribute.label, need });
  }
  for (const value of unexpressed) if (required(value.attribute)) add({ attribute: value.attribute, label: value.label, need: value.reason });

  const properties = typeof schema.properties === "object" && schema.properties !== null ? (schema.properties as Record<string, { title?: unknown }>) : {};
  for (const violation of violations) {
    const name = violation.keyword === "required" && violation.path?.split("/").length === 2 ? violation.match : undefined;
    if (!name || filled.has(name)) continue;
    const label = typeof properties[name]?.title === "string" ? (properties[name].title as string) : name;
    add({ attribute: name, label, need: `Amazon requires the ${label.toLowerCase()} for this product; the brief doesn't have it.` });
  }
  return [...missing.values()];
}

/** Why the agent's value for an attribute can't be used, or undefined when it can. */
function agentValueProblem(attribute: ProductTypeAttribute, value: AttributeValue, facts: readonly string[], refs: ReadonlySet<string>): string | undefined {
  const values = Array.isArray(value) ? value : [value];
  const unknown = facts.filter((ref) => !refs.has(ref));
  if (unknown.length > 0) return `${attribute.label} cites ${unknown.join(", ")}, which the facts don't have.`;
  if (!attribute.multiple && values.length > 1) return `${attribute.label} takes one value.`;
  const outside = attribute.options ? values.filter((entry) => !attribute.options!.includes(entry)) : [];
  if (outside.length > 0) return `${attribute.label} must be one of ${attribute.options!.join(", ")}.`;
  if (attribute.maxLength !== undefined && values.some((entry) => entry.length > attribute.maxLength!)) return `${attribute.label} is over ${attribute.maxLength} characters.`;
  return undefined;
}

function single(attribute: ProductTypeAttribute, value: AttributeValue): AttributeValue {
  return !attribute.multiple && Array.isArray(value) ? value[0]! : value;
}

/** The listing's attributes as a put sends them. */
function putAttributes(
  schema: JsonSchema,
  attributes: { name: string; attribute: NewListingAttribute }[],
  brief: NewListingBrief,
  where: { marketplaceId: string; languageTag: string },
): Record<string, Record<string, unknown>[]> {
  return listingAttributes({
    schema,
    values: new Map(attributes.map(({ name, attribute }) => [name, attribute.value])),
    facts: brief.facts,
    marketplaceId: where.marketplaceId,
    languageTag: where.languageTag,
  }).attributes;
}

/** Failing checks as findings the next draft must fix. */
function failingChecks(checks: readonly ComplianceCheck[]): Finding[] {
  return checks
    .filter((check) => check.status === "fail")
    .map((check) => ({ criterion: check.id === "grounding" || check.id === "agent_attributes" ? "factual_accuracy" : "compliance", severity: "error", message: `${check.label}: ${check.detail ?? "fails."}` }));
}

function issueText(issues: readonly ListingIssue[]): string {
  return issues.length > 0 ? issues.map((issue) => `${issue.message.replace(/\.?$/, ".")}${issue.attributeNames ? ` (${issue.attributeNames.join(", ")})` : ""}`).join(" ") : "it gave no reason.";
}

function draftText(listing: ListingCopy, findings: readonly Finding[]): string {
  return [
    findings.length > 0 ? `Fixing ${findings.length} ${findings.length === 1 ? "finding" : "findings"}.` : "Writing only what the facts and your values say.",
    "",
    "Title",
    listing.title,
    "",
    "Bullets",
    ...listing.bullets.map((bullet) => `• ${bullet}`),
    "",
    "Description",
    listing.description,
    "",
    "Backend search terms",
    listing.backendKeywords || "(none)",
  ].join("\n");
}

/** Records a step that only says what the workflow found. */
async function note(deps: NewListingDeps, runId: string, slug: string, title: string, startedAt: string, text: string): Promise<void> {
  const step: AgentRunStep = { id: `${runId}_${slug}`, kind: "plan", agent: "listing_creator", title, text, changes: [], startedAt, finishedAt: deps.now().toISOString() };
  await deps.dataSource.appendAgentRunSteps({ runId, steps: [step] });
}

async function sellerAccount(deps: Pick<NewListingDeps, "dataSource">, sellerAccountId: string): Promise<SellerAccount> {
  const account = await deps.dataSource.getSellerAccount(sellerAccountId);
  if (!account) throw new Error("That seller account no longer exists.");
  return account;
}

export type Seller = { sellerId: string; marketplaceId: string; languageTag: string; amazon: ReturnType<NewListingDeps["amazon"]> };

/** The seller behind an account, and where on Amazon it sells. */
export async function seller(deps: Pick<NewListingDeps, "dataSource" | "amazon">, sellerAccountId: string): Promise<Seller> {
  const account = await sellerAccount(deps, sellerAccountId);
  return {
    sellerId: account.sellerId,
    marketplaceId: MARKETPLACE_IDS[account.marketplace],
    languageTag: MARKETPLACE_LANGUAGES[account.marketplace],
    amazon: deps.amazon(MARKETPLACE_REGIONS[account.marketplace]),
  };
}

type LoadedSchema = { schema: JsonSchema; productType: ProductType; version: string };

/** Schemas read so far, by deps: a version never changes, so each is downloaded once per process. */
const loadedSchemas = new WeakMap<Pick<NewListingDeps, "productTypeSchema">, Map<string, LoadedSchema>>();
/** Schemas can run to megabytes; keep the most recent few. */
const SCHEMAS_KEPT = 20;

/**
 * A product type's schema in the seller's marketplace, read into the attributes the wizard asks for:
 * the latest, or `version` once a run has pinned one. Schemas stay out of step results (they can run
 * to megabytes), so each step reads them here, from Amazon once per version. A new listing's
 * requirements by default; a listing update asks for "LISTING".
 */
export async function productTypeSchema(
  deps: Pick<NewListingDeps, "productTypeSchema">,
  where: Seller,
  name: string,
  version?: string,
  requirements: "LISTING" | typeof NEW_LISTING_REQUIREMENTS = NEW_LISTING_REQUIREMENTS,
): Promise<LoadedSchema> {
  let cache = loadedSchemas.get(deps);
  if (!cache) loadedSchemas.set(deps, (cache = new Map()));
  const key = (at: string) => `${where.marketplaceId}|${name}|${requirements}|${at}`;
  const cached = version ? cache.get(key(version)) : undefined;
  if (cached) return cached;

  const definition = await where.amazon.getDefinitionsProductType({
    sellerId: where.sellerId,
    productType: name,
    marketplaceIds: [where.marketplaceId],
    requirements,
    locale: where.languageTag,
    ...(version ? { productTypeVersion: version } : {}),
  });
  const loaded = cache.get(key(definition.productTypeVersion.version));
  if (loaded) return loaded;
  const schema = await deps.productTypeSchema(definition);
  const fresh = { schema, productType: productTypeFromSchema(definition, schema), version: definition.productTypeVersion.version };
  cache.set(key(fresh.version), fresh);
  if (cache.size > SCHEMAS_KEPT) cache.delete(cache.keys().next().value!);
  return fresh;
}
