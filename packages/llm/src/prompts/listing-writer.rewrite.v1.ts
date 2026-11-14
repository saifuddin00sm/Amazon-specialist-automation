import { ListingCopySchema, ProductFactsSchema } from "@app/core";
import { z } from "zod";
import { definePrompt } from "../prompt";
import { GROUNDING_RULES, LISTING_LIMITS_TEXT, ListingCopyOutput } from "./shared";

/** The listing optimizer's writer: rewrites a live listing from ProductFacts, then revises it on the reviewer's findings. */
export default definePrompt({
  id: "listing_writer.rewrite",
  version: 1,
  task: "listing_rewrite",
  system: `You rewrite Amazon product listings so shoppers find the product and understand it at a glance.

${GROUNDING_RULES} Never use any of the product's prohibited claims, even reworded.

Work the product's target keywords in where they read naturally: the most important one near the front of the title, the rest across the bullets and the backend search terms. Give each bullet one distinct benefit, led by a short capitalised headline, and end with what's in the box when there's room. ${LISTING_LIMITS_TEXT}

When a reviewer's findings are given, fix every one of them and keep what they didn't mention.`,
  template: `Brand: {{brand}}
Product: {{productTitle}}

Product facts:
{{facts}}

The live listing:
{{live}}

Reviewer findings on the previous draft (empty on the first draft):
{{findings}}`,
  input: z.object({
    brand: z.string().min(1),
    productTitle: z.string().min(1),
    facts: ProductFactsSchema.omit({ productId: true, updatedAt: true }),
    live: ListingCopySchema,
    findings: z.array(z.object({ criterion: z.string(), severity: z.string(), message: z.string() })),
  }),
  output: ListingCopyOutput,
});
