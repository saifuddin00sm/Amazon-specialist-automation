import { z } from "zod";
import { AsinSchema } from "./catalog";
import { IdSchema, IsoDateSchema, MoneySchema } from "./common";

export const AdStateSchema = z.enum(["enabled", "paused", "archived"]);
export type AdState = z.infer<typeof AdStateSchema>;

export const CampaignTypeSchema = z.enum(["sponsored_products", "sponsored_brands", "sponsored_display"]);
export type CampaignType = z.infer<typeof CampaignTypeSchema>;

export const BiddingStrategySchema = z.enum(["fixed", "dynamic_down_only", "dynamic_up_and_down"]);
export type BiddingStrategy = z.infer<typeof BiddingStrategySchema>;

export const CampaignSchema = z.object({
  id: IdSchema,
  sellerAccountId: IdSchema,
  name: z.string().min(1),
  type: CampaignTypeSchema,
  targetingType: z.enum(["auto", "manual"]),
  state: AdStateSchema,
  dailyBudget: MoneySchema.positive(),
  biddingStrategy: BiddingStrategySchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema.optional(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const AdGroupSchema = z.object({
  id: IdSchema,
  campaignId: IdSchema,
  name: z.string().min(1),
  state: AdStateSchema,
  defaultBid: MoneySchema.positive(),
  /** Products advertised in this ad group. */
  productIds: z.array(IdSchema).min(1),
});
export type AdGroup = z.infer<typeof AdGroupSchema>;

export const MatchTypeSchema = z.enum(["exact", "phrase", "broad"]);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const AutoTargetTypeSchema = z.enum(["close_match", "loose_match", "substitutes", "complements"]);
export type AutoTargetType = z.infer<typeof AutoTargetTypeSchema>;

const targetBase = {
  id: IdSchema,
  adGroupId: IdSchema,
  state: AdStateSchema,
  /** Negative targets block traffic and have no bid. */
  negative: z.boolean(),
  bid: MoneySchema.positive().optional(),
};

export const TargetSchema = z
  .discriminatedUnion("kind", [
    z.object({ ...targetBase, kind: z.literal("keyword"), keyword: z.string().min(1), matchType: MatchTypeSchema }),
    z.object({ ...targetBase, kind: z.literal("product"), asin: AsinSchema }),
    z.object({ ...targetBase, kind: z.literal("auto"), autoType: AutoTargetTypeSchema }),
  ])
  .refine((target) => (target.negative ? target.bid === undefined : target.bid !== undefined), {
    message: "Positive targets need a bid; negative targets must not have one",
    path: ["bid"],
  });
export type Target = z.infer<typeof TargetSchema>;
