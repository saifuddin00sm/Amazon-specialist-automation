import { ListingRubricCriterionSchema, type ComplianceCheck, type ListingRubricCriterion, type ListingRubricScores } from "@app/core";

/** One criterion of the rubric: its name, and how many of the 100 points it is worth. */
export type RubricCriterion = { label: string; weight: number };

/**
 * The listing rubric. A draft first has to pass the compliance gate: every rule and guardrail check
 * on it, decided in code. A draft that fails the gate scores 0, however well it reads. Past the gate,
 * the reviewer scores each criterion 0–10 and each counts for its weight; the weights add up to 100.
 * What each criterion measures is spelled out to the reviewer in its prompt (listing_reviewer.review).
 */
export const LISTING_RUBRIC: Record<ListingRubricCriterion, RubricCriterion> = {
  keyword_coverage: { label: "Keyword coverage", weight: 25 },
  grounding: { label: "Grounding", weight: 20 },
  conversion_copy: { label: "Conversion copy", weight: 20 },
  title_structure: { label: "Title structure", weight: 15 },
  attributes: { label: "Attributes", weight: 10 },
  voice: { label: "Voice", weight: 10 },
};

/** The overall a draft needs before it is proposed without a "did not reach target" flag. */
export const LISTING_REVIEW_TARGET = 85;

/** The highest score a criterion takes. */
const MAX_SCORE = 10;

export type ComplianceGate = {
  passed: boolean;
  /** What failed, as a member reads it; undefined when it passed. */
  detail?: string;
  /** The checks that keep the gate shut. */
  failing: ComplianceCheck[];
};

/** The compliance gate: shut by any check that fails. Warnings don't shut it. */
export function complianceGate(checks: readonly ComplianceCheck[]): ComplianceGate {
  const failing = checks.filter((check) => check.status === "fail");
  if (failing.length === 0) return { passed: true, failing };
  return { passed: false, detail: failing.map((check) => `${check.label}${check.detail ? `: ${check.detail}` : ""}`).join(" "), failing };
}

/** The rubric alone, gate aside: each criterion's share of its weight, added up and rounded. */
export function weightedScore(scores: ListingRubricScores): number {
  const points = ListingRubricCriterionSchema.options.reduce((sum, criterion) => sum + (scores[criterion] / MAX_SCORE) * LISTING_RUBRIC[criterion].weight, 0);
  return Math.round(points);
}

/** A draft's overall: its weighted score when it passes the gate, 0 when it doesn't. */
export function rubricScore(scores: ListingRubricScores, gate: Pick<ComplianceGate, "passed">): { overall: number; weighted: number } {
  const weighted = weightedScore(scores);
  return { overall: gate.passed ? weighted : 0, weighted };
}

/** "Keyword coverage 8/10 · 20 of 25", one line per criterion, heaviest first. */
export function rubricLines(scores: ListingRubricScores): string[] {
  return ListingRubricCriterionSchema.options.map((criterion) => {
    const { label, weight } = LISTING_RUBRIC[criterion];
    const points = Math.round((scores[criterion] / MAX_SCORE) * weight * 10) / 10;
    return `${label} ${scores[criterion]}/${MAX_SCORE} · ${points} of ${weight}`;
  });
}
