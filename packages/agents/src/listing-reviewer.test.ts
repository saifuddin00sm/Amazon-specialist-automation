import type { ComplianceCheck, ListingDraft, LlmCall } from "@app/core";
import { ROUTES, createLlmGateway, type CompletionRequest, type LlmProvider, type PromptOutput, type PROMPTS } from "@app/llm";
import { describe, expect, it } from "vitest";
import { reviewListing, type ListingReviewerInput } from "./listing-reviewer";

type ReviewOutput = PromptOutput<typeof PROMPTS.listingReview>;

/** Answers every call with `answer`, keeping the requests. */
function fakeModel(answer: ReviewOutput) {
  const requests: CompletionRequest[] = [];
  const provider: LlmProvider = {
    name: "anthropic",
    dataPolicy: { trainsOnInputs: false, basis: "test" },
    complete: async (request) => {
      requests.push(request);
      return { model: request.model, text: JSON.stringify(answer), stopReason: "end", usage: { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    },
  };
  const calls: LlmCall[] = [];
  return { gateway: createLlmGateway({ provider, record: (call) => void calls.push(call) }), requests, calls };
}

const draft: ListingDraft = {
  listing: {
    title: "Hydra Bottle 750 ml Water Bottle – Stainless steel, Teal",
    bullets: ["KEEPS COLD – Keeps drinks cold for 24 hours."],
    description: "Double-walled stainless steel.",
    backendKeywords: "insulated flask",
  },
  changes: [{ path: "title", reason: "Leads with the keyword." }],
  claims: [{ path: "bullets.0", text: "Keeps drinks cold for 24 hours", facts: ["features.0"] }],
};

const input: ListingReviewerInput = {
  productType: "BOTTLE",
  facts: [
    { ref: "brand", fact: "Hydra" },
    { ref: "material", fact: "Stainless steel" },
    { ref: "features.0", fact: "Keeps drinks cold for 24 hours." },
  ],
  keywords: ["water bottle", "insulated flask"],
  draft,
  checks: [{ id: "title_length", label: "Title length", status: "pass", detail: "55 of 200 characters." }],
  stepId: "run_1_review1",
};

const strong: ReviewOutput = {
  scores: { keyword_coverage: 9, grounding: 10, conversion_copy: 8, title_structure: 9, attributes: 8, voice: 9 },
  summary: "Grounded and keyword-rich.",
  findings: [
    { criterion: "voice", severity: "info", message: "Could say what the lid is made of." },
    { criterion: "conversion_copy", severity: "warning", message: "Use all five bullets." },
  ],
};

describe("reviewListing", () => {
  it("asks a different model from the writer, at temperature 0, with the draft's citations and the keywords", async () => {
    const { gateway, requests, calls } = fakeModel(strong);
    await reviewListing(gateway, input);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: "claude-sonnet-4-6", temperature: 0, prompt: { id: "listing_reviewer.review", version: 2 } });
    expect(requests[0]!.model).not.toBe(ROUTES.listing_rewrite.model);
    expect(requests[0]!.user).toContain('"Keeps drinks cold for 24 hours"');
    expect(requests[0]!.user).toContain('"insulated flask"');
    expect(calls).toEqual([expect.objectContaining({ stepId: "run_1_review1", promptId: "listing_reviewer.review", promptVersion: 2, outcome: "ok" })]);
  });

  it("weighs the scores, puts errors and warnings in the fix list, and says when the target is reached", async () => {
    const { gateway } = fakeModel(strong);
    const review = await reviewListing(gateway, input);

    // 25×0.9 + 20×1 + 20×0.8 + 15×0.9 + 10×0.8 + 10×0.9 = 22.5 + 20 + 16 + 13.5 + 8 + 9
    expect(review).toMatchObject({ overall: 89, weighted: 89, target: 85, reachedTarget: true, gate: { passed: true }, summary: "Grounded and keyword-rich." });
    expect(review.findings.map((finding) => finding.severity)).toEqual(["warning", "info"]);
    expect(review.fixes).toEqual([{ criterion: "conversion_copy", severity: "warning", message: "Use all five bullets." }]);
    expect(review.report).toContain("Compliance gate: passed.");
    expect(review.report).toContain("Keyword coverage 9/10 · 22.5 of 25");
    expect(review.report).toContain("Overall 89/100, at or above the 85 target. Grounded and keyword-rich.");
    expect(review.report).toContain("Fix list\n1. Use all five bullets.");
  });

  it("scores 0 when a check fails, and fixes the gate first", async () => {
    const failing: ComplianceCheck = { id: "listing_policy", label: "Title policy and prohibited claims", status: "fail", detail: 'bullets.0 says "BPA free".' };
    const { gateway } = fakeModel(strong);
    const review = await reviewListing(gateway, { ...input, checks: [...input.checks, failing] });

    expect(review).toMatchObject({ overall: 0, weighted: 89, reachedTarget: false, gate: { passed: false, detail: 'Title policy and prohibited claims: bullets.0 says "BPA free".' } });
    expect(review.fixes[0]).toEqual({ criterion: "compliance", severity: "error", message: 'Title policy and prohibited claims: bullets.0 says "BPA free".' });
    expect(review.report.split("\n")[0]).toBe('Compliance gate: shut. Title policy and prohibited claims: bullets.0 says "BPA free".');
    expect(review.report).toContain("the rubric's 89 doesn't count until it passes");
  });

  it("falls short of the target below 85", async () => {
    const { gateway } = fakeModel({ ...strong, scores: { ...strong.scores, keyword_coverage: 5 } });
    expect(await reviewListing(gateway, input)).toMatchObject({ overall: 79, reachedTarget: false });
  });
});
