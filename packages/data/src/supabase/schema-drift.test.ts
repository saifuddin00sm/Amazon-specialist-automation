import {
  AdStateSchema,
  AgentNameSchema,
  AgentRunSchema,
  AgentRunStatusSchema,
  AuditActionSchema,
  AutoTargetTypeSchema,
  AutonomyLevelSchema,
  BiddingStrategySchema,
  CampaignSchema,
  CampaignTypeSchema,
  CurrencySchema,
  EntityTypeSchema,
  ListingVersionStatusSchema,
  MarketplaceSchema,
  MatchTypeSchema,
  MemberRoleSchema,
  ProductStatusSchema,
  ProposalRiskSchema,
  ProposalStatusSchema,
  ProposalTypeSchema,
  WorkspaceKindSchema,
  allowedStatusChanges,
} from "@app/core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Constants } from "./database.types";

/** Zod in packages/core is the source of truth; the database enums (from `pnpm db:types`) must match it. */
const ZOD_ENUMS: Record<keyof typeof Constants.public.Enums, readonly string[]> = {
  ad_state: AdStateSchema.options,
  agent_name: AgentNameSchema.options,
  agent_run_status: AgentRunStatusSchema.options,
  agent_run_trigger: AgentRunSchema.shape.trigger.options,
  audit_action: AuditActionSchema.options,
  auto_target_type: AutoTargetTypeSchema.options,
  autonomy_level: AutonomyLevelSchema.options,
  bidding_strategy: BiddingStrategySchema.options,
  campaign_type: CampaignTypeSchema.options,
  currency: CurrencySchema.options,
  entity_type: EntityTypeSchema.options,
  listing_version_status: ListingVersionStatusSchema.options,
  marketplace: MarketplaceSchema.options,
  match_type: MatchTypeSchema.options,
  member_role: MemberRoleSchema.options,
  metrics_entity_type: ["product", "campaign", "target"],
  product_status: ProductStatusSchema.options,
  proposal_risk: ProposalRiskSchema.options,
  proposal_status: ProposalStatusSchema.options,
  proposal_type: ProposalTypeSchema.options,
  target_kind: ["keyword", "product", "auto"],
  targeting_type: CampaignSchema.shape.targetingType.options,
  workspace_kind: WorkspaceKindSchema.options,
};

describe("database schema", () => {
  it.each(Object.entries(ZOD_ENUMS))("enum %s matches the Zod schema", (name, values) => {
    expect([...Constants.public.Enums[name as keyof typeof ZOD_ENUMS]]).toEqual([...values]);
  });

  it("allows the proposal status changes packages/core allows", () => {
    const migration = readFileSync(new URL("../../../../supabase/migrations/20261101000014_proposal_transitions.sql", import.meta.url), "utf8");
    const trigger = migration.slice(migration.indexOf("not in ("), migration.indexOf(") then"));
    const pairs = [...trigger.matchAll(/\('(\w+)', '(\w+)'\)/g)].map(([, from, to]) => [from, to]);
    expect(pairs).toEqual(allowedStatusChanges());
  });
});
