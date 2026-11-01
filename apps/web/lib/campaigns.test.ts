import { campaignPlanPath, type AdMetricsDaily, type DiffEntry } from "@app/core";
import { describe, expect, it } from "vitest";
import { acosStatus, campaignWindows, dailyAds, groupPlanLines, relativeChange, summarizeAds, type PlanLabels } from "./campaigns";

const row = (date: string, spend: number, adSales: number, adOrders = 1): AdMetricsDaily => ({
  date,
  sellerAccountId: "sa_1",
  entityType: "campaign",
  entityId: "cmp_1",
  impressions: 1000,
  clicks: 20,
  spend,
  adSales,
  adOrders,
});

describe("campaignWindows", () => {
  it("compares the last 30 days with the 30 before", () => {
    expect(campaignWindows({ from: "2026-08-02", to: "2026-10-30" })).toEqual({
      current: { from: "2026-10-01", to: "2026-10-30" },
      previous: { from: "2026-09-01", to: "2026-09-30" },
    });
  });

  it("clips the previous window to the data and drops it when there is none", () => {
    expect(campaignWindows({ from: "2026-09-20", to: "2026-10-30" })?.previous).toEqual({ from: "2026-09-20", to: "2026-09-30" });
    expect(campaignWindows({ from: "2026-10-10", to: "2026-10-30" })).toEqual({ current: { from: "2026-10-10", to: "2026-10-30" } });
    expect(campaignWindows(undefined)).toBeUndefined();
  });
});

describe("summarizeAds and dailyAds", () => {
  const rows = [row("2026-10-01", 10.1, 40), row("2026-10-01", 5, 0, 0), row("2026-10-03", 4.9, 20), row("2026-09-30", 99, 1)];
  const range = { from: "2026-10-01", to: "2026-10-03" };

  it("sums the rows in range, with ACoS only when there are sales", () => {
    expect(summarizeAds(rows, range)).toEqual({ spend: 20, sales: 60, orders: 2, clicks: 60, acos: 20 / 60 });
    expect(summarizeAds([row("2026-10-01", 5, 0, 0)], range)).toEqual({ spend: 5, sales: 0, orders: 0, clicks: 20 });
  });

  it("fills every day of the range, zero where there are no rows", () => {
    expect(dailyAds(rows, range)).toEqual([
      { date: "2026-10-01", spend: 15.1, sales: 40 },
      { date: "2026-10-02", spend: 0, sales: 0 },
      { date: "2026-10-03", spend: 4.9, sales: 20 },
    ]);
  });
});

describe("acosStatus and relativeChange", () => {
  it("treats ±10% of target as on target", () => {
    expect(acosStatus(0.32, 0.3)).toBe("on");
    expect(acosStatus(0.34, 0.3)).toBe("over");
    expect(acosStatus(0.2, 0.3)).toBe("under");
    expect(acosStatus(undefined, 0.3)).toBe("none");
  });

  it("has no change from nothing", () => {
    expect(relativeChange(100, 125)).toBe(0.25);
    expect(relativeChange(0, 10)).toBeUndefined();
  });
});

describe("groupPlanLines", () => {
  const labels: PlanLabels = {
    adGroups: { ag_1: "Water Bottle", ag_2: "All Kitchen" },
    targets: { tgt_1: { label: '"water bottle" (exact)', adGroupId: "ag_1" } },
  };
  const keyword: DiffEntry = {
    path: campaignPlanPath.keyword("ag_1", 0),
    before: null,
    after: { keyword: "steel bottle", matchType: "exact", bid: 0.8 },
  };
  const diff: DiffEntry[] = [
    { path: campaignPlanPath.bid("tgt_1"), before: 1, after: 0.7 },
    keyword,
    { path: campaignPlanPath.negative("ag_2", 0), before: null, after: { keyword: "bottle", matchType: "exact" } },
    { path: "dailyBudget", before: 10, after: 20 },
  ];

  it("groups lines by ad group with names, and sets aside what isn't a plan line", () => {
    const { groups, unreadable } = groupPlanLines(diff, labels);
    expect(groups.map((group) => [group.name, group.bids.length, group.keywords.length, group.negatives.length])).toEqual([
      ["Water Bottle", 1, 1, 0],
      ["All Kitchen", 0, 0, 1],
    ]);
    expect(groups[0]!.bids[0]).toMatchObject({ label: '"water bottle" (exact)', before: 1, after: 0.7 });
    expect(unreadable).toEqual([diff[3]]);
  });

  it("leaves skipped lines out, or shows the agent's value for them when asked", () => {
    const skipped = diff.map((entry) => (entry === keyword ? { ...entry, after: null } : entry));
    expect(groupPlanLines(skipped, labels).groups[0]!.keywords).toEqual([]);
    const shown = groupPlanLines(skipped, labels, { includeSkipped: true, original: diff }).groups[0]!.keywords;
    expect(shown).toEqual([{ entry: skipped[1], value: keyword.after }]);
  });
});
