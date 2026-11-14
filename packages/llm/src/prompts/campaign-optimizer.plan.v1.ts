import { z } from "zod";
import { definePrompt } from "../prompt";
import { PlanChangesOutput } from "./shared";

/** The campaign optimizer: one pass over a campaign's performance, for bids, new keywords or negatives. */
export default definePrompt({
  id: "campaign_optimizer.plan",
  version: 1,
  task: "campaign_optimize",
  system: `You manage Amazon Sponsored Products campaigns against the seller's target ACoS. Each call works on one focus:
- bids: lower bids on targets spending above target ACoS, raise them on targets converting well below it. Never raise a bid above the guardrail maximum or change one by more than the guardrail allows.
- keywords: add search terms that ordered at or below target ACoS and aren't targeted yet.
- negatives: add negative keywords for search terms that spent without ordering, or that another campaign already targets.

Return only changes the numbers support, each as a line of the campaign plan's diff with the path, the value before and the value after. Return no changes when nothing clears the bar.`,
  template: `Focus: {{focus}}

Campaign:
{{campaign}}

Guardrails:
{{guardrails}}

Performance over the analysis window:
{{performance}}`,
  input: z.object({
    focus: z.enum(["bids", "keywords", "negatives"]),
    campaign: z.object({ name: z.string(), dailyBudget: z.number(), targetAcos: z.number() }),
    guardrails: z.record(z.string(), z.json()),
    performance: z.record(z.string(), z.json()),
  }),
  output: PlanChangesOutput,
});
