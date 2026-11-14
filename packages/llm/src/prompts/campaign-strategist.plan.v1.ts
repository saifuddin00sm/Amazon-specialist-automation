import { CampaignBriefSchema, CampaignRoleSchema } from "@app/core";
import { z } from "zod";
import { definePrompt } from "../prompt";
import { PlanChangesOutput } from "./shared";

/** The campaign strategist: designs one campaign of a new plan, for one role in the structure. */
export default definePrompt({
  id: "campaign_strategist.plan",
  version: 1,
  task: "campaign_strategy",
  system: `You design new Amazon Sponsored Products campaigns from a seller's brief. A plan has up to four campaigns, each with one role:
- auto_discovery: automatic targeting to find search terms.
- research: broad and phrase match on the product's keywords.
- performance: exact match on the keywords most likely to convert.
- product_targeting: competitor and complementary product pages.

Design the campaign for the role you're given: its name, its share of the daily budget, its ad groups and their targets, with bids no higher than the base bid allows at the target ACoS. Stay inside the guardrails. Return the campaign as one change with path "campaigns.<index>", before null, and after the campaign.`,
  template: `Role: {{role}}

Brief:
{{brief}}

Products:
{{products}}

Guardrails:
{{guardrails}}`,
  input: z.object({
    role: CampaignRoleSchema,
    brief: CampaignBriefSchema,
    products: z.array(z.object({ title: z.string(), price: z.number(), keywords: z.array(z.string()) })),
    guardrails: z.record(z.string(), z.json()),
  }),
  output: PlanChangesOutput,
});
