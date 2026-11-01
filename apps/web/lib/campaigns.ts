import {
  isSkippedPlanLine,
  parseCampaignPlanLine,
  type AdGroup,
  type AdMetricsDaily,
  type DiffEntry,
  type PlanKeyword,
  type PlanNegative,
  type Target,
} from "@app/core";
import type { DateRange } from "@app/data";
import { dashboardWindow } from "./dashboard";
import { targetLabel } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days the campaign list sums, and compares with the same number of days before. */
export const CAMPAIGN_DAYS = 30;

/** The last CAMPAIGN_DAYS days with metrics, and the CAMPAIGN_DAYS before them (clipped to the data). */
export function campaignWindows(available: DateRange | undefined): { current: DateRange; previous?: DateRange } | undefined {
  const current = dashboardWindow(available, CAMPAIGN_DAYS);
  if (!available || !current) return undefined;
  const to = isoDate(Date.parse(`${current.from}T00:00:00.000Z`) - DAY_MS);
  if (to < available.from) return { current };
  const from = isoDate(Date.parse(`${to}T00:00:00.000Z`) - (CAMPAIGN_DAYS - 1) * DAY_MS);
  return { current, previous: { from: from > available.from ? from : available.from, to } };
}

export type AdSummary = {
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  /** spend / sales; undefined without sales. */
  acos?: number;
};

/** Totals of ad rows (one entity or many) whose date falls in `range`. */
export function summarizeAds(rows: readonly AdMetricsDaily[], range: DateRange): AdSummary {
  let spend = 0;
  let sales = 0;
  let orders = 0;
  let clicks = 0;
  for (const row of rows) {
    if (row.date < range.from || row.date > range.to) continue;
    spend += row.spend;
    sales += row.adSales;
    orders += row.adOrders;
    clicks += row.clicks;
  }
  return { spend: cents(spend), sales: cents(sales), orders, clicks, ...(sales > 0 ? { acos: spend / sales } : {}) };
}

export type DailyAds = { date: string; spend: number; sales: number };

/** Spend and ad sales for every day of `range`, oldest first; days without rows are zero. */
export function dailyAds(rows: readonly AdMetricsDaily[], range: DateRange): DailyAds[] {
  const days = new Map<string, DailyAds>();
  for (let ms = Date.parse(`${range.from}T00:00:00.000Z`); isoDate(ms) <= range.to; ms += DAY_MS) {
    days.set(isoDate(ms), { date: isoDate(ms), spend: 0, sales: 0 });
  }
  for (const row of rows) {
    const day = days.get(row.date);
    if (!day) continue;
    day.spend += row.spend;
    day.sales += row.adSales;
  }
  return [...days.values()].map((day) => ({ ...day, spend: cents(day.spend), sales: cents(day.sales) }));
}

/** How ACoS sits against the target: within 10% of it either way counts as on target. */
export function acosStatus(acos: number | undefined, target: number): "none" | "under" | "on" | "over" {
  if (acos === undefined) return "none";
  if (acos > target * 1.1) return "over";
  if (acos < target * 0.9) return "under";
  return "on";
}

/** Fractional change from `before` to `after`; undefined when there was nothing before. */
export function relativeChange(before: number, after: number): number | undefined {
  return before > 0 ? (after - before) / before : undefined;
}

/** Names for the ids in a campaign plan's paths. */
export type PlanLabels = {
  adGroups: Record<string, string>;
  targets: Record<string, { label: string; adGroupId: string }>;
};

export function planLabels(adGroups: readonly AdGroup[], targets: readonly Target[]): PlanLabels {
  return {
    adGroups: Object.fromEntries(adGroups.map((adGroup) => [adGroup.id, adGroup.name])),
    targets: Object.fromEntries(targets.map((target) => [target.id, { label: targetLabel(target), adGroupId: target.adGroupId }])),
  };
}

export type PlanGroup = {
  adGroupId: string;
  name: string;
  bids: { entry: DiffEntry; targetId: string; label: string; before: number; after: number }[];
  keywords: { entry: DiffEntry; value: PlanKeyword }[];
  negatives: { entry: DiffEntry; value: PlanNegative }[];
};

/**
 * A campaign plan's lines by ad group, in the order the ad groups first appear. Skipped lines are
 * left out unless `includeSkipped`; for keywords that means the agent's value, from `original`.
 */
export function groupPlanLines(
  diff: readonly DiffEntry[],
  labels: PlanLabels | undefined,
  { includeSkipped = false, original }: { includeSkipped?: boolean; original?: readonly DiffEntry[] } = {},
): { groups: PlanGroup[]; unreadable: DiffEntry[] } {
  const groups = new Map<string, PlanGroup>();
  const unreadable: DiffEntry[] = [];
  const groupFor = (adGroupId: string) => {
    let group = groups.get(adGroupId);
    if (!group) {
      group = { adGroupId, name: labels?.adGroups[adGroupId] ?? adGroupId, bids: [], keywords: [], negatives: [] };
      groups.set(adGroupId, group);
    }
    return group;
  };

  diff.forEach((entry, i) => {
    const line = parseCampaignPlanLine(entry);
    if (!line) {
      unreadable.push(entry);
      return;
    }
    if (isSkippedPlanLine(line) && !includeSkipped) return;
    if (line.kind === "bid") {
      const target = labels?.targets[line.targetId];
      groupFor(target?.adGroupId ?? "unknown").bids.push({
        entry,
        targetId: line.targetId,
        label: target?.label ?? line.targetId,
        before: line.before,
        after: line.after,
      });
      return;
    }
    // A skipped keyword has no value of its own; show the one the agent proposed.
    const fallback = original?.[i] && parseCampaignPlanLine(original[i]);
    const value = line.after ?? (fallback && fallback.kind === line.kind ? fallback.after : null);
    if (!value) return;
    if (line.kind === "keyword") groupFor(line.adGroupId).keywords.push({ entry, value: value as PlanKeyword });
    else groupFor(line.adGroupId).negatives.push({ entry, value: value as PlanNegative });
  });
  return { groups: [...groups.values()], unreadable };
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
