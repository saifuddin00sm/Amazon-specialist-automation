import { FactSheetEntrySchema, FindingSeveritySchema, ListingCopyPathSchema, ListingCopySchema, ListingRubricCriterionSchema, ListingRubricScoreSchema } from "@app/core";
import { z } from "zod";
import { definePrompt } from "../prompt";
import { ComplianceChecksInput, GROUNDING_RULES, LISTING_LIMITS_TEXT } from "./shared";

/** Every listing rubric criterion spelled out, so the JSON schema the model sees names each one. */
const ListingRubricScoresOutput = z.object({
  keyword_coverage: ListingRubricScoreSchema,
  grounding: ListingRubricScoreSchema,
  conversion_copy: ListingRubricScoreSchema,
  title_structure: ListingRubricScoreSchema,
  attributes: ListingRubricScoreSchema,
  voice: ListingRubricScoreSchema,
});

/**
 * The listing reviewer: scores a draft against the listing rubric and says what to fix. v2 moves to
 * the listing rubric (six criteria, 0–10 each, weighted in code), reads the draft's citations and
 * the target keywords, and leaves compliance to the gate: the checks decide it, not the model. The
 * overall score is derived in code, not asked for.
 */
export default definePrompt({
  id: "listing_reviewer.review",
  version: 2,
  task: "listing_review",
  system: `You review Amazon listing drafts before a person decides whether to publish them. You score and say what to fix; you never rewrite. Another model wrote the draft; judge it on what it says, not on how sure it sounds.

Score each criterion from 0 (missing) to 10 (excellent):
- keyword_coverage: the target keywords appear where shoppers and search weigh them, the most important nearest the front of the title, the rest across the bullets and backend search terms, read naturally and without stuffing. A keyword left out because it would need a prohibited claim or a missing fact is not a gap.
- grounding: every statement about the product is backed by the facts, and each claim cites the refs that back it. ${GROUNDING_RULES} One unsupported claim caps this at 3.
- conversion_copy: each bullet leads with a short headline and gives one distinct benefit a shopper cares about; the description covers every feature and what's in the box; nothing repeats.
- title_structure: brand first, then what the product is with the main keyword, then the details shoppers filter by, in that order, within the limits and readable at a glance.
- attributes: the attributes shoppers filter and compare on (material, size, color, capacity, what's included, and the attribute values listed) are stated plainly and agree with the facts and those values.
- voice: plain, confident and specific; no hype, filler, shouting or exclamation, and consistent from title to description.

${LISTING_LIMITS_TEXT}

Compliance is a gate the checks decide, not a criterion: don't score it, and don't repeat a failing check as a finding. Write one finding per problem, most severe first, each saying exactly what to change and where (title, bullets.<n>, description, backendKeywords): error for anything that keeps the listing from being worth publishing, warning for what would clearly improve it, info for polish. Keep the summary to one sentence.`,
  template: `Amazon product type: {{productType}}

Facts:
{{facts}}

Target keywords, most important first:
{{keywords}}

Attribute values the listing will have (empty when it only changes the copy):
{{attributes}}

Draft to review, with the facts each claim cites:
{{draft}}

Automated compliance checks on the draft:
{{checks}}`,
  input: z.object({
    productType: z.string().min(1),
    facts: z.array(FactSheetEntrySchema).min(1),
    keywords: z.array(z.string().min(1)),
    attributes: z.array(z.object({ label: z.string().min(1), value: z.union([z.string(), z.array(z.string())]) })),
    draft: z.object({
      listing: ListingCopySchema,
      claims: z.array(z.object({ path: ListingCopyPathSchema, text: z.string().min(1), facts: z.array(z.string().min(1)) })),
    }),
    checks: ComplianceChecksInput,
  }),
  output: z.object({
    scores: ListingRubricScoresOutput,
    summary: z.string().min(1),
    findings: z.array(z.object({ criterion: ListingRubricCriterionSchema, severity: FindingSeveritySchema, message: z.string().min(1) })),
  }),
});
