import { ListingRubricCriterionSchema, type ComplianceCheck, type ListingRubricScores } from "@app/core";
import { PROMPTS } from "@app/llm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LISTING_REVIEW_TARGET, LISTING_RUBRIC, complianceGate, rubricLines, rubricScore, weightedScore } from "./rubric";

const perfect: ListingRubricScores = { keyword_coverage: 10, grounding: 10, conversion_copy: 10, title_structure: 10, attributes: 10, voice: 10 };

describe("the listing rubric", () => {
  it("weighs keyword coverage 25, grounding 20, conversion copy 20, title structure 15, attributes 10 and voice 10", () => {
    expect(Object.fromEntries(Object.entries(LISTING_RUBRIC).map(([criterion, { weight }]) => [criterion, weight]))).toEqual({
      keyword_coverage: 25,
      grounding: 20,
      conversion_copy: 20,
      title_structure: 15,
      attributes: 10,
      voice: 10,
    });
    expect(Object.values(LISTING_RUBRIC).reduce((sum, { weight }) => sum + weight, 0)).toBe(100);
    expect(LISTING_REVIEW_TARGET).toBe(85);
  });

  it("scores exactly the criteria the reviewer's prompt asks for", () => {
    const asked = z.toJSONSchema(PROMPTS.listingReview.output) as unknown as { properties: { scores: { properties: Record<string, unknown> } } };
    expect(Object.keys(asked.properties.scores.properties).sort()).toEqual([...ListingRubricCriterionSchema.options].sort());
    expect(Object.keys(LISTING_RUBRIC).sort()).toEqual([...ListingRubricCriterionSchema.options].sort());
  });

  it("counts each criterion for its share of its weight", () => {
    expect(weightedScore(perfect)).toBe(100);
    expect(weightedScore({ ...perfect, keyword_coverage: 0 })).toBe(75);
    // 25×0.8 + 20×0.9 + 20×0.7 + 15×0.6 + 10×1 + 10×0.5 = 20 + 18 + 14 + 9 + 10 + 5
    expect(weightedScore({ keyword_coverage: 8, grounding: 9, conversion_copy: 7, title_structure: 6, attributes: 10, voice: 5 })).toBe(76);
  });

  it("scores 0 behind a shut compliance gate, keeping what the rubric alone says", () => {
    const fail: ComplianceCheck = { id: "listing_policy", label: "Title policy and prohibited claims", status: "fail", detail: 'Uses "BPA free".' };
    const warn: ComplianceCheck = { id: "bullets", label: "Bullet points", status: "warn", detail: "4 of 5 bullets used." };

    const shut = complianceGate([warn, fail]);
    expect(shut).toEqual({ passed: false, detail: 'Title policy and prohibited claims: Uses "BPA free".', failing: [fail] });
    expect(rubricScore(perfect, shut)).toEqual({ overall: 0, weighted: 100 });
    // Warnings don't shut it.
    expect(rubricScore(perfect, complianceGate([warn]))).toEqual({ overall: 100, weighted: 100 });
  });

  it("explains each criterion's points", () => {
    expect(rubricLines({ ...perfect, keyword_coverage: 7 })[0]).toBe("Keyword coverage 7/10 · 17.5 of 25");
  });
});
