import {
  AD_GUARDRAILS,
  campaignPlanPath,
  checkProposalCompliance,
  parseCampaignPlanLine,
  type AdGroup,
  type AdMetricsDaily,
  type AgentRunStep,
  type Campaign,
  type ComplianceCheck,
  type Currency,
  type DiffEntry,
  type Product,
  type ProductFacts,
  type SellerAccount,
  type Target,
} from "@app/core";
import type { DateRange } from "../data-source";

/** Days of ad metrics the optimizer reads, ending on the newest day the account has. */
export const CAMPAIGN_OPTIMIZER_DAYS = 30;

/** Seconds each step takes in the simulated run, in order. */
const STEP_SECONDS = [4, 6, 4, 4, 2, 1] as const;
/** Orders a target needs in the window before its ACoS steers its bid. */
const MIN_ORDERS = 2;
/** Clicks a target without orders needs before its bid comes down. */
const MIN_CLICKS_WITHOUT_ORDERS = 10;
/** Largest bid move in one plan, either way. Inside the ±50% guardrail, so plans never warn on it. */
const MAX_BID_STEP = 0.3;
/** Smaller moves aren't worth a decision. */
const MIN_BID_STEP = 0.1;
const MIN_BID = 0.1;
/** Caps that keep a plan short enough to review line by line. */
const MAX_BID_LINES = 10;
const MAX_KEYWORDS_PER_AD_GROUP = 2;
const MAX_KEYWORDS = 8;
const MAX_NEGATIVES_PER_AD_GROUP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AdPerformance = {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  /** spend / sales; undefined without sales. */
  acos?: number;
};

/** The last CAMPAIGN_OPTIMIZER_DAYS days the account has metrics for; undefined without metrics. */
export function campaignOptimizerWindow(available: DateRange | undefined): DateRange | undefined {
  if (!available) return undefined;
  const from = new Date(Date.parse(`${available.to}T00:00:00.000Z`) - (CAMPAIGN_OPTIMIZER_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  return { from: from > available.from ? from : available.from, to: available.to };
}

export function adPerformance(rows: readonly AdMetricsDaily[]): AdPerformance {
  const total = { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
  for (const row of rows) {
    total.impressions += row.impressions;
    total.clicks += row.clicks;
    total.spend += row.spend;
    total.sales += row.adSales;
    total.orders += row.adOrders;
  }
  const spend = cents(total.spend);
  const sales = cents(total.sales);
  return { ...total, spend, sales, ...(sales > 0 ? { acos: spend / sales } : {}) };
}

export type CampaignPlanInput = {
  runId: string;
  account: SellerAccount;
  campaign: Campaign;
  /**
   * The account's campaigns, ad groups and targets. Negatives for an auto campaign are the keywords
   * its manual siblings already target exact for the same products.
   */
  campaigns: readonly Campaign[];
  adGroups: readonly AdGroup[];
  targets: readonly Target[];
  products: readonly Product[];
  productFacts: readonly ProductFacts[];
  /** Target rows of this campaign over `window`. */
  metrics: readonly AdMetricsDaily[];
  window: DateRange;
  /** Epoch ms the run starts at. */
  startedAt: number;
};

export type CampaignPlan = {
  steps: AgentRunStep[];
  /** Every line of the plan, in step order. */
  diff: DiffEntry[];
  performance: AdPerformance;
};

/**
 * The Phase 1 campaign optimizer. Over the last 30 days it moves bids toward the account's target
 * ACoS, adds the advertised products' ProductFacts target keywords an ad group doesn't target yet,
 * and in auto campaigns negates keywords a manual campaign already targets exact for the same
 * products. Every change is a line of one campaign_plan diff.
 */
export function planCampaignOptimizerRun(input: CampaignPlanInput): CampaignPlan {
  const { runId, account, campaign, window, startedAt } = input;
  const money = (amount: number) => formatMoney(amount, account.currency);
  const target = account.targetAcos;

  const adGroups = input.adGroups.filter((adGroup) => adGroup.campaignId === campaign.id && adGroup.state === "enabled");
  const ownGroupIds = new Set(adGroups.map((adGroup) => adGroup.id));
  const targets = input.targets.filter((candidate) => ownGroupIds.has(candidate.adGroupId));
  const performance = adPerformance(input.metrics);
  const byTarget = new Map<string, AdMetricsDaily[]>();
  for (const row of input.metrics) byTarget.set(row.entityId, [...(byTarget.get(row.entityId) ?? []), row]);
  const productById = new Map(input.products.map((product) => [product.id, product]));
  const factsById = new Map(input.productFacts.map((facts) => [facts.productId, facts]));

  // Bids: steer converting targets toward target ACoS; bring down ones that spend without orders.
  const bidLines: { entry: DiffEntry; note: string; spend: number }[] = [];
  for (const candidate of targets) {
    if (candidate.negative || candidate.state !== "enabled" || candidate.bid === undefined) continue;
    const bid = candidate.bid;
    const stats = adPerformance(byTarget.get(candidate.id) ?? []);
    const prices = (adGroups.find((adGroup) => adGroup.id === candidate.adGroupId)?.productIds ?? []).flatMap(
      (id) => productById.get(id)?.price ?? [],
    );
    const orderValue = prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;

    let ratio: number | undefined;
    let note = "";
    if (stats.orders >= MIN_ORDERS && stats.acos !== undefined) {
      ratio = Math.min(1 + MAX_BID_STEP, Math.max(1 - MAX_BID_STEP, target / stats.acos));
      note =
        ratio < 1
          ? `ACoS ${percent(stats.acos)} on ${money(stats.spend)} spend.`
          : `ACoS ${percent(stats.acos)} with ${stats.orders} orders, under the ${percent(target)} target.`;
    } else if (stats.orders === 0 && stats.clicks >= MIN_CLICKS_WITHOUT_ORDERS && orderValue > 0 && stats.spend >= orderValue * target) {
      // It has already spent what one order would justify at target ACoS.
      ratio = 1 - MAX_BID_STEP;
      note = `${stats.clicks} clicks and ${money(stats.spend)} spend without an order.`;
    }
    if (ratio === undefined || Math.abs(ratio - 1) < MIN_BID_STEP) continue;
    const after = Math.max(MIN_BID, cents(bid * ratio));
    if (after === bid) continue;
    bidLines.push({
      entry: { path: campaignPlanPath.bid(candidate.id), before: bid, after },
      note: `${after < bid ? "Lower" : "Raise"} ${describeTarget(candidate)} ${money(bid)} → ${money(after)}: ${note}`,
      spend: stats.spend,
    });
  }
  bidLines.sort((a, b) => b.spend - a.spend || a.entry.path.localeCompare(b.entry.path));
  const bids = bidLines.slice(0, MAX_BID_LINES);

  // New keywords: ProductFacts target keywords a manual keyword ad group doesn't target yet.
  const keywordLines: { entry: DiffEntry; note: string }[] = [];
  const takesKeywords = campaign.type === "sponsored_products" && campaign.targetingType === "manual";
  if (takesKeywords) {
    for (const adGroup of adGroups) {
      const own = targets.flatMap((candidate) => (candidate.adGroupId === adGroup.id && candidate.kind === "keyword" ? [candidate] : []));
      // Product-targeting ad groups stay that way.
      if (!own.some((candidate) => !candidate.negative)) continue;
      const taken = new Set(own.map((candidate) => normalize(candidate.keyword)));
      const ideas = unique(adGroup.productIds.flatMap((id) => factsById.get(id)?.targetKeywords ?? []).map(normalize)).filter(
        (keyword) =>
          keyword !== "" &&
          !taken.has(keyword) &&
          keyword.length <= AD_GUARDRAILS.keywordMaxLength &&
          keyword.split(" ").length <= AD_GUARDRAILS.keywordMaxWords,
      );
      ideas.slice(0, Math.min(MAX_KEYWORDS_PER_AD_GROUP, MAX_KEYWORDS - keywordLines.length)).forEach((keyword, i) => {
        keywordLines.push({
          entry: { path: campaignPlanPath.keyword(adGroup.id, i), before: null, after: { keyword, matchType: "exact", bid: adGroup.defaultBid } },
          note: `Add "${keyword}" (exact) to ${adGroup.name} at ${money(adGroup.defaultBid)}: a ProductFacts target keyword the ad group doesn't target.`,
        });
      });
    }
  }

  // Negatives: in auto campaigns, stop bidding on queries a manual campaign already targets exact.
  const negativeLines: { entry: DiffEntry; note: string }[] = [];
  if (campaign.targetingType === "auto") {
    const campaignById = new Map(input.campaigns.map((candidate) => [candidate.id, candidate]));
    const adGroupById = new Map(input.adGroups.map((candidate) => [candidate.id, candidate]));
    for (const adGroup of adGroups) {
      const advertised = new Set(adGroup.productIds);
      const negated = new Set(
        targets.flatMap((candidate) =>
          candidate.adGroupId === adGroup.id && candidate.kind === "keyword" && candidate.negative ? [normalize(candidate.keyword)] : [],
        ),
      );
      const harvested = new Map<string, string>();
      for (const candidate of input.targets) {
        if (candidate.kind !== "keyword" || candidate.negative || candidate.state !== "enabled" || candidate.matchType !== "exact") continue;
        const source = adGroupById.get(candidate.adGroupId);
        const sourceCampaign = source && campaignById.get(source.campaignId);
        if (!source || !sourceCampaign || sourceCampaign.id === campaign.id) continue;
        if (sourceCampaign.type !== "sponsored_products" || sourceCampaign.targetingType !== "manual" || sourceCampaign.state !== "enabled") continue;
        const keyword = normalize(candidate.keyword);
        if (negated.has(keyword) || harvested.has(keyword) || !source.productIds.some((id) => advertised.has(id))) continue;
        harvested.set(keyword, sourceCampaign.name);
      }
      [...harvested].slice(0, MAX_NEGATIVES_PER_AD_GROUP).forEach(([keyword, sourceName], i) => {
        negativeLines.push({
          entry: { path: campaignPlanPath.negative(adGroup.id, i), before: null, after: { keyword, matchType: "exact" } },
          note: `Negate "${keyword}" (exact) in ${adGroup.name}: ${sourceName} already targets it exact.`,
        });
      });
    }
  }

  const diff = [...bids, ...keywordLines, ...negativeLines].map((line) => line.entry);
  const checks = diff.length > 0 ? checkProposalCompliance({ type: "campaign_plan", diff }) : [];
  const converting = targets.filter((candidate) => adPerformance(byTarget.get(candidate.id) ?? []).orders > 0).length;
  const active = targets.filter((candidate) => !candidate.negative && candidate.state === "enabled").length;

  const texts = {
    performance: [
      `Reading ${CAMPAIGN_OPTIMIZER_DAYS} days of ad metrics, ${window.from} to ${window.to}.`,
      `Spend ${money(performance.spend)} · ad sales ${money(performance.sales)} · ${performance.orders} orders.`,
      performance.acos === undefined
        ? `No ad sales yet, against a ${percent(target)} target ACoS.`
        : `ACoS ${percent(performance.acos)} against the ${percent(target)} target.`,
      `${active} active targets across ${adGroups.length} ${adGroups.length === 1 ? "ad group" : "ad groups"}; ${converting} converted.`,
    ].join("\n"),
    bids:
      bids.length > 0
        ? [`Steering bids toward ${percent(target)} ACoS, at most ±${Math.round(MAX_BID_STEP * 100)}% per target.`, "", ...bids.map((line) => `– ${line.note}`)].join("\n")
        : `No bid changes. Every target is within ${Math.round(MIN_BID_STEP * 100)}% of its target bid or has too few orders to judge.`,
    keywords: !takesKeywords
      ? "This campaign doesn't take keyword targets. Harvest into a manual Sponsored Products campaign instead."
      : keywordLines.length > 0
        ? ["Comparing ProductFacts target keywords with what each ad group targets.", "", ...keywordLines.map((line) => `– ${line.note}`)].join("\n")
        : "Every ProductFacts target keyword is already targeted.",
    negatives:
      campaign.targetingType !== "auto"
        ? "Manual campaigns only bid on their own keywords; no negatives needed to funnel traffic."
        : negativeLines.length > 0
          ? ["Funneling traffic: keywords a manual campaign targets exact shouldn't also be bought here.", "", ...negativeLines.map((line) => `– ${line.note}`)].join("\n")
          : "No overlap with the manual campaigns' exact keywords.",
    compliance:
      checks.length > 0
        ? [`Running ${checks.length} guardrail checks on the plan.`, ...checks.map((check) => `${CHECK_MARK[check.status]} ${check.label}${check.detail ? ` – ${check.detail}` : ""}`)].join("\n")
        : "Nothing to check: the plan is empty.",
    awaiting:
      diff.length > 0
        ? `Created a campaign plan with ${diff.length} ${diff.length === 1 ? "change" : "changes"}. Nothing changes on Amazon until a member approves it.`
        : "No changes to propose. The campaign is on target.",
  };

  let clock = startedAt;
  const timed = (i: number) => {
    const from = clock;
    clock += STEP_SECONDS[i]! * 1000;
    return { id: `${runId}_s${i + 1}`, startedAt: new Date(from).toISOString(), finishedAt: new Date(clock).toISOString() };
  };
  const agent = "campaign_optimizer" as const;

  return {
    steps: [
      { ...timed(0), kind: "plan", agent, title: "Read performance", text: texts.performance, changes: [] },
      { ...timed(1), kind: "plan", agent, title: "Bid changes", text: texts.bids, changes: bids.map((line) => line.entry) },
      { ...timed(2), kind: "plan", agent, title: "New keywords", text: texts.keywords, changes: keywordLines.map((line) => line.entry) },
      { ...timed(3), kind: "plan", agent, title: "Negative keywords", text: texts.negatives, changes: negativeLines.map((line) => line.entry) },
      { ...timed(4), kind: "compliance_check", title: "Guardrail check", text: texts.compliance, checks },
      { ...timed(5), kind: "awaiting_approval", title: diff.length > 0 ? "Awaiting approval" : "No proposal needed", text: texts.awaiting },
    ],
    diff,
    performance,
  };
}

/** How many of each kind of change a plan makes. Skipped lines don't count. */
export function countPlanChanges(diff: readonly DiffEntry[]): { lowered: number; raised: number; keywords: number; negatives: number } {
  const counts = { lowered: 0, raised: 0, keywords: 0, negatives: 0 };
  for (const entry of diff) {
    const line = parseCampaignPlanLine(entry);
    if (line?.kind === "bid" && line.after < line.before) counts.lowered++;
    if (line?.kind === "bid" && line.after > line.before) counts.raised++;
    if (line?.kind === "keyword" && line.after) counts.keywords++;
    if (line?.kind === "negative" && line.after) counts.negatives++;
  }
  return counts;
}

export function formatMoney(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

const CHECK_MARK: Record<ComplianceCheck["status"], string> = { pass: "✓", warn: "!", fail: "✗" };

function describeTarget(target: Target): string {
  switch (target.kind) {
    case "keyword":
      return `"${target.keyword}" (${target.matchType})`;
    case "product":
      return `ASIN ${target.asin}`;
    case "auto":
      return `auto ${target.autoType.replace("_", " ")}`;
  }
}

function normalize(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
