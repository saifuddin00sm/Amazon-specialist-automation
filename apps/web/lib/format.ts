import type { AgentName, Currency, FreshnessSource, ProposalRisk, ProposalType, RubricCriterion, Target } from "@app/core";

// Times render in UTC so the server and the browser produce the same markup.
const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function formatDateTime(iso: string): string {
  return `${dateTime.format(new Date(iso))} UTC`;
}

export function formatAge(hours: number): string {
  if (hours < 1) return "under 1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function formatMoney(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function formatPercentChange(before: number, after: number): string {
  if (before === 0) return "new";
  const change = Math.round(((after - before) / before) * 100);
  return `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change)}%`;
}

export const AGENT_LABELS: Record<AgentName, string> = {
  listing_writer: "Listing writer",
  listing_reviewer: "Listing reviewer",
  bid_optimizer: "Bid optimizer",
  budget_pacer: "Budget pacer",
  keyword_harvester: "Keyword harvester",
};

export const PROPOSAL_TYPE_LABELS: Record<ProposalType, string> = {
  listing_update: "Listing",
  price_change: "Price",
  bid_change: "Bid",
  budget_change: "Budget",
  keyword_add: "Add keyword",
  keyword_negate: "Negate keyword",
  target_pause: "Pause target",
};

export const RISK_LABELS: Record<ProposalRisk, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

export const RUBRIC_LABELS: Record<RubricCriterion, string> = {
  title: "Title",
  bullets: "Bullets",
  description: "Description",
  keywords: "Keywords",
  factual_accuracy: "Factual accuracy",
  compliance: "Compliance",
};

export const FRESHNESS_LABELS: Record<FreshnessSource, string> = {
  ad_metrics: "Ad metrics",
  search_terms: "Search term report",
  live_listing: "Live listing",
  product_facts: "ProductFacts",
};

/** Labels for diff paths. */
export const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  bullets: "Bullet points",
  description: "Description",
  backendKeywords: "Backend search terms",
  bid: "Bid",
  dailyBudget: "Daily budget",
  price: "Price",
  state: "State",
  keywords: "New keyword",
  negativeKeywords: "Negative keywords",
};

export function fieldLabel(path: string): string {
  return FIELD_LABELS[path] ?? path;
}

export function targetLabel(target: Target): string {
  switch (target.kind) {
    case "keyword":
      return `"${target.keyword}" (${target.matchType})`;
    case "product":
      return `ASIN ${target.asin}`;
    case "auto":
      return `Auto: ${target.autoType.replaceAll("_", " ")}`;
  }
}
