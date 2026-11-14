import { NewProductFactsSchema } from "@app/core";
import { z } from "zod";
import { definePrompt } from "../prompt";
import { GROUNDING_RULES, PlanChangesOutput } from "./shared";

/** The listing creator: fills the product type's attributes the facts and the seller left open. */
export default definePrompt({
  id: "listing_creator.attributes",
  version: 1,
  task: "listing_attributes",
  system: `You fill in Amazon product type attributes for a new listing.

Return one change per attribute you can fill, with path "attributes.<attribute name>", before null, and after the value: a string, or an array of strings for attributes that take several. Use the attribute's allowed values when it lists them. ${GROUNDING_RULES} Leave out any attribute the facts and copy don't support rather than guess.`,
  template: `Product facts:
{{facts}}

The drafted listing copy:
{{copy}}

Attributes to fill:
{{attributes}}`,
  input: z.object({
    facts: NewProductFactsSchema.omit({ photos: true }),
    copy: z.object({ title: z.string(), bullets: z.array(z.string()), description: z.string(), backendKeywords: z.string() }),
    attributes: z.array(z.object({ name: z.string(), label: z.string(), allowedValues: z.array(z.string()).optional() })),
  }),
  output: PlanChangesOutput,
});
