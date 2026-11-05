import {
  AgentRunSchema,
  CAMPAIGN_GOALS,
  CAMPAIGN_ROLE_LABELS,
  CampaignBriefSchema,
  ProposalSchema,
  autonomyFor,
  buildCampaignStructure,
  canActOnAccount,
  checkProposalCompliance,
  guardrailsFor,
  minimumPlanBudget,
  newCampaignDiff,
  parseNewCampaignPlan,
  type Actor,
  type AgentRun,
  type AgentRunStep,
  type AuditEvent,
  type CampaignBrief,
  type CampaignRole,
  type ComplianceCheck,
  type DataFreshness,
  type Member,
  type NewCampaign,
  type Product,
  type ProductFacts,
  type Proposal,
  type ProposalRisk,
  type SellerAccount,
  type Workspace,
} from "@app/core";
import { AgentRunError } from "../data-source";
import { assertAgentsRunning, fileWithAutonomy, finalStep } from "./autonomy";
import { formatMoney, percent } from "./campaign-optimizer";

/** What a campaign strategist run reads about one seller account. */
export type StrategistStore = {
  /** For the kill switch. */
  workspace: Workspace | undefined;
  /** The member starting the run, when there is one. */
  members: readonly Member[];
  account: SellerAccount | undefined;
  /** The account's catalog. */
  products: readonly Product[];
  productFacts: readonly ProductFacts[];
  /** Strategist runs in flight on the account. */
  runningRuns: readonly AgentRun[];
  nextId: { run: () => string; proposal: () => string };
};

type AuditDraft = Omit<AuditEvent, "id">;

/** Seconds each step takes in the simulated run, in order: brief, four campaigns, guardrails, filing. */
const STEP_SECONDS = [3, 5, 6, 4, 4, 3, 1] as const;
const ROLES: CampaignRole[] = ["auto_discovery", "research", "performance", "product_targeting"];

/**
 * Plans the campaigns for a brief from the New campaign wizard and returns the run running, with
 * the audit event to record. The run's plan steps hold the brief and each campaign, which
 * completeCampaignStrategistRun files as one new_campaign Proposal.
 */
export function startCampaignStrategistRun(
  store: StrategistStore,
  { sellerAccountId, memberId, brief: input, at }: { sellerAccountId: string; memberId: string; brief: CampaignBrief; at: Date },
): { run: AgentRun; events: AuditDraft[] } {
  const { account } = store;
  if (!account || account.id !== sellerAccountId) throw new AgentRunError("not_found", "That seller account doesn't exist.");
  const member = store.members.find((candidate) => candidate.id === memberId);
  if (!member || !canActOnAccount(member, { workspaceId: account.workspaceId, sellerAccountId: account.id })) {
    throw new AgentRunError("forbidden", "You don't have permission to run agents on this account.");
  }
  assertAgentsRunning(store.workspace);

  const parsed = CampaignBriefSchema.safeParse(input);
  if (!parsed.success) throw new AgentRunError("invalid_input", "Pick products, a goal, a daily budget and a target ACoS.");
  const brief = { ...parsed.data, productIds: [...new Set(parsed.data.productIds)] };
  const productById = new Map(store.products.map((product) => [product.id, product]));
  const advertised = brief.productIds.map((id) => productById.get(id));
  if (advertised.some((product) => product?.sellerAccountId !== account.id)) {
    throw new AgentRunError("invalid_input", "Every product must be in this seller account's catalog.");
  }
  if (advertised.some((product) => product?.status !== "active")) throw new AgentRunError("invalid_input", "Only active products can be advertised.");
  if (store.runningRuns.length > 0) throw new AgentRunError("conflict", "The strategist is already planning campaigns for this account.");

  const guardrails = guardrailsFor(account);
  const structure = buildCampaignStructure({ brief, products: store.products, productFacts: store.productFacts, guardrails });
  if (brief.dailyBudget < minimumPlanBudget(structure.campaigns.length)) {
    throw new AgentRunError("invalid_input", `A daily budget of at least ${minimumPlanBudget(structure.campaigns.length)} gives each campaign Amazon's minimum.`);
  }

  const id = store.nextId.run();
  const diff = newCampaignDiff(brief, structure.campaigns);
  const checks = checkProposalCompliance({ type: "new_campaign", diff, guardrails });
  const money = (amount: number) => formatMoney(amount, account.currency);
  const goal = CAMPAIGN_GOALS[brief.goal];
  const names = advertised.map((product) => product!.title);

  let clock = at.getTime();
  const timed = (i: number) => {
    const from = clock;
    clock += STEP_SECONDS[i]! * 1000;
    return { id: `${id}_s${i + 1}`, startedAt: new Date(from).toISOString(), finishedAt: new Date(clock).toISOString() };
  };
  const agent = "campaign_strategist" as const;
  const campaignFor = (role: CampaignRole) => structure.campaigns.findIndex((campaign) => campaign.role === role);

  const steps: AgentRunStep[] = [
    {
      ...timed(0),
      kind: "plan",
      agent,
      title: "Read the brief",
      text: [
        `Goal: ${goal.label}. ${goal.description}`,
        `Advertising ${names.length === 1 ? names[0] : `${names.length} products`} at ${money(structure.averagePrice)} on average.`,
        brief.breakEvenAcos === undefined
          ? `Target ACoS ${percent(brief.targetAcos)}.`
          : `Target ACoS ${percent(brief.targetAcos)} against a ${percent(brief.breakEvenAcos)} breakeven.`,
        `Base bid ${money(structure.baseBid)}: the most a click can cost at target ACoS, assuming 1 in 10 clicks orders until there's data.`,
      ].join("\n"),
      changes: [diff[0]!],
    },
    ...ROLES.map((role, i): AgentRunStep => {
      const index = campaignFor(role);
      const campaign = structure.campaigns[index];
      return {
        ...timed(i + 1),
        kind: "plan",
        agent,
        title: CAMPAIGN_ROLE_LABELS[role],
        text: campaign
          ? describeCampaign(campaign, money)
          : `Skipped: ${structure.skipped.find((skip) => skip.role === role)?.reason ?? "nothing to build."}`,
        changes: campaign ? [diff[index + 1]!] : [],
      };
    }),
    {
      ...timed(5),
      kind: "compliance_check",
      title: "Guardrail check",
      text: [`Running ${checks.length} guardrail checks on the plan.`, ...checks.map((check) => `${CHECK_MARK[check.status]} ${check.label}${check.detail ? ` – ${check.detail}` : ""}`)].join("\n"),
      checks,
    },
    {
      ...timed(6),
      kind: "awaiting_approval",
      title: "Awaiting approval",
      text: `Created a plan for ${structure.campaigns.length} new campaigns at ${money(brief.dailyBudget)} a day. Nothing is created on Amazon until a member approves it.`,
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
    subject: { type: "seller_account", id: account.id },
    summary: `Planning new campaigns for ${names.length === 1 ? names[0] : `${names.length} products`}.`,
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
        metadata: { trigger: "manual", requestedBy: memberId, goal: brief.goal, products: brief.productIds.length },
      },
    ],
  };
}

/**
 * Files a running strategist run's plan as one pending new_campaign Proposal, as the account's
 * autonomy allows. Nothing is created on Amazon here.
 */
export function completeCampaignStrategistRun(
  store: StrategistStore,
  run: AgentRun,
  at: string,
): { run: AgentRun; proposal?: Proposal; events: AuditDraft[] } {
  if (run.agent !== "campaign_strategist" || run.subject?.type !== "seller_account") {
    throw new AgentRunError("conflict", "Only campaign strategist runs can be completed here.");
  }
  const { account } = store;
  if (!account || account.id !== run.subject.id) throw new AgentRunError("not_found", "The seller account this run planned for is no longer available.");
  assertAgentsRunning(store.workspace);

  const diff = (run.steps ?? []).flatMap((step) => (step.kind === "plan" ? step.changes : []));
  const { brief, campaigns } = parseNewCampaignPlan(diff);
  if (!brief || campaigns.length === 0) throw new AgentRunError("conflict", "This run has no plan to file.");

  const strategist: Actor = { type: "agent", agent: "campaign_strategist", agentRunId: run.id };
  const money = (amount: number) => formatMoney(amount, account.currency);
  const goal = CAMPAIGN_GOALS[brief.goal];
  const guardrails = guardrailsFor(account);
  const checks: ComplianceCheck[] = checkProposalCompliance({ type: "new_campaign", diff, guardrails });
  // New campaigns always spend; spending at a loss on purpose is the riskier kind.
  const risk: ProposalRisk = brief.breakEvenAcos !== undefined && brief.targetAcos > brief.breakEvenAcos ? "high" : "medium";
  const advertised = store.products.filter((product) => brief.productIds.includes(product.id));
  const subject = advertised.length === 1 ? advertised[0]!.title : `${brief.productIds.length} products`;
  const keywords = new Set(
    campaigns.flatMap((campaign) => campaign.adGroups.flatMap((adGroup) => adGroup.targets.flatMap((target) => (target.kind === "keyword" ? [target.keyword] : [])))),
  ).size;

  const factsAsOf = store.productFacts
    .filter((facts) => brief.productIds.includes(facts.productId))
    .reduce((oldest, facts) => (facts.updatedAt < oldest ? facts.updatedAt : oldest), run.startedAt);
  const freshness: DataFreshness[] = [{ source: "product_facts", asOf: factsAsOf }];

  const proposal = ProposalSchema.parse({
    id: store.nextId.proposal(),
    workspaceId: run.workspaceId,
    sellerAccountId: run.sellerAccountId,
    type: "new_campaign",
    status: "pending_approval",
    risk,
    title: `New campaigns for ${subject}`,
    rationale: [
      `${goal.label} goal: target ACoS ${percent(brief.targetAcos)}${brief.breakEvenAcos === undefined ? "" : ` against a ${percent(brief.breakEvenAcos)} breakeven`}.`,
      `${campaigns.length} Sponsored Products campaigns share ${money(brief.dailyBudget)} a day: ${campaigns.map((campaign) => `${CAMPAIGN_ROLE_LABELS[campaign.role].toLowerCase()} ${money(campaign.dailyBudget)}`).join(", ")}.`,
      keywords > 0 ? `${keywords} keywords from ProductFacts, funneled so each query is bought in one campaign.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    target: { type: "seller_account", id: account.id },
    diff,
    scores: { confidence: keywords > 0 ? 75 : 60, impact: Math.min(90, 40 + 10 * campaigns.length) },
    freshness,
    createdBy: strategist,
    createdAt: at,
  });

  const filed = fileWithAutonomy(proposal, autonomyFor(account, "new_campaign"), checks, at);
  const filedProposal = filed.outcome === "suggested" ? undefined : filed.proposal;
  const finished = AgentRunSchema.parse({
    ...run,
    status: "succeeded",
    finishedAt: at,
    summary: filedProposal
      ? `Planned ${campaigns.length} new campaigns for ${subject}.`
      : `Suggested ${campaigns.length} new campaigns for ${subject}; L0 files nothing.`,
    proposalIds: filedProposal ? [filedProposal.id] : [],
    steps: finalStep(run.steps, filed, "new campaigns"),
  });
  const ran: AuditDraft = {
    workspaceId: run.workspaceId,
    sellerAccountId: run.sellerAccountId,
    at,
    actor: strategist,
    action: "agent_run.finished",
    entity: { type: "agent_run", id: run.id },
    metadata: { status: "succeeded", proposals: filedProposal ? 1 : 0 },
  };
  if (filed.outcome === "suggested") return { run: finished, events: [ran] };
  return { run: finished, proposal: filed.proposal, events: [ran, ...filed.events] };
}

function describeCampaign(campaign: NewCampaign, money: (amount: number) => string): string {
  const lines = [`${campaign.name}: ${campaign.targetingType} targeting, ${money(campaign.dailyBudget)} a day, ${campaign.biddingStrategy.replaceAll("_", " ")} bidding.`];
  for (const adGroup of campaign.adGroups) {
    const kinds = adGroup.targets.map((target) =>
      target.kind === "keyword" ? `"${target.keyword}" ${money(target.bid)}` : target.kind === "product" ? `ASIN ${target.asin} ${money(target.bid)}` : `${target.autoType.replace("_", " ")} ${money(target.bid)}`,
    );
    lines.push("", `– ${adGroup.name} (default bid ${money(adGroup.defaultBid)}): ${kinds.slice(0, 6).join(", ")}${kinds.length > 6 ? `, and ${kinds.length - 6} more` : ""}.`);
    if (adGroup.negativeKeywords.length > 0) lines.push(`  Negates ${adGroup.negativeKeywords.length} exact keywords the performance campaign buys.`);
  }
  return lines.join("\n");
}

const CHECK_MARK: Record<ComplianceCheck["status"], string> = { pass: "✓", warn: "!", fail: "✗" };
