import { ComplianceCheckSchema, DiffEntrySchema, LISTING_LIMITS, ListingCopySchema, RubricScoreSchema } from "@app/core";
import { z } from "zod";

/** Said in every prompt that writes or judges seller-facing copy. */
export const GROUNDING_RULES = `Claim only what the facts you are given say. Never invent certifications, awards, rankings, health or safety claims, or comparisons with other brands. If a fact you would like to use is missing, leave it out.`;

export const LISTING_LIMITS_TEXT = `Amazon's limits: a title of at most ${LISTING_LIMITS.titleMaxLength} characters; ${LISTING_LIMITS.bulletMaxCount} bullets at most, each up to ${LISTING_LIMITS.bulletMaxLength} characters; a description of at most ${LISTING_LIMITS.descriptionMaxLength} characters; backend search terms of at most ${LISTING_LIMITS.backendKeywordsMaxBytes} bytes, space separated, without repeating words from the title.`;

/** Listing copy a writer prompt returns. */
export const ListingCopyOutput = ListingCopySchema;

/** Rubric scores spelled out, so the JSON schema the model sees names every criterion. */
export const RubricScoresOutput = z.object({
  title: RubricScoreSchema,
  bullets: RubricScoreSchema,
  description: RubricScoreSchema,
  keywords: RubricScoreSchema,
  factual_accuracy: RubricScoreSchema,
  compliance: RubricScoreSchema,
});

export const ComplianceChecksInput = z.array(ComplianceCheckSchema);

/** Plan lines a planner prompt returns, in the shape of a Proposal's diff. */
export const PlanChangesOutput = z.object({ changes: z.array(DiffEntrySchema) });
