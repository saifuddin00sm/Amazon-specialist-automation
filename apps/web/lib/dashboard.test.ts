import type { AdMetricsDaily, ProductMetricsDaily, Review } from "@app/core";
import { describe, expect, it } from "vitest";
import { adTotals, averageListingScore, dailySalesAndSpend, dashboardWindow, opportunityScore, topOpportunities } from "./dashboard";

const product = (date: string, orderedRevenue: number): ProductMetricsDaily => ({
  entityType: "product",
  entityId: "prd_1",
  sellerAccountId: "sa_1",
  date,
  sessions: 10,
  pageViews: 12,
  unitsOrdered: 1,
  orderedRevenue,
});

const campaign = (date: string, spend: number, adSales: number): AdMetricsDaily => ({
  entityType: "campaign",
  entityId: "cmp_1",
  sellerAccountId: "sa_1",
  date,
  impressions: 100,
  clicks: 5,
  spend,
  adSales,
  adOrders: 1,
});

describe("dashboardWindow", () => {
  it("ends on the last day with metrics", () => {
    expect(dashboardWindow({ from: "2026-08-01", to: "2026-10-30" })).toEqual({ from: "2026-10-01", to: "2026-10-30" });
  });

  it("starts no earlier than the first day with metrics", () => {
    expect(dashboardWindow({ from: "2026-10-20", to: "2026-10-30" })).toEqual({ from: "2026-10-20", to: "2026-10-30" });
  });

  it("is undefined without metrics", () => {
    expect(dashboardWindow(undefined)).toBeUndefined();
  });
});

describe("dailySalesAndSpend", () => {
  it("sums each day and fills days without rows with zero", () => {
    const days = dailySalesAndSpend(
      { from: "2026-10-28", to: "2026-10-30" },
      [product("2026-10-28", 10.1), product("2026-10-28", 0.2), product("2026-10-30", 5), product("2026-10-31", 99)],
      [campaign("2026-10-28", 1.25, 4), campaign("2026-10-29", 2, 0)],
    );
    expect(days).toEqual([
      { date: "2026-10-28", sales: 10.3, spend: 1.25 },
      { date: "2026-10-29", sales: 0, spend: 2 },
      { date: "2026-10-30", sales: 5, spend: 0 },
    ]);
  });

  it("crosses month ends", () => {
    expect(dailySalesAndSpend({ from: "2026-10-31", to: "2026-11-01" }, [], []).map((day) => day.date)).toEqual(["2026-10-31", "2026-11-01"]);
  });
});

describe("adTotals", () => {
  it("divides spend by ad sales", () => {
    expect(adTotals([campaign("2026-10-29", 30, 80), campaign("2026-10-30", 10, 20)])).toEqual({ spend: 40, adSales: 100, acos: 0.4 });
  });

  it("has no ACoS without ad sales", () => {
    expect(adTotals([campaign("2026-10-30", 5, 0)]).acos).toBeUndefined();
    expect(adTotals([])).toEqual({ spend: 0, adSales: 0, acos: undefined });
  });
});

describe("averageListingScore", () => {
  const reviewed = (overall: number) => ({ productId: "prd", review: { overall } as Review });

  it("averages the overall scores, rounded", () => {
    expect(averageListingScore([reviewed(70), reviewed(81), reviewed(90)])).toBe(80);
  });

  it("is undefined with nothing reviewed", () => {
    expect(averageListingScore([])).toBeUndefined();
  });
});

describe("topOpportunities", () => {
  const proposal = (id: string, impact: number, confidence: number, createdAt = "2026-10-30T10:00:00.000Z") => ({
    id,
    createdAt,
    scores: { impact, confidence },
  });

  it("weights impact by confidence", () => {
    expect(opportunityScore(proposal("a", 80, 50))).toBe(40);
  });

  it("ranks by opportunity score, then newest, and keeps the top ones", () => {
    const ranked = topOpportunities(
      [
        proposal("low", 20, 90),
        proposal("older", 60, 50, "2026-10-28T10:00:00.000Z"),
        proposal("best", 80, 90),
        proposal("newer", 50, 60),
      ],
      3,
    );
    expect(ranked.map((p) => p.id)).toEqual(["best", "newer", "older"]);
  });
});
