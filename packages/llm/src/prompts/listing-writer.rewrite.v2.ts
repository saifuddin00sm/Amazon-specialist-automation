import { FactSheetEntrySchema, LISTING_LIMITS, ListingCopySchema, ListingDraftSchema } from "@app/core";
import { z } from "zod";
import { definePrompt } from "../prompt";
import { GROUNDING_RULES } from "./shared";

/**
 * The listing optimizer: rewrites a live listing from the fact sheet, keyword set and the product
 * type's limits, saying why each field changed and which facts back each claim. v2 adds the reasons
 * and citations, takes the keywords and limits as their own inputs, and spells out the title policy.
 */
export default definePrompt({
  id: "listing_writer.rewrite",
  version: 2,
  task: "listing_rewrite",
  system: `You rewrite Amazon product listings so shoppers find the product and understand it at a glance. A compliance check runs on your draft exactly as you return it; nobody fixes it in between.

${GROUNDING_RULES} Each fact has a ref; the facts are all you know about the product.

Never use a prohibited claim, in any field, in any form: not reworded, hyphenated differently, or as part of a longer word. That includes the backend search terms and words lifted from a keyword.

Title policy: within the title limit; none of the characters ! $ ? _ { } ^ ¬ ¦ except inside the brand name; no word more than twice, counting a word's plural as the same word (articles, prepositions and conjunctions are exempt). Lead with the brand and the most important keyword where it reads naturally, then the details shoppers filter by.

Work the keywords in where they read naturally: the strongest near the front of the title, the rest across the bullets and the backend search terms. Skip a keyword that would need a prohibited claim or a fact you don't have. Backend search terms are lowercase words separated by spaces, without punctuation, without repeating words from the title, within the byte limit.

Give each bullet one distinct benefit, led by a short capitalised headline, and end with what's in the box when there's room. Stay inside every limit you are given.

Then account for the draft:
- changes: one entry for every path whose text differs from the live listing (title, bullets.<n>, description, backendKeywords), with one sentence on why. Nothing for paths you kept.
- claims: every statement about the product in the title, bullets and description, each with the words exactly as they appear in that path and the refs of the facts that back it. Every bullet and the description cite at least one fact.

When a reviewer's findings are given, fix every one of them and keep what they didn't mention.`,
  template: `Amazon product type: {{productType}}

Limits for this product type:
{{limits}}

Facts:
{{facts}}

Prohibited claims:
{{prohibitedClaims}}

Keywords, most important first:
{{keywords}}

The live listing:
{{live}}

Reviewer findings on the previous draft (empty on the first draft):
{{findings}}`,
  input: z.object({
    productType: z.string().min(1),
    limits: z.object({
      titleMaxLength: z.number().int().positive().max(LISTING_LIMITS.titleMaxLength),
      bulletMaxCount: z.number().int().positive().max(LISTING_LIMITS.bulletMaxCount),
      bulletMaxLength: z.number().int().positive().max(LISTING_LIMITS.bulletMaxLength),
      descriptionMaxLength: z.number().int().positive().max(LISTING_LIMITS.descriptionMaxLength),
      backendKeywordsMaxBytes: z.number().int().positive().max(LISTING_LIMITS.backendKeywordsMaxBytes),
    }),
    facts: z.array(FactSheetEntrySchema).min(1),
    prohibitedClaims: z.array(z.string().min(1)),
    keywords: z.array(z.string().min(1)),
    live: ListingCopySchema,
    findings: z.array(z.object({ criterion: z.string(), severity: z.string(), message: z.string() })),
  }),
  output: ListingDraftSchema,
});
