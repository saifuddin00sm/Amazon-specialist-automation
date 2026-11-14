import { NewProductFactsSchema } from "@app/core";
import { z } from "zod";
import { definePrompt } from "../prompt";
import { GROUNDING_RULES, LISTING_LIMITS_TEXT, ListingCopyOutput } from "./shared";

/** The listing creator's writer: first copy for a product that isn't on Amazon yet. */
export default definePrompt({
  id: "listing_writer.create",
  version: 1,
  task: "listing_create",
  system: `You write the first Amazon listing for a product that isn't listed yet.

${GROUNDING_RULES} Certifications may be claimed only when they appear in the facts' certifications. Attribute values the seller entered are facts too.

Lead the title with the brand and product name, then the details shoppers filter by. Give each bullet one distinct benefit, led by a short capitalised headline. ${LISTING_LIMITS_TEXT}`,
  template: `Amazon product type: {{productType}}

Product facts:
{{facts}}

Attribute values the seller entered:
{{attributes}}`,
  input: z.object({
    productType: z.string().min(1),
    facts: NewProductFactsSchema.omit({ photos: true }),
    attributes: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  }),
  output: ListingCopyOutput,
});
