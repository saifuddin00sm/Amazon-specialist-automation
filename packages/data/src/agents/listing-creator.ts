import {
  AgentRunSchema,
  LISTING_COPY_ATTRIBUTES,
  LISTING_LIMITS,
  NewListingBriefSchema,
  ProposalSchema,
  RubricCriterionSchema,
  autonomyFor,
  canActOnAccount,
  checkProposalCompliance,
  formatDimensions,
  newListingBriefProblem,
  newListingDiff,
  newListingName,
  newListingPath,
  overallScore,
  parseNewListing,
  planNewListingAttributes,
  utf8ByteLength,
  type Actor,
  type AgentRun,
  type AgentRunStep,
  type AttributePlan,
  type AttributeValue,
  type AuditEvent,
  type ComplianceCheck,
  type ListingCopy,
  type Member,
  type NewListingAttribute,
  type NewListingBrief,
  type ProductType,
  type Proposal,
  type ReviewReport,
  type RubricScores,
  type SellerAccount,
  type Workspace,
} from "@app/core";
import { AgentRunError } from "../data-source";
import { assertAgentsRunning, fileWithAutonomy, finalStep } from "./autonomy";

/** What a listing creator run reads about one seller account. */
export type ListingCreatorStore = {
  /** For the kill switch. */
  workspace: Workspace | undefined;
  /** The member starting the run, when there is one. */
  members: readonly Member[];
  account: SellerAccount | undefined;
  /** A product type's schema in the account's marketplace. */
  productType: (name: string) => ProductType | undefined;
  nextId: { run: () => string; proposal: () => string };
};

type AuditDraft = Omit<AuditEvent, "id">;

/** Seconds each step takes in the simulated run, in order: facts, copy, attributes, guardrails, review, filing. */
const STEP_SECONDS = [3, 6, 4, 2, 4, 1] as const;

/** Seller attributes that say nothing a shopper picks a product by. */
const NOT_SELLING_POINTS = new Set(["country_of_origin"]);

/**
 * Drafts a listing for a product that isn't on Amazon yet from a New listing wizard brief, and
 * returns the run running, with the audit event to record. Its plan steps hold the brief and every
 * attribute, which completeListingCreatorRun files as one new_listing Proposal.
 */
export function startListingCreatorRun(
  store: ListingCreatorStore,
  { sellerAccountId, memberId, brief: input, at }: { sellerAccountId: string; memberId: string; brief: NewListingBrief; at: Date },
): { run: AgentRun; events: AuditDraft[] } {
  const { account } = store;
  if (!account || account.id !== sellerAccountId) throw new AgentRunError("not_found", "That seller account doesn't exist.");
  const member = store.members.find((candidate) => candidate.id === memberId);
  if (!member || !canActOnAccount(member, { workspaceId: account.workspaceId, sellerAccountId: account.id })) {
    throw new AgentRunError("forbidden", "You don't have permission to run agents on this account.");
  }
  assertAgentsRunning(store.workspace);

  const parsed = NewListingBriefSchema.safeParse(input);
  if (!parsed.success) throw new AgentRunError("invalid_input", "Fill in the product facts and pick a product type.");
  const brief = parsed.data;
  const productType = store.productType(brief.productType);
  if (!productType) throw new AgentRunError("invalid_input", `Amazon has no product type ${brief.productType} in the ${account.marketplace} marketplace.`);
  const problem = newListingBriefProblem(brief, productType);
  if (problem) throw new AgentRunError("invalid_input", problem);

  const id = store.nextId.run();
  const plan = planNewListingAttributes(productType, brief.facts, brief.attributes);
  const copy = draftCopy(brief, productType, plan);
  const given = plan.flatMap(({ attribute, status, value }) =>
    (status === "facts" || status === "seller") && value !== undefined ? [{ name: attribute.name, attribute: { value, source: status } }] : [],
  );
  const drafted = plan.flatMap(({ attribute, status }) => {
    const value = status === "agent" ? draftAttribute(attribute.name, copy, productType) : undefined;
    return value === undefined ? [] : [{ name: attribute.name, attribute: { value, source: "agent" as const } }];
  });
  // In the schema's order, so the proposal reads like the listing.
  const order = new Map(productType.attributes.map((attribute, i) => [attribute.name, i]));
  const attributes = [...given, ...drafted].sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  const diff = newListingDiff(brief, attributes);
  const [briefLine, ...attributeLines] = diff;
  const isGiven = (entry: { path: string }) => given.some(({ name }) => entry.path === newListingPath.attribute(name));
  const checks = checkProposalCompliance({ type: "new_listing", diff });
  const review = reviewDraft(copy, plan, checks);

  let clock = at.getTime();
  const timed = (i: number) => {
    const from = clock;
    clock += STEP_SECONDS[i]! * 1000;
    return { id: `${id}_s${i + 1}`, startedAt: new Date(from).toISOString(), finishedAt: new Date(clock).toISOString() };
  };
  const agent = "listing_creator" as const;
  const name = newListingName(brief.facts);
  const labels = (statuses: AttributePlan["status"][]) =>
    plan.filter(({ status }) => statuses.includes(status)).map(({ attribute }) => attribute.label.toLowerCase());
  const required = productType.attributes.filter((attribute) => attribute.requirement === "required").length;
  const leftEmpty = labels(["empty"]);

  const steps: AgentRunStep[] = [
    {
      ...timed(0),
      kind: "plan",
      agent,
      title: "Read the product facts",
      text: [
        `Product type: ${productType.displayName} (${productType.name}). ${required} required and ${productType.attributes.length - required} recommended attributes.`,
        `${name}: ${brief.facts.materials.join(", ")}, ${formatDimensions(brief.facts.dimensions)}, ${brief.facts.photos.length} ${brief.facts.photos.length === 1 ? "photo" : "photos"}.`,
        brief.facts.certifications.length > 0 ? `Certified: ${brief.facts.certifications.join(", ")}.` : "No certifications, so the copy claims none.",
        "",
        `From your facts: ${labels(["facts"]).join(", ")}.`,
        ...(given.some(({ attribute }) => attribute.source === "seller") ? [`You entered: ${labels(["seller"]).join(", ")}.`] : []),
        `To draft: ${labels(["agent"]).join(", ")}.`,
        ...(leftEmpty.length > 0 ? [`Left empty: ${leftEmpty.join(", ")}.`] : []),
      ].join("\n"),
      changes: [briefLine!, ...attributeLines.filter(isGiven)],
    },
    {
      ...timed(1),
      kind: "draft",
      agent: "listing_writer",
      round: 1,
      title: "Draft listing copy",
      text: ["Writing only what the facts and your values say.", "", copyText(copy)].join("\n"),
      listing: copy,
    },
    {
      ...timed(2),
      kind: "plan",
      agent,
      title: "Draft attributes",
      text: drafted.map(({ name: attribute, attribute: { value } }) => `${attribute}: ${Array.isArray(value) ? `${value.length} values` : value}`).join("\n"),
      changes: attributeLines.filter((entry) => !isGiven(entry)),
    },
    {
      ...timed(3),
      kind: "compliance_check",
      title: "Compliance check",
      text: [`Running ${checks.length} guardrail checks on the draft.`, ...checks.map((check) => `${CHECK_MARK[check.status]} ${check.label}${check.detail ? ` – ${check.detail}` : ""}`)].join(
        "\n",
      ),
      checks,
    },
    {
      ...timed(4),
      kind: "review",
      agent: "listing_reviewer",
      round: 1,
      title: "Reviewer",
      text: [
        "Scoring the draft against the rubric.",
        RubricCriterionSchema.options.map((criterion) => `${criterion.replace("_", " ")} ${review.scores[criterion]}/5`).join(" · "),
        `Overall ${review.overall}/100. ${review.report.summary}`,
        ...review.report.findings.map((finding) => `Note: ${finding.message}`),
      ].join("\n"),
      scores: review.scores,
      overall: review.overall,
      findings: review.report.findings,
    },
    {
      ...timed(5),
      kind: "awaiting_approval",
      title: "Awaiting approval",
      text: `Created a new listing draft for ${name}. Nothing is listed on Amazon until a member approves it.`,
    },
  ];

  const run = AgentRunSchema.parse({
    id,
    workspaceId: account.workspaceId,
    sellerAccountId: account.id,
    agent,
    status: "running",
    autonomyLevel: account.autonomyLevel,
    trigger: "manual",
    // No subject: the product doesn't exist yet, and drafting one listing doesn't block another.
    summary: `Drafting a new listing for ${name}.`,
    proposalIds: [],
    steps,
    startedAt: at.toISOString(),
  });

  return {
    run,
    events: [
      {
        workspaceId: run.workspaceId,
        sellerAccountId: run.sellerAccountId,
        at: run.startedAt,
        actor: { type: "agent", agent, agentRunId: run.id },
        action: "agent_run.started",
        entity: { type: "agent_run", id: run.id },
        metadata: { trigger: "manual", requestedBy: memberId, productType: productType.name },
      },
    ],
  };
}

/**
 * Files a running listing creator run's draft as one pending new_listing Proposal, as the account's
 * autonomy allows. Nothing is listed on Amazon here.
 */
export function completeListingCreatorRun(
  store: ListingCreatorStore,
  run: AgentRun,
  at: string,
): { run: AgentRun; proposal?: Proposal; events: AuditDraft[] } {
  if (run.agent !== "listing_creator") throw new AgentRunError("conflict", "Only listing creator runs can be completed here.");
  const { account } = store;
  if (!account || account.id !== run.sellerAccountId) throw new AgentRunError("not_found", "The seller account this run drafted for is no longer available.");
  assertAgentsRunning(store.workspace);

  const diff = (run.steps ?? []).flatMap((step) => (step.kind === "plan" ? step.changes : []));
  const { brief, attributes } = parseNewListing(diff);
  if (!brief || attributes.size === 0) throw new AgentRunError("conflict", "This run has no draft to file.");

  const creator: Actor = { type: "agent", agent: "listing_creator", agentRunId: run.id };
  const name = newListingName(brief.facts);
  const productType = store.productType(brief.productType);
  const checks = checkProposalCompliance({ type: "new_listing", diff });
  const review = (run.steps ?? []).flatMap((step) => (step.kind === "review" ? [step] : [])).at(-1);
  const count = (source: NewListingAttribute["source"]) => [...attributes.values()].filter((attribute) => attribute.source === source).length;
  const fromYou = count("facts") + count("seller");

  const proposal = ProposalSchema.parse({
    id: store.nextId.proposal(),
    workspaceId: run.workspaceId,
    sellerAccountId: run.sellerAccountId,
    type: "new_listing",
    // A new listing goes live on Amazon, so a member decides it unless the account allows L3.
    status: "pending_approval",
    risk: "medium",
    title: `New listing: ${name}`,
    rationale: [
      `${productType?.displayName ?? brief.productType} listing drafted from your product facts.`,
      `${fromYou} ${fromYou === 1 ? "attribute comes" : "attributes come"} from you; the agent drafted ${count("agent")}, including the title, bullets and description, without claiming anything the facts don't say.`,
    ].join(" "),
    target: { type: "seller_account", id: account.id },
    diff,
    scores: {
      confidence: review ? Math.min(90, Math.round(review.overall * 0.9)) : 60,
      impact: 70,
      ...(review ? { rubric: review.overall } : {}),
    },
    freshness: [{ source: "product_facts", asOf: run.startedAt }],
    createdBy: creator,
    createdAt: at,
  });

  const filed = fileWithAutonomy(proposal, autonomyFor(account, "new_listing"), checks, at);
  const filedProposal = filed.outcome === "suggested" ? undefined : filed.proposal;
  const finished = AgentRunSchema.parse({
    ...run,
    status: "succeeded",
    finishedAt: at,
    summary: filedProposal ? `Drafted a new listing for ${name}.` : `Suggested a new listing for ${name}; L0 files nothing.`,
    proposalIds: filedProposal ? [filedProposal.id] : [],
    steps: finalStep(run.steps, filed, "new listings"),
  });
  const ran: AuditDraft = {
    workspaceId: run.workspaceId,
    sellerAccountId: run.sellerAccountId,
    at,
    actor: creator,
    action: "agent_run.finished",
    entity: { type: "agent_run", id: run.id },
    metadata: { status: "succeeded", proposals: filedProposal ? 1 : 0 },
  };
  if (filed.outcome === "suggested") return { run: finished, events: [ran] };
  return { run: finished, proposal: filed.proposal, events: [ran, ...filed.events] };
}

/**
 * The Phase 1 stand-in for the listing writer on a new product: copy built only from the facts and
 * the seller's values, so every claim is one the seller made.
 */
function draftCopy(brief: NewListingBrief, productType: ProductType, plan: AttributePlan[]): ListingCopy {
  const { facts } = brief;
  const name = newListingName(facts);
  const materials = listWords(facts.materials);
  const details = plan.flatMap(({ attribute, status, value }) =>
    status === "seller" && typeof value === "string" && !NOT_SELLING_POINTS.has(attribute.name) ? [{ attribute, value }] : [],
  );
  const origin = brief.attributes.country_of_origin;
  // Yes/no answers read badly in a title; values like "750 ml" or "Queen" sell the product.
  const highlights = details.filter(({ attribute }) => !isYesNo(attribute.options)).slice(0, 2).map(({ value }) => value);

  const bullets = [
    `MATERIALS – Made from ${materials.toLowerCase()}.`,
    `SIZE – Measures ${formatDimensions(facts.dimensions)}.`,
    ...(details.length > 0
      ? [`DETAILS – ${details.map(({ attribute, value }) => `${attribute.label}: ${isYesNo(attribute.options) ? value.toLowerCase() : value}`).join("; ")}.`]
      : []),
    ...(facts.certifications.length > 0 ? [`CERTIFIED – ${listWords(facts.certifications)}.`] : []),
    `FROM ${facts.brand.toUpperCase()} – Designed by ${facts.brand}${origin ? `, made in ${origin}` : ""}.`,
  ].map((bullet) => limit(bullet, LISTING_LIMITS.bulletMaxLength));

  const title = limit([`${name} – ${materials}`, ...highlights].join(", "), LISTING_LIMITS.titleMaxLength);
  const description = limit(
    [
      `The ${name} is a ${productType.displayName.toLowerCase()} made from ${materials.toLowerCase()}.`,
      `It measures ${formatDimensions(facts.dimensions)}.`,
      ...details.map(({ attribute, value }) => `${attribute.label}: ${value}.`),
      ...(facts.certifications.length > 0 ? [`Certified ${listWords(facts.certifications)}.`] : []),
      ...(origin ? [`Made in ${origin}.`] : []),
    ].join(" "),
    LISTING_LIMITS.descriptionMaxLength,
  );
  // Search terms add what the title doesn't already say.
  const inTitle = new Set(words(title));
  const terms = [...new Set(words([productType.displayName, productType.description, ...highlights].join(" ")))].filter(
    (word) => !inTitle.has(word) && !STOP_WORDS.has(word) && word.length > 2,
  );

  return { title, bullets, description, backendKeywords: backendTerms(terms) };
}

/** What the agent writes for an attribute it may draft, or undefined to leave it out. */
function draftAttribute(name: string, copy: ListingCopy, productType: ProductType): AttributeValue | undefined {
  switch (name) {
    case LISTING_COPY_ATTRIBUTES.title:
      return copy.title;
    case LISTING_COPY_ATTRIBUTES.bullets:
      return copy.bullets;
    case LISTING_COPY_ATTRIBUTES.description:
      return copy.description || undefined;
    case LISTING_COPY_ATTRIBUTES.backendKeywords:
      return copy.backendKeywords || undefined;
    case "item_type_keyword":
      return productType.displayName.toLowerCase().replaceAll(" ", "-");
    default:
      return undefined;
  }
}

/** The reviewer's rubric for a first draft. Accuracy is full marks: the copy says only what the facts say. */
function reviewDraft(copy: ListingCopy, plan: AttributePlan[], checks: ComplianceCheck[]): { scores: RubricScores; overall: number; report: ReviewReport } {
  const keywordBytes = utf8ByteLength(copy.backendKeywords);
  const scores: RubricScores = {
    title: copy.title.length >= 60 ? 5 : 4,
    bullets: copy.bullets.length >= LISTING_LIMITS.bulletMaxCount ? 5 : copy.bullets.length >= 4 ? 4 : 3,
    description: copy.description.length >= 250 ? 4 : 3,
    keywords: keywordBytes === 0 ? 2 : keywordBytes < 60 ? 3 : 4,
    factual_accuracy: 5,
    compliance: checks.some((check) => check.status === "fail") ? 2 : checks.some((check) => check.status === "warn") ? 4 : 5,
  };
  const empty = plan.filter(({ status }) => status === "empty").map(({ attribute }) => attribute.label.toLowerCase());
  const findings: ReviewReport["findings"] = [
    ...(copy.bullets.length < LISTING_LIMITS.bulletMaxCount
      ? [{ criterion: "bullets" as const, severity: "info" as const, message: `${copy.bullets.length} of ${LISTING_LIMITS.bulletMaxCount} bullets: the facts don't cover more.` }]
      : []),
    ...(keywordBytes < 60
      ? [{ criterion: "keywords" as const, severity: "warning" as const, message: "Few search terms beyond the title; more product details would add some." }]
      : []),
    ...(empty.length > 0 ? [{ criterion: "description" as const, severity: "info" as const, message: `Recommended attributes left empty: ${empty.join(", ")}.` }] : []),
  ];
  const overall = overallScore(scores);
  return {
    scores,
    overall,
    report: {
      summary: overall >= 80 ? "Accurate to the facts and within Amazon's limits; ready for a decision." : "Accurate to the facts but thin; more product facts would strengthen it.",
      findings,
    },
  };
}

const CHECK_MARK: Record<ComplianceCheck["status"], string> = { pass: "✓", warn: "!", fail: "✗" };
const STOP_WORDS = new Set(["and", "for", "the", "with", "other", "from", "made"]);

function isYesNo(options: readonly string[] | undefined): boolean {
  return options?.length === 2 && options.includes("Yes") && options.includes("No");
}

/** ["Steel", "Bamboo", "Silicone"] → "Steel, Bamboo and Silicone" */
function listWords(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function backendTerms(terms: string[]): string {
  const kept: string[] = [];
  for (const term of terms) {
    if (utf8ByteLength([...kept, term].join(" ")) > LISTING_LIMITS.backendKeywordsMaxBytes) break;
    kept.push(term);
  }
  return kept.join(" ");
}

function copyText(copy: ListingCopy): string {
  return [
    "Title",
    copy.title,
    "",
    "Bullets",
    ...copy.bullets.map((bullet) => `• ${bullet}`),
    "",
    "Description",
    copy.description,
    "",
    "Backend search terms",
    copy.backendKeywords || "(none)",
  ].join("\n");
}

function limit(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
