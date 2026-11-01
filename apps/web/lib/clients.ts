const HOUR_MS = 60 * 60 * 1000;

/** Above target ACoS by more than this share counts as over. */
const ACOS_TOLERANCE = 0.1;
/** Sales down by this share or more against the previous 30 days. */
const SALES_DROP = 0.1;
/** Average listing score below this. */
const LOW_LISTING_SCORE = 60;
/** A proposal waiting longer than this. */
const STALE_PENDING_HOURS = 72;

export type HealthStatus = "healthy" | "attention" | "at_risk";

export type HealthInput = {
  /** Ordered revenue over the last 30 days, and the 30 before when there were any. */
  sales: { current: number; previous?: number };
  /** Ad spend / ad sales over the last 30 days; undefined without ad sales. */
  acos?: number;
  targetAcos: number;
  /** Mean Review score of live listings, 0–100. */
  listingScore?: number;
  pending: number;
  highRisk: number;
  /** When the oldest pending proposal was filed. */
  oldestPendingAt?: string;
  hasData: boolean;
  /** ISO timestamp to age proposals against. */
  now: string;
};

/**
 * One client account's health in plain terms: each rule that trips is an issue, said the way a
 * specialist would say it. No issues is healthy, one needs attention, two or more is at risk.
 */
export function clientHealth(input: HealthInput): { status: HealthStatus; issues: string[] } {
  if (!input.hasData) return { status: "attention", issues: ["No data from Amazon yet."] };
  const issues: string[] = [];
  const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

  if (input.acos !== undefined && input.acos > input.targetAcos * (1 + ACOS_TOLERANCE)) {
    issues.push(`ACoS ${percent(input.acos)} is over the ${percent(input.targetAcos)} target.`);
  }
  const { current, previous } = input.sales;
  if (previous !== undefined && previous > 0 && (current - previous) / previous <= -SALES_DROP) {
    issues.push(`Sales are down ${percent((previous - current) / previous)} on the 30 days before.`);
  }
  if (input.listingScore !== undefined && input.listingScore < LOW_LISTING_SCORE) {
    issues.push(`Listings average ${input.listingScore}/100.`);
  }
  if (input.highRisk > 0) {
    issues.push(`${input.highRisk} high-risk ${input.highRisk === 1 ? "proposal is" : "proposals are"} waiting.`);
  }
  if (input.oldestPendingAt) {
    const hours = (Date.parse(input.now) - Date.parse(input.oldestPendingAt)) / HOUR_MS;
    if (hours > STALE_PENDING_HOURS) issues.push(`A proposal has waited ${Math.floor(hours / 24)} days.`);
  }
  return { status: issues.length === 0 ? "healthy" : issues.length === 1 ? "attention" : "at_risk", issues };
}

export const HEALTH_LABELS: Record<HealthStatus, string> = { healthy: "Healthy", attention: "Needs attention", at_risk: "At risk" };
