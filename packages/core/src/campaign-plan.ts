import { z } from "zod";
import { MatchTypeSchema } from "./advertising";
import { MoneySchema } from "./common";
import type { DiffEntry } from "./proposal";

/**
 * A campaign_plan Proposal targets one campaign. Each diff entry is one line of the plan, with a
 * path relative to the campaign:
 *
 *   targets.<targetId>.bid                     number → number
 *   adGroups.<adGroupId>.keywords.<n>          null → PlanKeyword
 *   adGroups.<adGroupId>.negativeKeywords.<n>  null → PlanNegative
 *
 * A line whose `after` equals its `before` is skipped.
 */
export const campaignPlanPath = {
  bid: (targetId: string) => `targets.${targetId}.bid`,
  keyword: (adGroupId: string, index: number) => `adGroups.${adGroupId}.keywords.${index}`,
  negative: (adGroupId: string, index: number) => `adGroups.${adGroupId}.negativeKeywords.${index}`,
};

/** A keyword a plan adds to an ad group. */
export const PlanKeywordSchema = z.object({ keyword: z.string(), matchType: MatchTypeSchema, bid: MoneySchema });
export type PlanKeyword = z.infer<typeof PlanKeywordSchema>;

/** A negative keyword a plan adds to an ad group. Amazon negates exact or phrase only. */
export const PlanNegativeSchema = z.object({ keyword: z.string(), matchType: z.enum(["exact", "phrase"]) });
export type PlanNegative = z.infer<typeof PlanNegativeSchema>;

export type CampaignPlanLine =
  | { kind: "bid"; path: string; targetId: string; before: number; after: number }
  /** `after` is null when the member skipped the line. */
  | { kind: "keyword"; path: string; adGroupId: string; after: PlanKeyword | null }
  | { kind: "negative"; path: string; adGroupId: string; after: PlanNegative | null };

const PLAN_PATH = /^(?:targets\.([^.]+)\.bid|adGroups\.([^.]+)\.(keywords|negativeKeywords)\.\d+)$/;

/** Reads one plan line. Undefined when the path or the values aren't a plan line. */
export function parseCampaignPlanLine(entry: DiffEntry): CampaignPlanLine | undefined {
  const match = PLAN_PATH.exec(entry.path);
  if (!match) return undefined;
  const [, targetId, adGroupId, list] = match;

  if (targetId) {
    return typeof entry.before === "number" && typeof entry.after === "number"
      ? { kind: "bid", path: entry.path, targetId, before: entry.before, after: entry.after }
      : undefined;
  }
  if (!adGroupId || entry.before !== null) return undefined;
  if (list === "keywords") {
    const after = entry.after === null ? null : PlanKeywordSchema.safeParse(entry.after);
    if (after && !after.success) return undefined;
    return { kind: "keyword", path: entry.path, adGroupId, after: after ? after.data : null };
  }
  const after = entry.after === null ? null : PlanNegativeSchema.safeParse(entry.after);
  if (after && !after.success) return undefined;
  return { kind: "negative", path: entry.path, adGroupId, after: after ? after.data : null };
}

/** True when the line changes nothing: an unchanged bid, or a keyword the member skipped. */
export function isSkippedPlanLine(line: CampaignPlanLine): boolean {
  return line.kind === "bid" ? line.after === line.before : line.after === null;
}

/** What one unit costs and earns before advertising, in the account's currency. */
export type UnitEconomics = {
  price: number;
  /** Landed cost of the product. */
  unitCost: number;
  /** Fulfillment fee per unit, e.g. FBA. */
  fulfillmentFee: number;
  /** Amazon's referral fee as a fraction of the price (0.15 = 15%). */
  referralFeeRate: number;
};

/**
 * The ACoS at which an ad-driven sale breaks even: the margin before ad spend, as a share of the
 * price. Above it every ad order loses money. Negative when the product loses money without ads;
 * undefined without a price.
 */
export function breakEvenAcos({ price, unitCost, fulfillmentFee, referralFeeRate }: UnitEconomics): number | undefined {
  if (!(price > 0)) return undefined;
  return (price - unitCost - fulfillmentFee - price * referralFeeRate) / price;
}

/** The most a click can cost to land at `acos`, given what an order is worth and how often clicks convert. */
export function maxCostPerClick(acos: number, averageOrderValue: number, conversionRate: number): number {
  return Math.max(0, acos * averageOrderValue * conversionRate);
}
