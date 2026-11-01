import {
  AgentRunSchema,
  ProposalSchema,
  autonomyFor,
  canActOnAccount,
  checkProposalCompliance,
  guardrailsFor,
  type Actor,
  type AdGroup,
  type AdMetricsDaily,
  type AgentRun,
  type AuditEvent,
  type Campaign,
  type DataFreshness,
  type Member,
  type Product,
  type ProductFacts,
  type Proposal,
  type ProposalRisk,
  type SellerAccount,
  type Target,
  type Workspace,
} from "@app/core";
import { AgentRunError, type DateRange } from "../data-source";
import { assertAgentsRunning, fileWithAutonomy, finalStep } from "./autonomy";
import { adPerformance, countPlanChanges, formatMoney, percent, planCampaignOptimizerRun } from "./campaign-optimizer";

/** What a campaign optimizer run reads about one campaign and its seller account. */
export type CampaignRunStore = {
  /** For the kill switch. */
  workspace: Workspace | undefined;
  /** The member starting the run, when there is one. */
  members: readonly Member[];
  account: SellerAccount | undefined;
  campaign: Campaign | undefined;
  /** The account's advertising, for negatives that funnel traffic between campaigns. */
  campaigns: readonly Campaign[];
  adGroups: readonly AdGroup[];
  targets: readonly Target[];
  products: readonly Product[];
  productFacts: readonly ProductFacts[];
  /** The analysis window, and the campaign's target rows over it. */
  window: DateRange | undefined;
  metrics: readonly AdMetricsDaily[];
  /** Pending campaign plans for the campaign. */
  pendingPlans: readonly Proposal[];
  /** Runs in flight on the campaign. */
  runningRuns: readonly AgentRun[];
  nextId: { run: () => string; proposal: () => string };
};

type AuditDraft = Omit<AuditEvent, "id">;

/** Spend-increasing changes (raised bids, new keywords) at which a plan counts as high risk. */
const HIGH_RISK_INCREASES = 10;

/** Plans a campaign optimizer run and returns it running, with the audit event to record. */
export function startCampaignOptimizerRun(
  store: CampaignRunStore,
  { campaignId, memberId, at }: { campaignId: string; memberId: string; at: Date },
): { run: AgentRun; events: AuditDraft[] } {
  const { account, campaign } = store;
  if (!campaign || !account || campaign.id !== campaignId) throw new AgentRunError("not_found", "That campaign doesn't exist.");

  const member = store.members.find((candidate) => candidate.id === memberId);
  if (!member || !canActOnAccount(member, { workspaceId: account.workspaceId, sellerAccountId: account.id })) {
    throw new AgentRunError("forbidden", "You don't have permission to run agents on this account.");
  }
  assertAgentsRunning(store.workspace);
  if (campaign.state !== "enabled") throw new AgentRunError("conflict", "Only enabled campaigns can be optimized.");
  if (!store.window) throw new AgentRunError("conflict", "This campaign has no ad metrics to work from yet.");
  if (store.runningRuns.length > 0) throw new AgentRunError("conflict", "The optimizer is already running on this campaign.");
  if (store.pendingPlans.length > 0) throw new AgentRunError("conflict", "A plan for this campaign is already waiting for approval.");

  const id = store.nextId.run();
  const plan = planCampaignOptimizerRun({ ...store, runId: id, account, campaign, window: store.window, startedAt: at.getTime() });
  const run = AgentRunSchema.parse({
    id,
    workspaceId: account.workspaceId,
    sellerAccountId: account.id,
    agent: "campaign_optimizer",
    status: "running",
    autonomyLevel: account.autonomyLevel,
    trigger: "manual",
    subject: { type: "campaign", id: campaign.id },
    summary: `Planning bids, keywords and negatives for ${campaign.name}.`,
    proposalIds: [],
    steps: plan.steps,
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
 * Files a running campaign optimizer run's output: the changes its steps found, as one pending
 * campaign_plan Proposal. A run that found nothing finishes without one. Nothing changes on Amazon here.
 */
export function completeCampaignOptimizerRun(
  store: CampaignRunStore,
  run: AgentRun,
  at: string,
): { run: AgentRun; proposal?: Proposal; events: AuditDraft[] } {
  if (run.agent !== "campaign_optimizer" || run.subject?.type !== "campaign") {
    throw new AgentRunError("conflict", "Only campaign optimizer runs can be completed here.");
  }
  const { account, campaign } = store;
  if (!account || !campaign || campaign.id !== run.subject.id) {
    throw new AgentRunError("not_found", "The campaign this run worked on is no longer available.");
  }
  assertAgentsRunning(store.workspace);

  const diff = (run.steps ?? []).flatMap((step) => (step.kind === "plan" ? step.changes : []));
  const optimizer: Actor = { type: "agent", agent: "campaign_optimizer", agentRunId: run.id };
  const base = { workspaceId: run.workspaceId, sellerAccountId: run.sellerAccountId, at, actor: optimizer };

  if (diff.length === 0) {
    const finished = AgentRunSchema.parse({ ...run, status: "succeeded", finishedAt: at, summary: "No changes recommended." });
    return {
      run: finished,
      events: [{ ...base, action: "agent_run.finished", entity: { type: "agent_run", id: run.id }, metadata: { status: "succeeded", proposals: 0 } }],
    };
  }

  const money = (amount: number) => formatMoney(amount, account.currency);
  const counts = countPlanChanges(diff);
  const performance = adPerformance(store.metrics);
  const increases = counts.raised + counts.keywords;
  const risk: ProposalRisk = increases === 0 ? "low" : increases >= HIGH_RISK_INCREASES ? "high" : "medium";
  const parts = [
    counts.lowered > 0 && `lowers ${plural(counts.lowered, "bid")}`,
    counts.raised > 0 && `raises ${plural(counts.raised, "bid")}`,
    counts.keywords > 0 && `adds ${plural(counts.keywords, "keyword")} from ProductFacts`,
    counts.negatives > 0 && `negates ${plural(counts.negatives, "keyword")} a manual campaign already targets`,
  ].filter((part): part is string => typeof part === "string");

  const advertised = new Set(
    store.adGroups.filter((adGroup) => adGroup.campaignId === campaign.id).flatMap((adGroup) => adGroup.productIds),
  );
  const factsAsOf = store.productFacts
    .filter((facts) => advertised.has(facts.productId))
    .reduce((oldest, facts) => (facts.updatedAt < oldest ? facts.updatedAt : oldest), run.startedAt);
  const freshness: DataFreshness[] = [
    { source: "ad_metrics", asOf: run.startedAt },
    ...(counts.keywords > 0 ? [{ source: "product_facts" as const, asOf: factsAsOf }] : []),
  ];

  const proposal = ProposalSchema.parse({
    id: store.nextId.proposal(),
    workspaceId: run.workspaceId,
    sellerAccountId: run.sellerAccountId,
    type: "campaign_plan",
    status: "pending_approval",
    risk,
    title: `Campaign plan for ${campaign.name}`,
    rationale: [
      performance.acos === undefined
        ? `No ad sales in the last 30 days on ${money(performance.spend)} spend.`
        : `30-day ACoS is ${percent(performance.acos)} against the ${percent(account.targetAcos)} target on ${money(performance.spend)} spend.`,
      `The plan ${joinParts(parts)}.`,
    ].join(" "),
    target: { type: "campaign", id: campaign.id },
    diff,
    scores: { confidence: 80, impact: Math.min(90, 35 + 5 * diff.length) },
    freshness,
    createdBy: optimizer,
    createdAt: at,
  });

  const checks = checkProposalCompliance({ type: "campaign_plan", diff, guardrails: guardrailsFor(account) });
  const filed = fileWithAutonomy(proposal, autonomyFor(account, "campaign_plan"), checks, at);
  const filedProposal = filed.outcome === "suggested" ? undefined : filed.proposal;
  const finished = AgentRunSchema.parse({
    ...run,
    status: "succeeded",
    finishedAt: at,
    summary: filedProposal
      ? `Planned ${plural(diff.length, "change")} for ${campaign.name}.`
      : `Suggested ${plural(diff.length, "change")} for ${campaign.name}; L0 files nothing.`,
    proposalIds: filedProposal ? [filedProposal.id] : [],
    steps: finalStep(run.steps, filed, "campaign plans"),
  });
  const ran: AuditDraft = {
    ...base,
    action: "agent_run.finished",
    entity: { type: "agent_run", id: run.id },
    metadata: { status: "succeeded", proposals: filedProposal ? 1 : 0 },
  };
  if (filed.outcome === "suggested") return { run: finished, events: [ran] };
  return { run: finished, proposal: filed.proposal, events: [ran, ...filed.events] };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function joinParts(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
