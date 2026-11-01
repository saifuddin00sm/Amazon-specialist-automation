import {
  AgentRunStepSchema,
  campaignPlanPath,
  type AdGroup,
  type AdMetricsDaily,
  type Campaign,
  type Product,
  type ProductFacts,
  type SellerAccount,
  type Target,
} from "@app/core";
import { describe, expect, it } from "vitest";
import { campaignOptimizerWindow, countPlanChanges, planCampaignOptimizerRun, type CampaignPlanInput } from "./campaign-optimizer";

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

const campaign = (id: string, targetingType: Campaign["targetingType"], state: Campaign["state"] = "enabled"): Campaign => ({
  id,
  sellerAccountId: account.id,
  name: `Northlane | ${id}`,
  type: "sponsored_products",
  targetingType,
  state,
  dailyBudget: 50,
  biddingStrategy: "fixed",
  startDate: "2026-01-01",
});

const adGroup = (id: string, campaignId: string): AdGroup => ({
  id,
  campaignId,
  name: `Group ${id}`,
  state: "enabled",
  defaultBid: 0.8,
  productIds: ["prod_1"],
});

const keyword = (id: string, adGroupId: string, text: string, fields: Partial<Target> = {}): Target =>
  ({ id, adGroupId, state: "enabled", negative: false, bid: 1, kind: "keyword", keyword: text, matchType: "exact", ...fields }) as Target;

/** One day of a target's numbers; `sales` is spread over the orders. */
const row = (entityId: string, { clicks, spend, orders, sales }: { clicks: number; spend: number; orders: number; sales: number }): AdMetricsDaily => ({
  date: "2026-10-30",
  sellerAccountId: account.id,
  entityType: "target",
  entityId,
  impressions: clicks * 100,
  clicks,
  spend,
  adSales: sales,
  adOrders: orders,
});

const product: Product = {
  id: "prod_1",
  sellerAccountId: account.id,
  asin: "B0ABCDEFGH",
  sku: "NL-BOT-1",
  title: "Northlane Water Bottle",
  brand: "Northlane",
  category: "Kitchen",
  price: 25,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const facts: ProductFacts = {
  productId: "prod_1",
  material: "Steel",
  color: "Sage",
  dimensions: { lengthCm: 8, widthCm: 8, heightCm: 26 },
  weightGrams: 380,
  includedComponents: ["Lid"],
  features: ["Keeps drinks cold"],
  prohibitedClaims: [],
  targetKeywords: ["water bottle", "Insulated  Bottle", "bottle for gym", "steel bottle"],
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const manual = campaign("cmp_m", "manual");
const auto = campaign("cmp_a", "auto");
const manualGroup = adGroup("ag_m", manual.id);
const autoGroup = adGroup("ag_a", auto.id);
const targets: Target[] = [
  // ACoS 60%: twice the target, so the bid drops by the 30% cap.
  keyword("tgt_high", manualGroup.id, "water bottle", { bid: 2 }),
  // ACoS 10%: a third of the target, so the bid rises by the 30% cap.
  keyword("tgt_low", manualGroup.id, "bottle for gym", { bid: 1 }),
  // ACoS 28%: close enough to target to leave alone.
  keyword("tgt_ok", manualGroup.id, "gym bottle", { bid: 1, matchType: "phrase" }),
  // 20 clicks and $12 spend without an order, more than one $25 order at 30% justifies.
  keyword("tgt_waste", manualGroup.id, "cheap bottle", { bid: 0.5, matchType: "broad" }),
  keyword("tgt_neg", manualGroup.id, "steel bottle", { negative: true, bid: undefined }),
  { id: "tgt_auto", adGroupId: autoGroup.id, state: "enabled", negative: false, bid: 0.7, kind: "auto", autoType: "close_match" },
];
const metrics = [
  row("tgt_high", { clicks: 40, spend: 60, orders: 4, sales: 100 }),
  row("tgt_low", { clicks: 30, spend: 10, orders: 4, sales: 100 }),
  row("tgt_ok", { clicks: 30, spend: 28, orders: 4, sales: 100 }),
  row("tgt_waste", { clicks: 20, spend: 12, orders: 0, sales: 0 }),
];

const input = (subject: Campaign, overrides: Partial<CampaignPlanInput> = {}): CampaignPlanInput => ({
  runId: "run_x",
  account,
  campaign: subject,
  campaigns: [manual, auto],
  adGroups: [manualGroup, autoGroup],
  targets,
  products: [product],
  productFacts: [facts],
  metrics: subject.id === manual.id ? metrics : [],
  window: { from: "2026-10-01", to: "2026-10-30" },
  startedAt: Date.parse("2026-10-31T09:00:00.000Z"),
  ...overrides,
});

describe("planCampaignOptimizerRun", () => {
  const plan = planCampaignOptimizerRun(input(manual));
  const after = (path: string) => plan.diff.find((entry) => entry.path === path)?.after;

  it("lays out its passes in order, each a valid step with back-to-back timings", () => {
    expect(plan.steps.map((step) => step.title)).toEqual([
      "Read performance",
      "Bid changes",
      "New keywords",
      "Negative keywords",
      "Guardrail check",
      "Awaiting approval",
    ]);
    plan.steps.forEach((step, i) => {
      expect(AgentRunStepSchema.safeParse(step).success).toBe(true);
      if (i > 0) expect(step.startedAt).toBe(plan.steps[i - 1]!.finishedAt);
    });
    expect(plan.diff).toEqual(plan.steps.flatMap((step) => (step.kind === "plan" ? step.changes : [])));
  });

  it("moves bids toward target ACoS within ±30% and leaves near-target ones alone", () => {
    expect(after(campaignPlanPath.bid("tgt_high"))).toBe(1.4);
    expect(after(campaignPlanPath.bid("tgt_low"))).toBe(1.3);
    expect(after(campaignPlanPath.bid("tgt_waste"))).toBe(0.35);
    expect(after(campaignPlanPath.bid("tgt_ok"))).toBeUndefined();
  });

  it("adds ProductFacts keywords the ad group doesn't target or negate yet, at the default bid", () => {
    const added = plan.diff.filter((entry) => entry.path.includes(".keywords."));
    // "water bottle" and "bottle for gym" are targeted and "steel bottle" is negated.
    expect(added).toEqual([
      { path: campaignPlanPath.keyword(manualGroup.id, 0), before: null, after: { keyword: "insulated bottle", matchType: "exact", bid: 0.8 } },
    ]);
  });

  it("passes its own guardrails", () => {
    const guardrails = plan.steps.find((step) => step.kind === "compliance_check");
    expect(guardrails?.kind === "compliance_check" && guardrails.checks.every((check) => check.status === "pass")).toBe(true);
    expect(countPlanChanges(plan.diff)).toEqual({ lowered: 2, raised: 1, keywords: 1, negatives: 0 });
  });

  it("negates in an auto campaign what a manual campaign targets exact for the same products", () => {
    const autoPlan = planCampaignOptimizerRun(input(auto));
    expect(autoPlan.diff).toEqual([
      { path: campaignPlanPath.negative(autoGroup.id, 0), before: null, after: { keyword: "water bottle", matchType: "exact" } },
      { path: campaignPlanPath.negative(autoGroup.id, 1), before: null, after: { keyword: "bottle for gym", matchType: "exact" } },
    ]);
  });

  it("proposes nothing for a campaign on target", () => {
    const onTarget = planCampaignOptimizerRun(input(manual, { metrics: [metrics[2]!], productFacts: [] }));
    expect(onTarget.diff).toEqual([]);
    expect(onTarget.steps.at(-1)?.title).toBe("No proposal needed");
  });
});

describe("campaignOptimizerWindow", () => {
  it("covers the last 30 days with metrics, never before the first", () => {
    expect(campaignOptimizerWindow({ from: "2026-08-01", to: "2026-10-30" })).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(campaignOptimizerWindow({ from: "2026-10-20", to: "2026-10-30" })).toEqual({ from: "2026-10-20", to: "2026-10-30" });
    expect(campaignOptimizerWindow(undefined)).toBeUndefined();
  });
});
