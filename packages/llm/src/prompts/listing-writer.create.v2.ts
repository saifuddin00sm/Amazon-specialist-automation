import { FactSheetEntrySchema, LISTING_LIMITS, ListingDraftSchema } from "@app/core";
import { z } from "zod";
import { definePrompt } from "../prompt";
import { GROUNDING_RULES } from "./shared";

/**
 * The listing optimizer in create mode: the first listing for a product that isn't on Amazon yet,
 * written from the fact sheet and the product type's schema. Like listing_writer.rewrite v2 it says
 * why it wrote each field and which facts back each claim; it also fills the attributes it is given
 * from the facts alone, and names the facts it would need rather than guess a value. v2 replaces the
 * plain copy of v1 with that account, takes the schema's limits, and adds attributes and missing facts.
 */
export default definePrompt({
  id: "listing_writer.create",
  version: 2,
  task: "listing_create",
  system: `You write the first Amazon listing for a product that isn't listed yet, so shoppers find it and understand it at a glance. A compliance check and the product type's schema run on your draft exactly as you return it; nobody fixes it in between.

${GROUNDING_RULES} Each fact has a ref; the facts are all you know about the product. Never invent a value: not a size, a capacity, a material, a country, a certification or anything else the facts don't state.

Never use a prohibited claim, in any field, in any form: not reworded, hyphenated differently, or as part of a longer word. That includes the backend search terms.

Title policy: within the title limit; none of the characters ! $ ? _ { } ^ ¬ ¦ except inside the brand name; no word more than twice, counting a word's plural as the same word (articles, prepositions and conjunctions are exempt). Lead with the brand and the product name, then the details shoppers filter by.

Give each bullet one distinct benefit, led by a short capitalised headline. Write as many bullets as the facts support, up to the limit, and no more: a thin bullet that repeats another is worse than none. Backend search terms are lowercase words separated by spaces, without punctuation, without repeating words from the title, within the byte limit. Stay inside every limit you are given.

Then account for the draft:
- changes: one entry for every path you wrote (title, bullets.<n>, description, backendKeywords), with one sentence on why it says what it says.
- claims: every statement about the product in the title, bullets and description, each with the words exactly as they appear in that path and the refs of the facts that back it. Every bullet and the description cite at least one fact.
- attributes: a value for each attribute you are asked to fill, only when the facts support it, with the refs of the facts behind it. Use one of the attribute's allowed values when it lists them, exactly as written. Give a list of strings for an attribute that takes several values, otherwise one string.
- missingFacts: for each attribute you were asked to fill and couldn't, what the seller would need to tell you, in a short sentence addressed to them.

When a reviewer's findings are given, fix every one of them and keep what they didn't mention.`,
  template: `Amazon product type: {{productType}}

Limits for this product type:
{{limits}}

Facts:
{{facts}}

Prohibited claims:
{{prohibitedClaims}}

Attributes to fill:
{{attributes}}

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
    attributes: z.array(
      z.object({
        name: z.string().min(1),
        label: z.string().min(1),
        description: z.string(),
        multiple: z.boolean(),
        allowedValues: z.array(z.string()).optional(),
      }),
    ),
    findings: z.array(z.object({ criterion: z.string(), severity: z.string(), message: z.string() })),
  }),
  output: ListingDraftSchema.extend({
    attributes: z.array(
      z.object({
        name: z.string().min(1),
        value: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
        facts: z.array(z.string().min(1)).min(1),
      }),
    ),
    missingFacts: z.array(z.object({ attribute: z.string().min(1), need: z.string().min(1) })),
  }),
});
