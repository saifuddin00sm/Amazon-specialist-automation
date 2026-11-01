import type { AdMetricsDaily, Campaign, Member, Product, ProductMetricsDaily, Proposal, SellerAccount, Workspace } from "@app/core";
import { describe, expect, it } from "vitest";
import { buildWeeklyReport, changeDetail, reportWeeks, weekBefore, type ReportInput } from "./reports";

const week = { from: "2026-10-24", to: "2026-10-30" };
const previous = weekBefore(week);

const account: SellerAccount = {
  id: "sa_1",
  workspaceId: "ws_1",
  name: "Northlane US",
  sellerId: "A1B2C3D4E5F6G7",
  marketplace: "US",
  currency: "USD",
  autonomyLevel: "L1",
  targetAcos: 0.3,
  connectedAt: "2026-01-01T00:00:00.000Z",
};
const workspace: Workspace = { id: "ws_1", name: "Northlane Co.", kind: "merchant", createdAt: "2026-01-01T00:00:00.000Z" };
const product = (id: string, title: string): Product => ({
  id,
  sellerAccountId: account.id,
  asin: "B0ABCDEFGH",
  sku: id,
  title,
  brand: "Northlane",
  category: "Kitchen",
  price: 20,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
});
const campaign: Campaign = {
  id: "cmp_1",
  sellerAccountId: account.id,
  name: "Kitchen | SP Keywords",
  type: "sponsored_products",
  targetingType: "manual",
  state: "enabled",
  dailyBudget: 50,
  biddingStrategy: "fixed",
  startDate: "2026-01-01",
};
const sales = (entityId: string, date: string, orderedRevenue: number): ProductMetricsDaily => ({
  date,
  sellerAccountId: account.id,
  entityType: "product",
  entityId,
  sessions: 100,
  pageViews: 120,
  unitsOrdered: orderedRevenue / 20,
  orderedRevenue,
});
const ads = (date: string, spend: number, adSales: number): AdMetricsDaily => ({
  date,
  sellerAccountId: account.id,
  entityType: "campaign",
  entityId: campaign.id,
  impressions: 1000,
  clicks: 50,
  spend,
  adSales,
  adOrders: 5,
});
const owner: Member = {
  id: "mem_1",
  workspaceId: workspace.id,
  name: "Maya Legros",
  email: "maya@example.com",
  role: "owner",
  sellerAccountIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};
const proposal = (id: string, fields: Partial<Proposal>): Proposal => ({
  id,
  workspaceId: workspace.id,
  sellerAccountId: account.id,
  type: "bid_change",
  status: "pending_approval",
  risk: "low",
  title: `Lower bid ${id}`,
  rationale: "ACoS is high.",
  target: { type: "target", id: "tgt_1" },
  diff: [{ path: "bid", before: 1.2, after: 0.95 }],
  scores: { confidence: 80, impact: 40 },
  freshness: [{ source: "ad_metrics", asOf: "2026-10-25T00:00:00.000Z" }],
  createdBy: { type: "agent", agent: "bid_optimizer", agentRunId: "run_1" },
  createdAt: "2026-10-25T06:00:00.000Z",
  ...fields,
});

const input: ReportInput = {
  account,
  workspace,
  week,
  previous,
  // 7 days of $100 this week against $80 the week before, mostly one product.
  productRows: [
    ...Array.from({ length: 7 }, (_, i) => sales("prod_1", `2026-10-${24 + i}`, 80)),
    ...Array.from({ length: 7 }, (_, i) => sales("prod_2", `2026-10-${24 + i}`, 20)),
    ...Array.from({ length: 7 }, (_, i) => sales("prod_1", `2026-10-${17 + i}`, 80)),
  ],
  campaignRows: [...Array.from({ length: 7 }, (_, i) => ads(`2026-10-${24 + i}`, 20, 50)), ...Array.from({ length: 7 }, (_, i) => ads(`2026-10-${17 + i}`, 10, 50))],
  products: [product("prod_1", "Water Bottle"), product("prod_2", "Lunch Box")],
  campaigns: [campaign],
  proposals: [
    proposal("prop_1", { status: "applied", decidedBy: { type: "member", memberId: owner.id }, decidedAt: "2026-10-26T09:00:00.000Z", appliedAt: "2026-10-26T09:30:00.000Z" }),
    proposal("prop_2", { status: "applied", decidedBy: { type: "system" }, decidedAt: "2026-10-25T07:00:00.000Z", appliedAt: "2026-10-25T07:05:00.000Z" }),
    // Applied before the week: not a change this week.
    proposal("prop_3", { status: "applied", decidedBy: { type: "system" }, decidedAt: "2026-10-20T07:00:00.000Z", appliedAt: "2026-10-20T07:05:00.000Z" }),
    proposal("prop_4", { status: "rejected", decidedBy: { type: "member", memberId: owner.id }, decidedAt: "2026-10-27T09:00:00.000Z", decisionNote: "No." }),
    proposal("prop_5", {}),
  ],
  members: [owner],
  generatedAt: "2026-11-01T09:00:00.000Z",
};

describe("reportWeeks", () => {
  it("lists full weeks with data, newest first, ending on the last day", () => {
    expect(reportWeeks({ from: "2026-10-10", to: "2026-10-30" })).toEqual([week, previous, { from: "2026-10-10", to: "2026-10-16" }]);
    expect(reportWeeks({ from: "2026-10-28", to: "2026-10-30" })).toEqual([]);
    expect(reportWeeks(undefined)).toEqual([]);
  });
});

describe("buildWeeklyReport", () => {
  const report = buildWeeklyReport(input);

  it("compares this week's numbers with the week before", () => {
    expect(report.kpis.sales).toEqual({ current: 700, previous: 560 });
    expect(report.kpis.adSpend).toEqual({ current: 140, previous: 70 });
    expect(report.kpis.acos).toEqual({ current: 0.4, previous: 0.2 });
    expect(report.kpis.tacos.current).toBeCloseTo(0.2);
    expect(report.daily).toHaveLength(7);
    expect(report.daily[0]).toEqual({ date: "2026-10-24", sales: 100, previousSales: 80, adSales: 50, spend: 20 });
  });

  it("ranks products and campaigns", () => {
    expect(report.products.map((row) => [row.title, row.revenue, row.previousRevenue])).toEqual([
      ["Water Bottle", 560, 560],
      ["Lunch Box", 140, 0],
    ]);
    expect(report.campaigns).toEqual([{ id: campaign.id, name: campaign.name, spend: 140, sales: 350, acos: 0.4 }]);
  });

  it("lists only changes applied during the week, with who approved them", () => {
    expect(report.changes.map((item) => [item.proposalId, item.approvedBy, item.detail])).toEqual([
      ["prop_2", "Auto-approved within guardrails", "Bid $1.20 → $0.95"],
      ["prop_1", "Maya Legros", "Bid $1.20 → $0.95"],
    ]);
    expect(report.decisions).toEqual({ approved: 2, rejected: 1, waiting: 1 });
  });

  it("says it in plain language", () => {
    expect(report.summary).toEqual([
      "Sales were $700.00 this week, up 25% from the week before, on 35 units. The best seller was Water Bottle at $560.00.",
      "Ads cost $140.00 and brought in $350.00 in sales, an ACoS of 40%, above the 30% target. Advertising was 20.0% of all sales, against 12.5% the week before.",
      "2 changes went live (2 bid changes), each approved before it was applied. 1 proposal is waiting for approval.",
    ]);
  });

  it("falls back to the workspace name and default colors without branding", () => {
    expect(report.branding).toMatchObject({ displayName: "Northlane Co.", primaryColor: "#18181b" });
    const branded = buildWeeklyReport({ ...input, workspace: { ...workspace, branding: { displayName: "Acme", primaryColor: "#123456", accentColor: "#abcdef" } } });
    expect(branded.branding).toEqual({ displayName: "Acme", primaryColor: "#123456", accentColor: "#abcdef" });
  });

  it("works without a week before", () => {
    const first = buildWeeklyReport({ ...input, previous: undefined });
    expect(first.kpis.sales).toEqual({ current: 700 });
    expect(first.summary[0]).toBe("Sales were $700.00 this week, on 35 units. The best seller was Water Bottle at $560.00.");
  });
});

describe("changeDetail", () => {
  it("describes keyword, listing and plan changes", () => {
    const base = proposal("p", {});
    expect(changeDetail({ ...base, type: "keyword_add", diff: [{ path: "keywords", before: null, after: { keyword: "bottle", matchType: "exact", bid: 0.8 } }] }, "USD")).toBe(
      '"bottle" (exact) at $0.80',
    );
    expect(changeDetail({ ...base, type: "keyword_negate", diff: [{ path: "negativeKeywords", before: ["a"], after: ["a", "b"] }] }, "USD")).toBe('Negated "b"');
    expect(changeDetail({ ...base, type: "listing_update", diff: [{ path: "title", before: "a", after: "b" }, { path: "bullets", before: [], after: [] }] }, "USD")).toBe(
      "Updated title, bullet points",
    );
  });
});
