import { z } from "zod";
import { AutoTargetTypeSchema, BiddingStrategySchema, MatchTypeSchema, type AutoTargetType, type BiddingStrategy } from "./advertising";
import { PlanNegativeSchema, maxCostPerClick, type UnitEconomics } from "./campaign-plan";
import { AsinSchema, type Product, type ProductFacts } from "./catalog";
import { IdSchema, MoneySchema } from "./common";
import type { DiffEntry } from "./proposal";
import type { Guardrails } from "./workspace";

/**
 * A new_campaign Proposal builds campaigns that don't exist yet, for one seller account. Its diff is
 * the brief the member gave the strategist, then one line per campaign, each created from nothing:
 *
 *   brief         null → CampaignBrief
 *   campaigns.<n> null → NewCampaign (with its ad groups, targets, bids and budget)
 */
export const newCampaignPath = {
  brief: "brief",
  campaign: (index: number) => `campaigns.${index}`,
};

/** What the campaigns are for. It sets how far above or below breakeven they bid and where budget goes. */
export const CampaignGoalSchema = z.enum(["launch", "grow", "profit"]);
export type CampaignGoal = z.infer<typeof CampaignGoalSchema>;

/** The part each campaign plays in the structure. */
export const CampaignRoleSchema = z.enum(["auto_discovery", "research", "performance", "product_targeting"]);
export type CampaignRole = z.infer<typeof CampaignRoleSchema>;

/** What the member asked the strategist for in the New campaign wizard. */
export const CampaignBriefSchema = z.object({
  goal: CampaignGoalSchema,
  productIds: z.array(IdSchema).min(1),
  /** Total for every campaign in the plan, per day. */
  dailyBudget: MoneySchema.positive(),
  targetAcos: z.number().positive().max(1),
  /** From the member's price, fees and product cost; negative when the product loses money without ads. */
  breakEvenAcos: z.number().max(1).optional(),
});
export type CampaignBrief = z.infer<typeof CampaignBriefSchema>;

export const NewTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keyword"), keyword: z.string().min(1), matchType: MatchTypeSchema, bid: MoneySchema }),
  z.object({ kind: z.literal("product"), asin: AsinSchema, bid: MoneySchema }),
  z.object({ kind: z.literal("auto"), autoType: AutoTargetTypeSchema, bid: MoneySchema }),
]);
export type NewTarget = z.infer<typeof NewTargetSchema>;

export const NewAdGroupSchema = z.object({
  name: z.string().min(1),
  defaultBid: MoneySchema,
  productIds: z.array(IdSchema).min(1),
  targets: z.array(NewTargetSchema),
  negativeKeywords: z.array(PlanNegativeSchema),
});
export type NewAdGroup = z.infer<typeof NewAdGroupSchema>;

/** A Sponsored Products campaign the plan would create, with everything inside it. */
export const NewCampaignSchema = z.object({
  role: CampaignRoleSchema,
  name: z.string().min(1).max(128),
  targetingType: z.enum(["auto", "manual"]),
  dailyBudget: MoneySchema,
  biddingStrategy: BiddingStrategySchema,
  adGroups: z.array(NewAdGroupSchema).min(1),
});
export type NewCampaign = z.infer<typeof NewCampaignSchema>;

/** Reads a new_campaign diff. Lines that aren't the brief or a campaign land in `unreadable`. */
export function parseNewCampaignPlan(diff: readonly DiffEntry[]): {
  brief: CampaignBrief | undefined;
  campaigns: NewCampaign[];
  unreadable: DiffEntry[];
} {
  let brief: CampaignBrief | undefined;
  const campaigns: NewCampaign[] = [];
  const unreadable: DiffEntry[] = [];
  for (const entry of diff) {
    if (entry.before !== null) {
      unreadable.push(entry);
    } else if (entry.path === newCampaignPath.brief) {
      const parsed = CampaignBriefSchema.safeParse(entry.after);
      if (parsed.success && !brief) brief = parsed.data;
      else unreadable.push(entry);
    } else if (/^campaigns\.\d+$/.test(entry.path)) {
      const parsed = NewCampaignSchema.safeParse(entry.after);
      if (parsed.success) campaigns.push(parsed.data);
      else unreadable.push(entry);
    } else {
      unreadable.push(entry);
    }
  }
  return { brief, campaigns, unreadable };
}

type GoalProfile = {
  label: string;
  description: string;
  /** Target ACoS as a multiple of breakeven ACoS. */
  acosFactor: number;
  /** Starting total daily budget for one product; each extra product adds BUDGET_PER_EXTRA_PRODUCT. */
  dailyBudget: number;
  biddingStrategy: BiddingStrategy;
  /** Share of the daily budget per campaign, before campaigns the plan leaves out are taken away. */
  budgetShares: Record<CampaignRole, number>;
};

export const CAMPAIGN_GOALS: Record<CampaignGoal, GoalProfile> = {
  launch: {
    label: "Launch",
    description: "Buy visibility for a new product. Bids above breakeven on purpose, with more budget on discovery.",
    acosFactor: 1.25,
    dailyBudget: 60,
    biddingStrategy: "dynamic_up_and_down",
    budgetShares: { auto_discovery: 0.3, research: 0.3, performance: 0.25, product_targeting: 0.15 },
  },
  grow: {
    label: "Grow",
    description: "Scale sales at about breakeven, with budget spread across discovery and proven keywords.",
    acosFactor: 1,
    dailyBudget: 40,
    biddingStrategy: "dynamic_down_only",
    budgetShares: { auto_discovery: 0.2, research: 0.25, performance: 0.4, product_targeting: 0.15 },
  },
  profit: {
    label: "Profit",
    description: "Protect margin. Keeps ACoS well under breakeven and puts most budget on exact keywords.",
    acosFactor: 0.7,
    dailyBudget: 25,
    biddingStrategy: "dynamic_down_only",
    budgetShares: { auto_discovery: 0.1, research: 0.15, performance: 0.6, product_targeting: 0.15 },
  },
};

export const CAMPAIGN_ROLE_LABELS: Record<CampaignRole, string> = {
  auto_discovery: "Auto discovery",
  research: "Broad/phrase research",
  performance: "Exact performance",
  product_targeting: "Product targeting",
};

const BUDGET_PER_EXTRA_PRODUCT = 10;

/** Clicks that turn into orders, until the products have ad data of their own. */
export const ASSUMED_CONVERSION_RATE = 0.1;

/**
 * Rough unit economics for a price, for a calculator to start from: product cost 30% of the price,
 * fulfillment 15% up to 8, and a 15% referral fee.
 */
export function estimatedUnitEconomics(price: number): UnitEconomics {
  return {
    price: cents(price),
    unitCost: cents(price * 0.3),
    fulfillmentFee: cents(Math.min(price * 0.15, 8)),
    referralFeeRate: 0.15,
  };
}

/**
 * The target ACoS a goal implies, to the whole percent: breakeven times the goal's factor. Falls back
 * to `fallback` (the account's target) when there is no breakeven or no margin to work with.
 */
export function goalTargetAcos(goal: CampaignGoal, breakEven: number | undefined, fallback: number): number {
  if (breakEven === undefined || !(breakEven > 0)) return fallback;
  return Math.min(1, Math.max(0.05, Math.round(breakEven * CAMPAIGN_GOALS[goal].acosFactor * 100) / 100));
}

/** A goal's starting daily budget for `productCount` products, within the account's per-campaign cap. */
export function suggestedDailyBudget(goal: CampaignGoal, productCount: number): number {
  return CAMPAIGN_GOALS[goal].dailyBudget + BUDGET_PER_EXTRA_PRODUCT * Math.max(0, productCount - 1);
}

/** Bids relative to the base bid (the most a click can cost at target ACoS), by what the target is for. */
const BID_FACTORS = {
  auto: { close_match: 0.8, loose_match: 0.65, substitutes: 0.65, complements: 0.5 } satisfies Record<AutoTargetType, number>,
  broad: 0.7,
  phrase: 0.85,
  exact: 1,
  product: 0.9,
};
const MIN_BID = 0.1;
/** Keyword caps that keep a plan short enough to review campaign by campaign. */
const MAX_RESEARCH_KEYWORDS = 20;
const MAX_EXACT_KEYWORDS = 10;
const MAX_PRODUCT_TARGETS = 10;
const NAME_MAX_LENGTH = 128;
// Amazon's limits, as in AD_GUARDRAILS. compliance.ts checks plans with this module, so it can't be imported here.
const KEYWORD_MAX_LENGTH = 80;
const KEYWORD_MAX_WORDS = 10;
const MIN_DAILY_BUDGET = 1;

export type CampaignStructureInput = {
  brief: CampaignBrief;
  /** The account's catalog. The brief's products are advertised; others in their categories are targeted. */
  products: readonly Pick<Product, "id" | "asin" | "title" | "brand" | "category" | "price" | "status">[];
  productFacts: readonly Pick<ProductFacts, "productId" | "targetKeywords">[];
  guardrails: Pick<Guardrails, "maxBid">;
};

export type CampaignStructure = {
  campaigns: NewCampaign[];
  /** Roles the plan leaves out, and why. */
  skipped: { role: CampaignRole; reason: string }[];
  /** Keywords from the products' ProductFacts, in the order they're used. */
  keywords: string[];
  averagePrice: number;
  /** The most a click can cost at the target ACoS; every bid is a share of it. */
  baseBid: number;
};

/**
 * The campaigns the strategist builds for a brief: auto discovery, broad and phrase research on the
 * products' ProductFacts keywords, exact performance on the strongest of them, and product targeting
 * on the account's other products in the same categories. Research and auto negate the exact
 * keywords so each query is bought in one place. Pure, so the wizard previews exactly what the
 * strategist will propose.
 */
export function buildCampaignStructure({ brief, products, productFacts, guardrails }: CampaignStructureInput): CampaignStructure {
  const chosen = new Set(brief.productIds);
  const advertised = products.filter((product) => chosen.has(product.id));
  const productIds = advertised.map((product) => product.id);
  const averagePrice = advertised.length > 0 ? cents(advertised.reduce((sum, product) => sum + product.price, 0) / advertised.length) : 0;
  const baseBid = cents(maxCostPerClick(brief.targetAcos, averagePrice, ASSUMED_CONVERSION_RATE));
  const bid = (factor: number) => Math.min(guardrails.maxBid, Math.max(MIN_BID, cents(baseBid * factor)));
  const goal = CAMPAIGN_GOALS[brief.goal];

  const factsById = new Map(productFacts.map((facts) => [facts.productId, facts]));
  const keywords = unique(advertised.flatMap((product) => factsById.get(product.id)?.targetKeywords ?? []).map(normalize))
    .filter((keyword) => keyword !== "" && keyword.length <= KEYWORD_MAX_LENGTH && keyword.split(" ").length <= KEYWORD_MAX_WORDS)
    .slice(0, MAX_RESEARCH_KEYWORDS);
  const exact = keywords.slice(0, MAX_EXACT_KEYWORDS);
  const funnel = exact.map((keyword) => ({ keyword, matchType: "exact" as const }));

  const categories = new Set(advertised.map((product) => product.category));
  const asins = products
    .filter((product) => !chosen.has(product.id) && product.status === "active" && categories.has(product.category))
    .map((product) => product.asin)
    .slice(0, MAX_PRODUCT_TARGETS);

  const prefix = planName(advertised);
  const name = (role: CampaignRole) => `${prefix} | SP | ${CAMPAIGN_ROLE_LABELS[role]}`.slice(0, NAME_MAX_LENGTH);
  const adGroup = (groupName: string, defaultBid: number, targets: NewTarget[], negativeKeywords: NewAdGroup["negativeKeywords"] = []): NewAdGroup => ({
    name: groupName,
    defaultBid,
    productIds,
    targets,
    negativeKeywords,
  });

  const drafts: Omit<NewCampaign, "dailyBudget">[] = [];
  const skipped: CampaignStructure["skipped"] = [];
  drafts.push({
    role: "auto_discovery",
    name: name("auto_discovery"),
    targetingType: "auto",
    biddingStrategy: goal.biddingStrategy,
    adGroups: [
      adGroup(
        "Auto discovery",
        bid(BID_FACTORS.auto.close_match),
        AutoTargetTypeSchema.options.map((autoType) => ({ kind: "auto", autoType, bid: bid(BID_FACTORS.auto[autoType]) })),
        funnel,
      ),
    ],
  });
  if (keywords.length > 0) {
    const research = (matchType: "broad" | "phrase") =>
      adGroup(
        matchType === "broad" ? "Broad research" : "Phrase research",
        bid(BID_FACTORS[matchType]),
        keywords.map((keyword) => ({ kind: "keyword", keyword, matchType, bid: bid(BID_FACTORS[matchType]) })),
        funnel,
      );
    drafts.push({ role: "research", name: name("research"), targetingType: "manual", biddingStrategy: goal.biddingStrategy, adGroups: [research("broad"), research("phrase")] });
    drafts.push({
      role: "performance",
      name: name("performance"),
      targetingType: "manual",
      biddingStrategy: goal.biddingStrategy,
      adGroups: [adGroup("Exact performance", bid(BID_FACTORS.exact), exact.map((keyword) => ({ kind: "keyword", keyword, matchType: "exact", bid: bid(BID_FACTORS.exact) })))],
    });
  } else {
    const reason = "The products' ProductFacts have no target keywords yet.";
    skipped.push({ role: "research", reason }, { role: "performance", reason });
  }
  if (asins.length > 0) {
    drafts.push({
      role: "product_targeting",
      name: name("product_targeting"),
      targetingType: "manual",
      biddingStrategy: goal.biddingStrategy,
      adGroups: [adGroup("Product targeting", bid(BID_FACTORS.product), asins.map((asin) => ({ kind: "product", asin, bid: bid(BID_FACTORS.product) })))],
    });
  } else {
    skipped.push({ role: "product_targeting", reason: "No other active products in the same categories to target." });
  }

  const budgets = splitBudget(brief.dailyBudget, drafts.map((draft) => goal.budgetShares[draft.role]));
  return {
    campaigns: drafts.map((draft, i) => ({ ...draft, dailyBudget: budgets[i]! })),
    skipped,
    keywords,
    averagePrice,
    baseBid,
  };
}

/** The diff of a new_campaign Proposal: the brief, then each campaign. */
export function newCampaignDiff(brief: CampaignBrief, campaigns: readonly NewCampaign[]): DiffEntry[] {
  return [
    { path: newCampaignPath.brief, before: null, after: brief },
    ...campaigns.map((campaign, i) => ({ path: newCampaignPath.campaign(i), before: null, after: campaign })),
  ];
}

/** The smallest total daily budget that gives each of `campaignCount` campaigns Amazon's minimum. */
export function minimumPlanBudget(campaignCount: number): number {
  return campaignCount * MIN_DAILY_BUDGET;
}

/** Splits `total` by `shares`, to the cent, with Amazon's minimum each; rounding goes to the largest share. */
function splitBudget(total: number, shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0);
  const budgets = shares.map((share) => Math.max(MIN_DAILY_BUDGET, Math.floor((total * share * 100) / sum) / 100));
  const largest = shares.indexOf(Math.max(...shares));
  const rest = cents(total - budgets.reduce((a, b) => a + b, 0));
  if (largest >= 0 && budgets[largest]! + rest >= MIN_DAILY_BUDGET) budgets[largest] = cents(budgets[largest]! + rest);
  return budgets;
}

/** "Yoga Mat Extra Thick" for one product, "Brand · 3 products" for several. */
function planName(products: readonly Pick<Product, "title" | "brand">[]): string {
  const [first] = products;
  if (!first) return "New campaign";
  if (products.length === 1) return first.title.split(/\s+/).slice(0, 4).join(" ").replace(/[,–-]+$/, "");
  const brand = products.every((product) => product.brand === first.brand) ? first.brand : "Catalog";
  return `${brand} · ${products.length} products`;
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
