import { z } from "zod";

export const IdSchema = z.string().min(1);

/** UTC timestamp, e.g. 2026-10-30T14:05:00.000Z */
export const IsoDateTimeSchema = z.iso.datetime();

/** Calendar day, e.g. 2026-10-30 */
export const IsoDateSchema = z.iso.date();

export const MarketplaceSchema = z.enum(["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"]);
export type Marketplace = z.infer<typeof MarketplaceSchema>;

export const CurrencySchema = z.enum(["USD", "CAD", "MXN", "GBP", "EUR", "JPY"]);
export type Currency = z.infer<typeof CurrencySchema>;

/** Amount in the seller account's currency, major units (12.99 = $12.99). */
export const MoneySchema = z.number().nonnegative();

export const EntityTypeSchema = z.enum([
  "workspace",
  "member",
  "seller_account",
  "product",
  "listing_version",
  "review",
  "proposal",
  "campaign",
  "ad_group",
  "target",
  "agent_run",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntityRefSchema = z.object({
  type: EntityTypeSchema,
  id: IdSchema,
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

export const AgentNameSchema = z.enum([
  "listing_writer",
  "listing_reviewer",
  "bid_optimizer",
  "budget_pacer",
  "keyword_harvester",
  "campaign_optimizer",
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

/** Who did something. Anything with an `agent` actor gets the AIGenerated badge. */
export const ActorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member"), memberId: IdSchema }),
  z.object({ type: z.literal("agent"), agent: AgentNameSchema, agentRunId: IdSchema }),
  z.object({ type: z.literal("system") }),
]);
export type Actor = z.infer<typeof ActorSchema>;

export function isAgentProduced(actor: Actor): actor is Extract<Actor, { type: "agent" }> {
  return actor.type === "agent";
}
