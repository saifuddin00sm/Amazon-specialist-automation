import type { ComplianceCheck, FactSheetEntry, FindingSeverity, ListingDraft, ListingRubricScores, LlmCall, ReviewReport } from "@app/core";
import { PROMPTS, type LlmGateway } from "@app/llm";
import { LISTING_REVIEW_TARGET, complianceGate, rubricLines, rubricScore, type ComplianceGate } from "./rubric";

export type Finding = ReviewReport["findings"][number];

export type ListingReviewerInput = {
  /** The Amazon product type, e.g. "BOTTLE". */
  productType: string;
  /** Everything the listing may claim, by ref. */
  facts: FactSheetEntry[];
  /** Most important first. */
  keywords: string[];
  /** The copy and the facts each claim cites. */
  draft: Pick<ListingDraft, "listing" | "claims">;
  /** Attribute values the listing will have besides its copy: a new listing's. */
  attributes?: { label: string; value: string | string[] }[];
  /** The rules and guardrail checks on the draft. Any that fails shuts the compliance gate. */
  checks: ComplianceCheck[];
  /** The agent run step the call works on. */
  stepId?: string;
};

export type ListingReview = {
  scores: ListingRubricScores;
  /** 0–100: the weighted rubric score, or 0 when the compliance gate is shut. */
  overall: number;
  /** What the rubric alone scores, gate or not. */
  weighted: number;
  gate: Omit<ComplianceGate, "failing">;
  target: number;
  /** The gate passed and the overall reached the target. */
  reachedTarget: boolean;
  /** The reviewer's one sentence. */
  summary: string;
  /** Everything found, most severe first: the gate's failing checks, then the reviewer's findings. */
  findings: Finding[];
  /** What the next draft must change: the findings that aren't polish. */
  fixes: Finding[];
  /** The review as the run viewer streams it: the gate, each criterion, the overall and the fix list. */
  report: string;
  /** The model calls the review took, as the gateway logged them. */
  calls: LlmCall[];
};

const SEVERITY_ORDER: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * The listing reviewer: scores a draft against the listing rubric. The compliance gate is decided in
 * code from the checks; one call through the gateway (routed to a different model from the writer,
 * at temperature 0) scores the six criteria and says what to fix; the weighting is done here.
 */
export async function reviewListing(gateway: LlmGateway, input: ListingReviewerInput): Promise<ListingReview> {
  const { output, calls } = await gateway.generate({
    prompt: PROMPTS.listingReview,
    input: {
      productType: input.productType,
      facts: input.facts,
      keywords: input.keywords,
      attributes: input.attributes ?? [],
      draft: { listing: input.draft.listing, claims: input.draft.claims },
      checks: input.checks,
    },
    stepId: input.stepId,
  });
  const gate = complianceGate(input.checks);
  const { overall, weighted } = rubricScore(output.scores, gate);
  const gateFindings: Finding[] = gate.failing.map((check) => ({
    criterion: "compliance",
    severity: "error",
    message: `${check.label}: ${check.detail ?? "fails."}`,
  }));
  const findings = [...gateFindings, ...[...output.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])];
  const fixes = findings.filter((finding) => finding.severity !== "info");
  const reachedTarget = gate.passed && overall >= LISTING_REVIEW_TARGET;
  return {
    scores: output.scores,
    overall,
    weighted,
    gate: { passed: gate.passed, ...(gate.detail ? { detail: gate.detail } : {}) },
    target: LISTING_REVIEW_TARGET,
    reachedTarget,
    summary: output.summary,
    findings,
    fixes,
    report: report({ scores: output.scores, overall, weighted, gate, reachedTarget, summary: output.summary, findings }),
    calls,
  };
}

function report({
  scores,
  overall,
  weighted,
  gate,
  reachedTarget,
  summary,
  findings,
}: Pick<ListingReview, "scores" | "overall" | "weighted" | "reachedTarget" | "summary" | "findings"> & { gate: ComplianceGate }): string {
  const verdict = !gate.passed
    ? `Overall 0/100: the compliance gate is shut, so the rubric's ${weighted} doesn't count until it passes.`
    : reachedTarget
      ? `Overall ${overall}/100, at or above the ${LISTING_REVIEW_TARGET} target.`
      : `Overall ${overall}/100, short of the ${LISTING_REVIEW_TARGET} target.`;
  const fixes = findings.filter((finding) => finding.severity !== "info");
  const notes = findings.filter((finding) => finding.severity === "info");
  return [
    gate.passed ? "Compliance gate: passed." : `Compliance gate: shut. ${gate.detail}`,
    ...rubricLines(scores),
    "",
    `${verdict} ${summary}`,
    ...(fixes.length > 0 ? ["", "Fix list", ...fixes.map((finding, i) => `${i + 1}. ${finding.message}`)] : []),
    ...notes.map((finding) => `Note: ${finding.message}`),
  ].join("\n");
}
