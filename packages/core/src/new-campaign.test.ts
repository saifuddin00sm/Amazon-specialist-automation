import { describe, expect, it } from "vitest";
import { checkProposalCompliance, hasBlockingFailure } from "./compliance";
import {
  NewCampaignSchema,
  buildCampaignStructure,
  goalTargetAcos,
  newCampaignDiff,
  parseNewCampaignPlan,
  type CampaignBrief,
  type CampaignStructureInput,
} from "./new-campaign";
import { DEFAULT_GUARDRAILS } from "./workspace";

const product = (id: string, asin: string, category = "Kitchen", price = 30) => ({
  id,
  asin,
  title: `Northlane ${id} Insulated Bottle 750ml`,
  brand: "Northlane",
  category,
  price,
  status: "active" as const,
});

const products: CampaignStructureInput["products"] = [
  product("prod_1", "B0AAAAAAA1"),
  product("prod_2", "B0AAAAAAA2", "Kitchen", 40),
  product("prod_3", "B0AAAAAAA3"),
  product("prod_4", "B0AAAAAAA4", "Garden"),
];
const productFacts = [
  { productId: "prod_1", targetKeywords: ["insulated bottle", "Water Bottle ", "gym bottle"] },
  { productId: "prod_2", targetKeywords: ["water bottle", "steel flask"] },
];
const brief: CampaignBrief = { goal: "grow", productIds: ["prod_1", "prod_2"], dailyBudget: 50, targetAcos: 0.3, breakEvenAcos: 0.3 };
const build = (overrides: Partial<CampaignBrief> = {}, input: Partial<CampaignStructureInput> = {}) =>
  buildCampaignStructure({ brief: { ...brief, ...overrides }, products, productFacts, guardrails: DEFAULT_GUARDRAILS, ...input });

describe("goalTargetAcos", () => {
  it("scales breakeven by the goal, to the whole percent", () => {
    expect(goalTargetAcos("launch", 0.4, 0.25)).toBe(0.5);
    expect(goalTargetAcos("grow", 0.4, 0.25)).toBe(0.4);
    expect(goalTargetAcos("profit", 0.4, 0.25)).toBe(0.28);
  });

  it("falls back to the account's target without a positive breakeven", () => {
    expect(goalTargetAcos("grow", undefined, 0.25)).toBe(0.25);
    expect(goalTargetAcos("launch", -0.1, 0.25)).toBe(0.25);
  });
});

describe("buildCampaignStructure", () => {
  it("builds auto, research, performance and product targeting campaigns for the chosen products", () => {
    const { campaigns, keywords, baseBid } = build();
    expect(campaigns.map((campaign) => campaign.role)).toEqual(["auto_discovery", "research", "performance", "product_targeting"]);
    expect(campaigns.every((campaign) => NewCampaignSchema.safeParse(campaign).success)).toBe(true);
    expect(campaigns.every((campaign) => campaign.adGroups.every((adGroup) => adGroup.productIds.join() === "prod_1,prod_2"))).toBe(true);
    // ProductFacts keywords, normalized and de-duplicated.
    expect(keywords).toEqual(["insulated bottle", "water bottle", "gym bottle", "steel flask"]);
    // 30% of a $35 order at a 10% conversion rate.
    expect(baseBid).toBe(1.05);
  });

  it("splits the daily budget by the goal, to the cent", () => {
    const grow = build().campaigns.map((campaign) => campaign.dailyBudget);
    expect(grow).toEqual([10, 12.5, 20, 7.5]);
    const profit = build({ goal: "profit", dailyBudget: 33.33 }).campaigns.map((campaign) => campaign.dailyBudget);
    expect(profit.reduce((a, b) => a + b, 0)).toBeCloseTo(33.33, 2);
    expect(profit[2]).toBeGreaterThan(profit[0]!);
  });

  it("buys each keyword once: research and auto negate the exact keywords", () => {
    const [auto, research, performance] = build().campaigns;
    const exact = performance!.adGroups[0]!.targets.map((target) => (target.kind === "keyword" ? target.keyword : ""));
    expect(research!.adGroups.map((adGroup) => adGroup.name)).toEqual(["Broad research", "Phrase research"]);
    for (const adGroup of [...auto!.adGroups, ...research!.adGroups]) {
      expect(adGroup.negativeKeywords).toEqual(exact.map((keyword) => ({ keyword, matchType: "exact" })));
    }
  });

  it("targets the account's other active products in the same categories", () => {
    const targeting = build().campaigns.find((campaign) => campaign.role === "product_targeting");
    expect(targeting?.adGroups[0]?.targets).toEqual([{ kind: "product", asin: "B0AAAAAAA3", bid: 0.95 }]);
  });

  it("caps bids at the account's guardrail", () => {
    const { campaigns } = build({ targetAcos: 1 }, { guardrails: { maxBid: 2 } });
    const bids = campaigns.flatMap((campaign) => campaign.adGroups.flatMap((adGroup) => [adGroup.defaultBid, ...adGroup.targets.map((target) => target.bid)]));
    expect(Math.max(...bids)).toBe(2);
  });

  it("leaves out keyword and product campaigns it has nothing to build from", () => {
    const { campaigns, skipped } = build({ productIds: ["prod_4"] });
    expect(campaigns.map((campaign) => campaign.role)).toEqual(["auto_discovery"]);
    expect(campaigns[0]?.dailyBudget).toBe(50);
    expect(skipped.map((skip) => skip.role)).toEqual(["research", "performance", "product_targeting"]);
  });
});

describe("new_campaign compliance", () => {
  const diffFor = (overrides: Partial<CampaignBrief> = {}) => newCampaignDiff({ ...brief, ...overrides }, build(overrides).campaigns);

  it("passes a plan the strategist built, and round-trips it", () => {
    const diff = diffFor();
    expect(parseNewCampaignPlan(diff)).toMatchObject({ brief, unreadable: [] });
    const checks = checkProposalCompliance({ type: "new_campaign", diff, guardrails: DEFAULT_GUARDRAILS });
    expect(checks.filter((check) => check.status !== "pass")).toEqual([]);
  });

  it("warns when the target ACoS is above breakeven", () => {
    const checks = checkProposalCompliance({ type: "new_campaign", diff: diffFor({ goal: "launch", targetAcos: 0.38 }), guardrails: DEFAULT_GUARDRAILS });
    expect(checks.find((check) => check.id === "acos_breakeven")).toMatchObject({ status: "warn" });
    expect(hasBlockingFailure(checks)).toBe(false);
  });

  it("blocks a campaign budget above the cap and a keyword targeted and negated alike", () => {
    const diff = diffFor({ dailyBudget: 500 });
    const checks = checkProposalCompliance({ type: "new_campaign", diff, guardrails: { ...DEFAULT_GUARDRAILS, maxDailyBudget: 100 } });
    expect(checks.find((check) => check.id === "budget_max")).toMatchObject({ status: "fail" });

    const [briefLine, ...campaignLines] = diffFor();
    const performance = parseNewCampaignPlan(campaignLines).campaigns[2]!;
    const [exact] = performance.adGroups;
    const clashing = { ...performance, adGroups: [{ ...exact!, negativeKeywords: [{ keyword: "insulated bottle", matchType: "exact" as const }] }] };
    const conflicted = checkProposalCompliance({
      type: "new_campaign",
      diff: [briefLine!, { path: "campaigns.0", before: null, after: clashing }],
      guardrails: DEFAULT_GUARDRAILS,
    });
    expect(conflicted.find((check) => check.id === "plan_conflicts")).toMatchObject({ status: "fail" });
  });

  it("blocks a diff without a brief or campaigns", () => {
    const checks = checkProposalCompliance({ type: "new_campaign", diff: [{ path: "campaigns.0", before: null, after: { nope: true } }] });
    expect(checks).toEqual([expect.objectContaining({ id: "plan_lines", status: "fail" })]);
  });
});
