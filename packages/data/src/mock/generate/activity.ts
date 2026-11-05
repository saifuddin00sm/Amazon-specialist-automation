import {
  FRESHNESS_MAX_AGE_HOURS,
  overallScore,
  type Actor,
  type AdMetricsDaily,
  type AgentName,
  type AgentRun,
  type AuditEvent,
  type Currency,
  type DataFreshness,
  type DiffEntry,
  type FreshnessSource,
  type ListingVersion,
  type Member,
  type MetricsDaily,
  type Proposal,
  type ProposalRisk,
  type Review,
  type RubricCriterion,
  type RubricScores,
  type SellerAccount,
  type Target,
  type Workspace,
} from "@app/core";
import { DAY_MS, HOUR_MS, MINUTE_MS, round2, type GeneratorContext } from "../context";
import { NEGATIVE_MODIFIERS, REJECTION_NOTES, RUN_ERRORS, keywordIdeas } from "../vocabulary";
import type { Advertising } from "./advertising";
import { agentListing, type Catalog } from "./catalog";
import { BUDGET_CAPPED_SHARE } from "./metrics";
import type { Organizations } from "./organizations";

export type Activity = {
  agentRuns: AgentRun[];
  reviews: Review[];
  proposals: Proposal[];
  auditEvents: AuditEvent[];
};

const PENDING_WINDOW_DAYS = 6;
const RUN_CADENCE_DAYS = { listing_writer: 7, bid_optimizer: 3, keyword_harvester: 7, budget_pacer: 7 } as const;
const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", CAD: "CA$", MXN: "MX$", GBP: "£", EUR: "€", JPY: "¥" };

const FINDING_MESSAGES: Record<RubricCriterion, string> = {
  title: "Title is missing the primary keyword near the front.",
  bullets: "Bullets repeat the same benefit; lead with differentiators.",
  description: "Description is thin; add use cases and care instructions.",
  keywords: "Backend keywords leave out high-volume search terms.",
  factual_accuracy: "Some claims could point to ProductFacts more directly.",
  compliance: "Wording is close to restricted claim language.",
};

type ListingIssue = "none" | "prohibited_claim" | "unsupported_claim";

export function generateActivity(
  ctx: GeneratorContext,
  orgs: Organizations,
  catalog: Catalog,
  ads: Advertising,
  metrics: MetricsDaily[],
): Activity {
  const { rng, clock, nextId } = ctx;
  const agentRuns: AgentRun[] = [];
  const reviews: Review[] = [];
  const proposals: Proposal[] = [];
  /** Agent-written listing version behind each listing_update proposal. */
  const proposalVersion = new Map<string, ListingVersion>();
  const stats = summarizeMetrics(clock.dates, metrics);

  const workspaceById = new Map(orgs.workspaces.map((workspace) => [workspace.id, workspace]));
  const campaignById = new Map(ads.campaigns.map((campaign) => [campaign.id, campaign]));
  const factsByProduct = new Map(catalog.productFacts.map((facts) => [facts.productId, facts]));

  const agentActor = (run: AgentRun): Actor => ({ type: "agent", agent: run.agent, agentRunId: run.id });
  const succeeded = (runs: AgentRun[]) => runs.filter((run) => run.status === "succeeded");
  const finishedMs = (run: AgentRun) => Date.parse(run.finishedAt ?? run.startedAt);

  const addRun = (
    account: SellerAccount,
    agent: AgentName,
    startMs: number,
    trigger: AgentRun["trigger"],
    canFail = true,
  ) => {
    const failed = canFail && rng.chance(0.07);
    const run: AgentRun = {
      id: nextId("run"),
      workspaceId: account.workspaceId,
      sellerAccountId: account.id,
      agent,
      status: failed ? "failed" : "succeeded",
      autonomyLevel: account.autonomyLevel,
      trigger,
      summary: "",
      proposalIds: [],
      startedAt: clock.iso(startMs),
      finishedAt: clock.iso(startMs + rng.int(2, 25) * MINUTE_MS),
      ...(failed ? { error: rng.pick(RUN_ERRORS) } : {}),
    };
    agentRuns.push(run);
    return run;
  };

  const scheduleRuns = (account: SellerAccount, agent: keyof typeof RUN_CADENCE_DAYS) => {
    const cadence = RUN_CADENCE_DAYS[agent];
    const runs: AgentRun[] = [];
    for (let daysAgo = 28 + rng.int(0, cadence - 1); daysAgo >= 0; daysAgo -= cadence) {
      const startMs = clock.daysAgo(daysAgo, rng.int(5, 8)) + rng.int(0, 59) * MINUTE_MS;
      runs.push(addRun(account, agent, startMs, rng.chance(0.15) ? "manual" : "schedule"));
    }
    return runs;
  };

  const decide = (
    account: SellerAccount,
    risk: ProposalRisk,
    createdMs: number,
  ): Pick<Proposal, "status" | "decidedBy" | "decidedAt" | "decisionNote" | "appliedAt"> => {
    const autoApproves = account.autonomyLevel === "L2" || account.autonomyLevel === "L3";
    if (autoApproves && risk === "low") {
      const decidedMs = createdMs + MINUTE_MS;
      return {
        status: "applied",
        decidedBy: { type: "system" },
        decidedAt: clock.iso(decidedMs),
        decisionNote: `Auto-approved under ${account.autonomyLevel} guardrails.`,
        appliedAt: clock.iso(decidedMs + rng.int(1, 10) * MINUTE_MS),
      };
    }
    if (clock.now - createdMs < PENDING_WINDOW_DAYS * DAY_MS) return { status: "pending_approval" };

    const status = rng.weighted([
      { weight: 55, value: "applied" as const },
      { weight: 20, value: "rejected" as const },
      { weight: 10, value: "pending_approval" as const },
      { weight: 5, value: "approved" as const },
      { weight: 5, value: "failed" as const },
      { weight: 5, value: "superseded" as const },
    ]);
    if (status === "pending_approval" || status === "superseded") return { status };

    const decidedMs = createdMs + rng.int(1, 48) * 60 * MINUTE_MS;
    return {
      status,
      decidedBy: { type: "member", memberId: decider(orgs.members, workspaceById.get(account.workspaceId), account, risk, rng.pick).id },
      decidedAt: clock.iso(decidedMs),
      ...(status === "rejected" ? { decisionNote: rng.pick(REJECTION_NOTES) } : {}),
      ...(status === "applied" ? { appliedAt: clock.iso(decidedMs + rng.int(2, 60) * MINUTE_MS) } : {}),
    };
  };

  /** When an input the run read was last refreshed. About one in ten is past its freshness limit. */
  const inputAsOf = (run: AgentRun, source: FreshnessSource): DataFreshness => {
    const limit = FRESHNESS_MAX_AGE_HOURS[source];
    const hours = rng.chance(0.1) ? rng.int(Math.ceil(limit * 1.2), limit * 2) : rng.int(1, Math.floor(limit * 0.6));
    return { source, asOf: clock.iso(Date.parse(run.startedAt) - hours * HOUR_MS) };
  };

  const addProposal = (
    run: AgentRun,
    account: SellerAccount,
    createdMs: number,
    fields: Pick<Proposal, "type" | "risk" | "title" | "rationale" | "target" | "diff" | "scores" | "freshness"> & {
      reviewId?: string;
    },
  ) => {
    const proposal: Proposal = {
      id: nextId("prop"),
      workspaceId: account.workspaceId,
      sellerAccountId: account.id,
      ...fields,
      ...decide(account, fields.risk, createdMs),
      createdBy: agentActor(run),
      createdAt: clock.iso(createdMs),
    };
    run.proposalIds.push(proposal.id);
    proposals.push(proposal);
    return proposal;
  };

  const addReview = (
    version: ListingVersion,
    quality: "strong" | "ok" | "weak",
    issue: ListingIssue,
    claim: string | undefined,
    reviewerRun: AgentRun,
  ) => {
    const [low, high] = { strong: [4, 5], ok: [3, 4], weak: [2, 3] }[quality] as [number, number];
    const scores: RubricScores = {
      title: rng.int(low, high),
      bullets: rng.int(low, high),
      description: rng.int(low, high),
      keywords: rng.int(low, high),
      factual_accuracy: issue === "unsupported_claim" ? 2 : rng.int(low, high),
      compliance: issue === "prohibited_claim" ? 1 : rng.int(Math.max(low, 3), 5),
    };
    const findings = (Object.entries(scores) as [RubricCriterion, number][])
      .filter(([, score]) => score <= 3)
      .map(([criterion, score]) =>
        criterion === "compliance" && issue === "prohibited_claim"
          ? { criterion, severity: "error" as const, message: `Uses the prohibited claim "${claim}".` }
          : criterion === "factual_accuracy" && issue === "unsupported_claim"
            ? { criterion, severity: "warning" as const, message: "States a capacity that is not in ProductFacts." }
            : { criterion, severity: score <= 2 ? ("warning" as const) : ("info" as const), message: FINDING_MESSAGES[criterion] },
      );
    const overall = overallScore(scores);
    const verdict =
      overall >= 80 ? "Strong listing; ready to publish." : overall >= 60 ? "Solid draft with a few gaps to close." : "Needs work before it goes live.";
    const review: Review = {
      id: nextId("rev"),
      listingVersionId: version.id,
      scores,
      overall,
      report: {
        summary: findings.some((finding) => finding.severity === "error") ? `Blocked by a compliance issue. ${verdict}` : verdict,
        findings,
      },
      reviewer: agentActor(reviewerRun),
      createdAt: clock.iso(finishedMs(reviewerRun)),
    };
    reviews.push(review);
    return review;
  };

  for (const plan of orgs.plans) {
    const { account } = plan;
    const money = (amount: number) => `${CURRENCY_SYMBOL[account.currency]}${amount.toFixed(2)}`;
    const accountProducts = catalog.products.filter((product) => product.sellerAccountId === account.id);
    const accountCampaigns = ads.campaigns.filter((campaign) => campaign.sellerAccountId === account.id);
    const accountAdGroups = ads.adGroups.filter((adGroup) => campaignById.get(adGroup.campaignId)?.sellerAccountId === account.id);
    const accountAdGroupIds = new Set(accountAdGroups.map((adGroup) => adGroup.id));
    const accountTargets = ads.targets.filter((target) => accountAdGroupIds.has(target.adGroupId));

    const writerRuns = scheduleRuns(account, "listing_writer");
    const bidRuns = scheduleRuns(account, "bid_optimizer");
    const harvesterRuns = scheduleRuns(account, "keyword_harvester");
    const pacerRuns = scheduleRuns(account, "budget_pacer");

    // Each successful writer run hands its drafts to the reviewer.
    const reviewerFor = new Map<string, AgentRun>();
    for (const writerRun of succeeded(writerRuns)) {
      reviewerFor.set(writerRun.id, addRun(account, "listing_reviewer", finishedMs(writerRun) + MINUTE_MS, "event", false));
    }

    // Weekly audit: the reviewer scores a sample of live, human-written listings.
    const auditRun = addRun(account, "listing_reviewer", clock.daysAgo(rng.int(2, 6), 4), "schedule");
    if (auditRun.status === "succeeded") {
      for (const product of rng.shuffle(accountProducts).slice(0, Math.round(accountProducts.length * 0.3))) {
        const live = liveVersion(catalog.listingVersions, product.id);
        if (live) addReview(live, rng.weighted([{ weight: 40, value: "weak" as const }, { weight: 45, value: "ok" as const }, { weight: 15, value: "strong" as const }]), "none", undefined, auditRun);
      }
    }

    // listing_writer: rewrites for about a fifth of active products.
    const activeProducts = accountProducts.filter((product) => product.status === "active");
    for (const product of rng.shuffle(activeProducts).slice(0, Math.round(activeProducts.length * 0.22))) {
      const writerRun = pickRun(rng.pick, succeeded(writerRuns));
      const reviewerRun = writerRun && reviewerFor.get(writerRun.id);
      const profile = catalog.profiles.get(product.id);
      const facts = factsByProduct.get(product.id);
      const live = liveVersion(catalog.listingVersions, product.id);
      if (!writerRun || !reviewerRun || !profile || !facts || !live) continue;

      const issue = rng.weighted([
        { weight: 75, value: "none" as const },
        { weight: 15, value: "prohibited_claim" as const },
        { weight: 10, value: "unsupported_claim" as const },
      ]);
      const claim = facts.prohibitedClaims[0];
      const copy = agentListing(plan.brand, profile, {
        ...(issue === "prohibited_claim" && claim ? { prohibitedClaim: claim } : {}),
        unsupportedClaim: issue === "unsupported_claim",
      });
      const versions = catalog.listingVersions.filter((version) => version.productId === product.id);
      const draft: ListingVersion = {
        id: nextId("lv"),
        productId: product.id,
        version: Math.max(...versions.map((version) => version.version)) + 1,
        status: "proposed",
        ...copy,
        createdBy: agentActor(writerRun),
        createdAt: clock.iso(finishedMs(writerRun)),
      };
      catalog.listingVersions.push(draft);

      const review = addReview(draft, issue === "none" ? rng.pick(["strong", "strong", "ok"] as const) : "ok", issue, claim, reviewerRun);
      const severities = new Set(review.report.findings.map((finding) => finding.severity));
      const risk: ProposalRisk = severities.has("error")
        ? "high"
        : severities.has("warning") || review.overall < 70
          ? "medium"
          : "low";
      const liveText = [live.title, ...live.bullets].join(" ").toLowerCase();
      const draftText = [draft.title, ...draft.bullets, draft.backendKeywords].join(" ").toLowerCase();
      const gained = facts.targetKeywords.filter((keyword) => !liveText.includes(keyword) && draftText.includes(keyword));
      const diff: DiffEntry[] = (["title", "bullets", "description", "backendKeywords"] as const)
        .filter((field) => JSON.stringify(live[field]) !== JSON.stringify(draft[field]))
        .map((field) => ({ path: field, before: live[field], after: draft[field] }));

      const proposal = addProposal(writerRun, account, finishedMs(reviewerRun), {
        type: "listing_update",
        risk,
        title: `Rewrite listing for ${product.brand} ${profile.noun} (${profile.color})`,
        rationale: `The draft adds ${gained.length} target keywords missing from the live copy and expands bullets from ${live.bullets.length} to ${draft.bullets.length}.`,
        target: { type: "product", id: product.id },
        diff,
        scores: { confidence: issue === "none" ? rng.int(70, 95) : rng.int(45, 70), impact: rng.int(30, 80), rubric: review.overall },
        freshness: [
          inputAsOf(writerRun, "live_listing"),
          { source: "product_facts", asOf: facts.updatedAt < writerRun.startedAt ? facts.updatedAt : writerRun.startedAt },
        ],
        reviewId: review.id,
      });
      proposalVersion.set(proposal.id, draft);

      if (proposal.status === "applied") {
        draft.status = "live";
        live.status = "superseded";
        product.title = draft.title;
      } else if (proposal.status === "rejected" || proposal.status === "superseded") {
        draft.status = "rejected";
      }
    }

    // bid_optimizer: bring ACoS toward the account's target and pause targets that never convert.
    const targetAcos = account.targetAcos;
    const positive = accountTargets.filter((target) => !target.negative && target.state === "enabled" && target.bid !== undefined);
    const lower: Target[] = [];
    const raise: Target[] = [];
    const pause: Target[] = [];
    for (const target of rng.shuffle(positive)) {
      const s = stats.target.get(target.id);
      if (!s) continue;
      const acos = s.sales14 > 0 ? s.spend14 / s.sales14 : Infinity;
      if (s.spend14 >= 5 && s.orders14 >= 1 && acos > targetAcos * 1.5) lower.push(target);
      else if (s.orders14 >= 3 && acos < targetAcos * 0.6) raise.push(target);
      else if (s.spend30 >= 15 && s.orders30 === 0) pause.push(target);
    }
    for (const target of [...lower.slice(0, 5), ...raise.slice(0, 3)]) {
      const run = pickRun(rng.pick, succeeded(bidRuns));
      const s = stats.target.get(target.id);
      if (!run || !s || target.bid === undefined) continue;
      const acos = s.spend14 / s.sales14;
      const isLower = lower.includes(target);
      const change = isLower ? -Math.min(0.4, Math.max(0.1, 1 - targetAcos / acos)) : rng.float(0.1, 0.25);
      const after = Math.max(0.2, round2(target.bid * (1 + change)));
      const magnitude = Math.abs(change);
      const proposal = addProposal(run, account, finishedMs(run), {
        type: "bid_change",
        risk: magnitude <= 0.15 ? "low" : magnitude <= 0.3 ? "medium" : "high",
        title: `${isLower ? "Lower" : "Raise"} bid on ${targetLabel(target)}`,
        rationale: isLower
          ? `14-day ACoS is ${percent(acos)} on ${money(s.spend14)} spend, above the ${percent(targetAcos)} target.`
          : `14-day ACoS is ${percent(acos)} with ${s.orders14} orders; there is room to win more impressions.`,
        target: { type: "target", id: target.id },
        diff: [{ path: "bid", before: target.bid, after }],
        scores: { confidence: rng.int(55, 92), impact: rng.int(20, 70) },
        freshness: [inputAsOf(run, "ad_metrics")],
      });
      if (proposal.status === "applied") target.bid = after;
    }
    for (const target of pause.slice(0, 3)) {
      const run = pickRun(rng.pick, succeeded(bidRuns));
      const s = stats.target.get(target.id);
      if (!run || !s) continue;
      const proposal = addProposal(run, account, finishedMs(run), {
        type: "target_pause",
        risk: "low",
        title: `Pause ${targetLabel(target)}`,
        rationale: `Spent ${money(s.spend30)} over 30 days with no orders.`,
        target: { type: "target", id: target.id },
        diff: [{ path: "state", before: "enabled", after: "paused" }],
        scores: { confidence: rng.int(70, 95), impact: rng.int(15, 45) },
        freshness: [inputAsOf(run, "ad_metrics")],
      });
      if (proposal.status === "applied") target.state = "paused";
    }

    // keyword_harvester: promote converting search terms, negate wasteful ones.
    const autoGroups = accountAdGroups.filter((adGroup) => campaignById.get(adGroup.campaignId)?.targetingType === "auto");
    const manualGroups = accountAdGroups.filter(
      (adGroup) => campaignById.get(adGroup.campaignId)?.name.endsWith("SP Keywords") ?? false,
    );
    for (const autoGroup of autoGroups) {
      const keywordsIn = (adGroupId: string, negative: boolean) =>
        new Set(
          ads.targets.flatMap((target) =>
            target.adGroupId === adGroupId && target.kind === "keyword" && target.negative === negative ? [target.keyword] : [],
          ),
        );
      const profiles = autoGroup.productIds.flatMap((id) => catalog.profiles.get(id) ?? []);
      const profile = profiles.length > 0 ? rng.pick(profiles) : undefined;
      const manualGroup = profile && manualGroups.find((adGroup) => adGroup.name === profile.noun);

      const harvestRun = pickRun(rng.pick, succeeded(harvesterRuns));
      if (harvestRun && profile && manualGroup) {
        const existing = keywordsIn(manualGroup.id, false);
        const keyword = keywordIdeas(profile.vocabulary, profile.noun, profile.adjective).find((idea) => !existing.has(idea));
        if (keyword) {
          const bid = round2(manualGroup.defaultBid * 1.1);
          const proposal = addProposal(harvestRun, account, finishedMs(harvestRun), {
            type: "keyword_add",
            risk: bid > 1.5 ? "medium" : "low",
            title: `Add keyword "${keyword}" (exact)`,
            rationale: `Search term "${keyword}" converted ${rng.int(3, 12)} times in the auto campaign at ${percent(rng.float(0.12, 0.3))} ACoS over 30 days.`,
            target: { type: "ad_group", id: manualGroup.id },
            diff: [{ path: "keywords", before: null, after: { keyword, matchType: "exact", bid } }],
            scores: { confidence: rng.int(60, 90), impact: rng.int(25, 65) },
            freshness: [inputAsOf(harvestRun, "search_terms")],
          });
          if (proposal.status === "applied") {
            ads.targets.push({ id: nextId("tgt"), adGroupId: manualGroup.id, state: "enabled", negative: false, bid, kind: "keyword", keyword, matchType: "exact" });
          }
        }
      }

      const negateRun = pickRun(rng.pick, succeeded(harvesterRuns));
      if (negateRun && profile && rng.chance(0.7)) {
        const negatives = keywordsIn(autoGroup.id, true);
        const term = `${profile.noun.toLowerCase()} ${rng.pick(NEGATIVE_MODIFIERS)}`;
        if (!negatives.has(term)) {
          const proposal = addProposal(negateRun, account, finishedMs(negateRun), {
            type: "keyword_negate",
            risk: "low",
            title: `Add negative keyword "${term}"`,
            rationale: `Search term "${term}" spent ${money(rng.float(12, 60))} on ${rng.int(15, 60)} clicks over 30 days with no orders.`,
            target: { type: "ad_group", id: autoGroup.id },
            diff: [{ path: "negativeKeywords", before: [...negatives], after: [...negatives, term] }],
            scores: { confidence: rng.int(70, 95), impact: rng.int(10, 40) },
            freshness: [inputAsOf(negateRun, "search_terms")],
          });
          if (proposal.status === "applied") {
            ads.targets.push({ id: nextId("tgt"), adGroupId: autoGroup.id, state: "enabled", negative: true, kind: "keyword", keyword: term, matchType: "exact" });
          }
        }
      }
    }

    // budget_pacer: lift budgets on efficient campaigns that keep running out.
    for (const campaign of accountCampaigns) {
      const s = stats.campaign.get(campaign.id);
      const run = pickRun(rng.pick, succeeded(pacerRuns));
      if (!s || !run || campaign.state !== "enabled") continue;
      const cappedDays = s.last14.filter((row) => row.spend >= campaign.dailyBudget * BUDGET_CAPPED_SHARE).length;
      const acos = s.sales14 > 0 ? s.spend14 / s.sales14 : Infinity;
      if (cappedDays < 4 || acos > 0.5) continue;
      const before = campaign.dailyBudget;
      const after = Math.round(before * (1 + rng.float(0.2, 0.5)));
      const monthlyIncrease = (after - before) * 30;
      const proposal = addProposal(run, account, finishedMs(run), {
        type: "budget_change",
        risk: monthlyIncrease > 600 ? "high" : monthlyIncrease > 150 ? "medium" : "low",
        title: `Raise daily budget for ${campaign.name}`,
        rationale: `Spent at least ${percent(BUDGET_CAPPED_SHARE)} of the ${money(before)} budget on ${cappedDays} of the last 14 days at ${percent(acos)} ACoS.`,
        target: { type: "campaign", id: campaign.id },
        diff: [{ path: "dailyBudget", before, after }],
        scores: { confidence: rng.int(60, 90), impact: rng.int(30, 75) },
        freshness: [inputAsOf(run, "ad_metrics")],
      });
      if (proposal.status === "applied") campaign.dailyBudget = after;
    }

    // One bid run is in flight right now on the first account.
    if (plan === orgs.plans[0]) {
      agentRuns.push({
        id: nextId("run"),
        workspaceId: account.workspaceId,
        sellerAccountId: account.id,
        agent: "bid_optimizer",
        status: "running",
        autonomyLevel: account.autonomyLevel,
        trigger: "manual",
        summary: "Analyzing the last 14 days of ad performance.",
        proposalIds: [],
        startedAt: clock.iso(clock.now - 12 * MINUTE_MS),
      });
    }
  }

  for (const run of agentRuns) {
    if (run.status === "running") continue;
    if (run.status === "failed") {
      run.summary = "Run failed before producing recommendations.";
      continue;
    }
    const count = run.agent === "listing_reviewer"
      ? reviews.filter((review) => review.reviewer.type === "agent" && review.reviewer.agentRunId === run.id).length
      : run.proposalIds.length;
    run.summary = runSummary(run.agent, count);
  }

  const auditEvents = buildAuditEvents(ctx, orgs, agentRuns, proposals, proposalVersion);
  const newestFirst = <T>(items: T[], at: (item: T) => string) => items.sort((a, b) => at(b).localeCompare(at(a)));

  return {
    agentRuns: newestFirst(agentRuns, (run) => run.startedAt),
    reviews: newestFirst(reviews, (review) => review.createdAt),
    proposals: newestFirst(proposals, (proposal) => proposal.createdAt),
    auditEvents,
  };
}

function buildAuditEvents(
  ctx: GeneratorContext,
  orgs: Organizations,
  agentRuns: AgentRun[],
  proposals: Proposal[],
  proposalVersion: Map<string, ListingVersion>,
): AuditEvent[] {
  const { rng, clock, nextId } = ctx;
  const events: Omit<AuditEvent, "id">[] = [];
  const ownerOf = (workspaceId: string) =>
    orgs.members.find((member) => member.workspaceId === workspaceId && member.role === "owner");

  for (const account of orgs.sellerAccounts) {
    const owner = ownerOf(account.workspaceId);
    events.push({
      workspaceId: account.workspaceId,
      sellerAccountId: account.id,
      at: account.connectedAt,
      actor: owner ? { type: "member", memberId: owner.id } : { type: "system" },
      action: "seller_account.connected",
      entity: { type: "seller_account", id: account.id },
      metadata: { marketplace: account.marketplace },
    });
  }

  for (const member of orgs.members) {
    const owner = ownerOf(member.workspaceId);
    if (!owner || member.id === owner.id) continue;
    events.push({
      workspaceId: member.workspaceId,
      at: member.createdAt,
      actor: { type: "member", memberId: owner.id },
      action: "member.invited",
      entity: { type: "member", id: member.id },
      metadata: { role: member.role, email: member.email },
    });
  }

  for (const run of agentRuns) {
    const actor: Actor = { type: "agent", agent: run.agent, agentRunId: run.id };
    const base = { workspaceId: run.workspaceId, sellerAccountId: run.sellerAccountId, actor, entity: { type: "agent_run" as const, id: run.id } };
    events.push({ ...base, at: run.startedAt, action: "agent_run.started", metadata: { trigger: run.trigger } });
    if (run.finishedAt) {
      events.push({ ...base, at: run.finishedAt, action: "agent_run.finished", metadata: { status: run.status, proposals: run.proposalIds.length } });
    }
  }

  for (const proposal of proposals) {
    const base = { workspaceId: proposal.workspaceId, sellerAccountId: proposal.sellerAccountId, entity: { type: "proposal" as const, id: proposal.id } };
    events.push({ ...base, at: proposal.createdAt, actor: proposal.createdBy, action: "proposal.created", metadata: { type: proposal.type, risk: proposal.risk } });
    if (!proposal.decidedBy || !proposal.decidedAt) continue;

    const decision = { ...base, at: proposal.decidedAt, actor: proposal.decidedBy };
    if (proposal.status === "rejected") {
      events.push({ ...decision, action: "proposal.rejected", metadata: { note: proposal.decisionNote ?? null } });
      continue;
    }
    events.push({ ...decision, action: "proposal.approved", metadata: { note: proposal.decisionNote ?? null } });

    if (proposal.status === "applied" && proposal.appliedAt) {
      events.push({ ...base, at: proposal.appliedAt, actor: { type: "system" }, action: "proposal.applied", metadata: {} });
      const version = proposalVersion.get(proposal.id);
      if (version) {
        events.push({
          ...base,
          at: proposal.appliedAt,
          actor: { type: "system" },
          action: "listing_version.published",
          entity: { type: "listing_version", id: version.id },
          metadata: { productId: version.productId, version: version.version },
        });
      }
    }
    if (proposal.status === "failed") {
      events.push({
        ...base,
        at: clock.iso(Date.parse(proposal.decidedAt) + rng.int(2, 30) * MINUTE_MS),
        actor: { type: "system" },
        action: "proposal.failed",
        metadata: { error: "Amazon rejected the update. Try again later." },
      });
    }
  }

  return events
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((event) => ({ id: nextId("aud"), ...event }))
    .reverse();
}

type TargetStats = { spend14: number; sales14: number; orders14: number; spend30: number; orders30: number };
type CampaignStats = { spend14: number; sales14: number; last14: AdMetricsDaily[] };

function summarizeMetrics(dates: string[], metrics: MetricsDaily[]) {
  const last14 = new Set(dates.slice(-14));
  const last30 = new Set(dates.slice(-30));
  const target = new Map<string, TargetStats>();
  const campaign = new Map<string, CampaignStats>();

  for (const row of metrics) {
    if (row.entityType === "target") {
      const s = target.get(row.entityId) ?? { spend14: 0, sales14: 0, orders14: 0, spend30: 0, orders30: 0 };
      if (last14.has(row.date)) {
        s.spend14 += row.spend;
        s.sales14 += row.adSales;
        s.orders14 += row.adOrders;
      }
      if (last30.has(row.date)) {
        s.spend30 += row.spend;
        s.orders30 += row.adOrders;
      }
      target.set(row.entityId, s);
    } else if (row.entityType === "campaign" && last14.has(row.date)) {
      const s = campaign.get(row.entityId) ?? { spend14: 0, sales14: 0, last14: [] };
      s.spend14 += row.spend;
      s.sales14 += row.adSales;
      s.last14.push(row);
      campaign.set(row.entityId, s);
    }
  }
  return { target, campaign };
}

function decider(
  members: Member[],
  workspace: Workspace | undefined,
  account: SellerAccount,
  risk: ProposalRisk,
  pick: <T>(items: readonly T[]) => T,
): Member {
  const inWorkspace = members.filter((member) => member.workspaceId === account.workspaceId);
  const clientApprover = inWorkspace.find(
    (member) => member.role === "client_approver" && member.sellerAccountIds.includes(account.id),
  );
  if (workspace?.kind === "agency" && risk === "high" && clientApprover) return clientApprover;
  const editors = inWorkspace.filter((member) => member.role === "owner" || member.role === "specialist");
  return pick(editors.length > 0 ? editors : inWorkspace);
}

function liveVersion(versions: ListingVersion[], productId: string): ListingVersion | undefined {
  return versions.find((version) => version.productId === productId && version.status === "live");
}

function pickRun(pick: <T>(items: readonly T[]) => T, runs: AgentRun[]): AgentRun | undefined {
  return runs.length > 0 ? pick(runs) : undefined;
}

function targetLabel(target: Target): string {
  switch (target.kind) {
    case "keyword":
      return `"${target.keyword}" (${target.matchType})`;
    case "product":
      return `ASIN ${target.asin}`;
    case "auto":
      return `auto ${target.autoType.replace("_", " ")}`;
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function runSummary(agent: AgentName, count: number): string {
  if (count === 0) return "No changes recommended.";
  switch (agent) {
    case "listing_writer":
      return `Drafted ${count} listing ${count === 1 ? "update" : "updates"}.`;
    case "listing_reviewer":
      return `Reviewed ${count} listing ${count === 1 ? "version" : "versions"}.`;
    case "bid_optimizer":
      return `Recommended ${count} bid ${count === 1 ? "change" : "changes"}.`;
    case "keyword_harvester":
      return `Found ${count} keyword ${count === 1 ? "opportunity" : "opportunities"}.`;
    case "budget_pacer":
      return `Flagged ${count} budget-limited ${count === 1 ? "campaign" : "campaigns"}.`;
    case "campaign_optimizer":
      return `Planned ${count} campaign ${count === 1 ? "change" : "changes"}.`;
    case "campaign_strategist":
      return `Planned ${count} new ${count === 1 ? "campaign" : "campaigns"}.`;
    case "listing_creator":
      return `Drafted ${count} new ${count === 1 ? "listing" : "listings"}.`;
  }
}
