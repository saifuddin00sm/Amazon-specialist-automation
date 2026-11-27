import { z } from "zod";
import { ActorSchema, IdSchema, IsoDateTimeSchema } from "./common";

export const RubricCriterionSchema = z.enum([
  "title",
  "bullets",
  "description",
  "keywords",
  "factual_accuracy",
  "compliance",
]);
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

/** 1 (poor) to 5 (excellent) for every criterion. */
export const RubricScoreSchema = z.number().int().min(1).max(5);

export const RubricScoresSchema = z.record(RubricCriterionSchema, RubricScoreSchema);
export type RubricScores = z.infer<typeof RubricScoresSchema>;

/**
 * The listing rubric the listing reviewer scores against (packages/agents/src/rubric.ts holds its
 * weights, the compliance gate and the target). Reviews written before it use the criteria above.
 */
export const ListingRubricCriterionSchema = z.enum(["keyword_coverage", "grounding", "conversion_copy", "title_structure", "attributes", "voice"]);
export type ListingRubricCriterion = z.infer<typeof ListingRubricCriterionSchema>;

/** 0 (missing) to 10 (excellent) for every listing rubric criterion. */
export const ListingRubricScoreSchema = z.number().int().min(0).max(10);

export const ListingRubricScoresSchema = z.record(ListingRubricCriterionSchema, ListingRubricScoreSchema);
export type ListingRubricScores = z.infer<typeof ListingRubricScoresSchema>;

/** A review's scores: the listing rubric's, or the 1–5 criteria of reviews written before it. */
export const ReviewScoresSchema = z.union([ListingRubricScoresSchema, RubricScoresSchema]);
export type ReviewScores = z.infer<typeof ReviewScoresSchema>;

export function isListingRubricScores(scores: ReviewScores): scores is ListingRubricScores {
  return ListingRubricCriterionSchema.options.every((criterion) => criterion in scores);
}

/** What a finding is about: a rubric criterion, or (before the listing rubric) a 1–5 criterion. */
export const ReviewCriterionSchema = z.union([ListingRubricCriterionSchema, RubricCriterionSchema]);
export type ReviewCriterion = z.infer<typeof ReviewCriterionSchema>;

export const FindingSeveritySchema = z.enum(["info", "warning", "error"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const ReviewReportSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(
    z.object({
      criterion: ReviewCriterionSchema,
      severity: FindingSeveritySchema,
      message: z.string().min(1),
    }),
  ),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

/** A rubric evaluation of one ListingVersion. */
export const ReviewSchema = z.object({
  id: IdSchema,
  listingVersionId: IdSchema,
  scores: ReviewScoresSchema,
  /** 0–100, derived from the rubric scores. */
  overall: z.number().int().min(0).max(100),
  report: ReviewReportSchema,
  reviewer: ActorSchema,
  createdAt: IsoDateTimeSchema,
});
export type Review = z.infer<typeof ReviewSchema>;

/** Maps rubric scores (1–5 each) onto 0–100. */
export function overallScore(scores: RubricScores): number {
  const values = Object.values(scores);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(((mean - 1) / 4) * 100);
}
