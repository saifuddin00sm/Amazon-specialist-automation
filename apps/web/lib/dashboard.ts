import type { AdMetricsDaily, ProductMetricsDaily, Proposal } from "@app/core";
import type { DateRange, LiveListingReview } from "@app/data";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days of metrics the dashboard sums and charts. */
export const DASHBOARD_DAYS = 30;

/**
 * The last `days` days the account has metrics for. Amazon reports lag, so the window ends on the
 * newest day with data rather than today. Undefined when there are no metrics.
 */
export function dashboardWindow(available: DateRange | undefined, days = DASHBOARD_DAYS): DateRange | undefined {
  if (!available) return undefined;
  const from = isoDate(Date.parse(`${available.to}T00:00:00.000Z`) - (days - 1) * DAY_MS);
  return { from: from > available.from ? from : available.from, to: available.to };
}

export type DailySalesAndSpend = { date: string; sales: number; spend: number };

/** Ordered revenue (all products) and ad spend (all campaigns) for every day of the window, oldest first. */
export function dailySalesAndSpend(
  window: DateRange,
  productRows: readonly ProductMetricsDaily[],
  campaignRows: readonly AdMetricsDaily[],
): DailySalesAndSpend[] {
  const days = new Map<string, DailySalesAndSpend>();
  for (let ms = Date.parse(`${window.from}T00:00:00.000Z`); isoDate(ms) <= window.to; ms += DAY_MS) {
    days.set(isoDate(ms), { date: isoDate(ms), sales: 0, spend: 0 });
  }
  for (const row of productRows) {
    const day = days.get(row.date);
    if (day) day.sales += row.orderedRevenue;
  }
  for (const row of campaignRows) {
    const day = days.get(row.date);
    if (day) day.spend += row.spend;
  }
  return [...days.values()].map((day) => ({ ...day, sales: cents(day.sales), spend: cents(day.spend) }));
}

export type AdTotals = { spend: number; adSales: number; /** spend / adSales; undefined without ad sales. */ acos?: number };

export function adTotals(campaignRows: readonly AdMetricsDaily[]): AdTotals {
  const spend = cents(campaignRows.reduce((sum, row) => sum + row.spend, 0));
  const adSales = cents(campaignRows.reduce((sum, row) => sum + row.adSales, 0));
  return { spend, adSales, acos: adSales > 0 ? spend / adSales : undefined };
}

/** Mean Review overall (0–100) of the live listings that have one, rounded; undefined when none do. */
export function averageListingScore(reviews: readonly LiveListingReview[]): number | undefined {
  if (reviews.length === 0) return undefined;
  return Math.round(reviews.reduce((sum, { review }) => sum + review.overall, 0) / reviews.length);
}

/** Expected value of approving: impact weighted by how sure the agent is. 0–100. */
export function opportunityScore(proposal: Pick<Proposal, "scores">): number {
  return Math.round((proposal.scores.impact * proposal.scores.confidence) / 100);
}

/** Pending proposals worth deciding first: highest opportunity score, then newest. */
export function topOpportunities<T extends Pick<Proposal, "scores" | "createdAt" | "id">>(proposals: readonly T[], limit = 5): T[] {
  return [...proposals]
    .sort(
      (a, b) =>
        opportunityScore(b) - opportunityScore(a) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
