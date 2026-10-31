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

export const FindingSeveritySchema = z.enum(["info", "warning", "error"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const ReviewReportSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(
    z.object({
      criterion: RubricCriterionSchema,
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
  scores: RubricScoresSchema,
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
