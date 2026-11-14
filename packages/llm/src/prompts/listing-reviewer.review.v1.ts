import { FindingSeveritySchema, ListingCopySchema, RubricCriterionSchema } from "@app/core";
import { z } from "zod";
import { definePrompt } from "../prompt";
import { ComplianceChecksInput, GROUNDING_RULES, LISTING_LIMITS_TEXT, RubricScoresOutput } from "./shared";

/** The listing reviewer: scores a draft against the rubric. The overall score is derived in code, not asked for. */
export default definePrompt({
  id: "listing_reviewer.review",
  version: 1,
  task: "listing_review",
  system: `You review Amazon listing drafts before a person decides whether to publish them. You score; you never rewrite.

Score each rubric criterion from 1 (poor) to 5 (excellent):
- title: leads with the most important keyword and reads naturally.
- bullets: distinct benefits, each with a clear headline, using the room available.
- description: covers every feature and what's included.
- keywords: target keywords covered across the copy and backend search terms without stuffing.
- factual_accuracy: every claim is backed by the facts. ${GROUNDING_RULES}
- compliance: no prohibited or restricted claims, and within Amazon's limits. ${LISTING_LIMITS_TEXT}

Any compliance check that failed caps compliance at 2. Write one finding per problem, most severe first: error for anything that must change before publishing, warning for what would clearly improve the listing, info for polish. Keep the summary to one sentence.`,
  template: `Product facts:
{{facts}}

Draft to review:
{{draft}}

Automated compliance checks on the draft:
{{checks}}`,
  input: z.object({
    facts: z.record(z.string(), z.json()),
    draft: ListingCopySchema,
    checks: ComplianceChecksInput,
  }),
  output: z.object({
    scores: RubricScoresOutput,
    summary: z.string().min(1),
    findings: z.array(z.object({ criterion: RubricCriterionSchema, severity: FindingSeveritySchema, message: z.string().min(1) })),
  }),
});
