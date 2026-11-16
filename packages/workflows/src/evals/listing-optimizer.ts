import type { GroundingProblem, LlmCall, Violation } from "@app/core";
import { LlmCallError, type LlmGateway } from "@app/llm";
import { optimizeListing, passesGuard } from "../listing-optimizer";
import { EVAL_LANGUAGE_TAG, EVAL_MARKETPLACE_ID, LISTING_OPTIMIZER_CASES, type ListingOptimizerCase } from "./listing-optimizer.cases";

/** Done when the first draft passes the compliance guard, with no fixes, on this many of the ten test products. */
export const LISTING_OPTIMIZER_PASS_BAR = 8;

export type ListingOptimizerCaseResult = {
  name: string;
  /** The draft passed the guard as the model returned it. */
  passed: boolean;
  violations: Violation[];
  grounding: GroundingProblem[];
  /** Why no draft came back, when none did. */
  error?: string;
};

export type ListingOptimizerEval = {
  results: ListingOptimizerCaseResult[];
  passed: number;
  total: number;
  /** At or over the bar. */
  ok: boolean;
};

/**
 * Runs the optimizer once on each test product and counts the drafts the guard passes. A call that
 * returns no draft counts as a failure. Nothing is revised: the bar is for first drafts.
 */
export async function evaluateListingOptimizer(
  gateway: LlmGateway,
  cases: readonly ListingOptimizerCase[] = LISTING_OPTIMIZER_CASES,
): Promise<ListingOptimizerEval> {
  const results = await Promise.all(
    cases.map(async (testCase): Promise<ListingOptimizerCaseResult> => {
      try {
        const { violations, grounding } = await optimizeListing(gateway, {
          ...testCase,
          marketplaceId: EVAL_MARKETPLACE_ID,
          languageTag: EVAL_LANGUAGE_TAG,
        });
        return { name: testCase.name, passed: passesGuard(violations), violations, grounding };
      } catch (error) {
        if (!(error instanceof LlmCallError)) throw error;
        return { name: testCase.name, passed: false, violations: [], grounding: [], error: error.message };
      }
    }),
  );
  const passed = results.filter((result) => result.passed).length;
  return { results, passed, total: results.length, ok: passed >= LISTING_OPTIMIZER_PASS_BAR };
}

/** Calls and dollars an eval run spent, from the gateway's log. */
export function evalSpend(calls: readonly LlmCall[]): { calls: number; costUsd: number } {
  return { calls: calls.length, costUsd: Math.round(calls.reduce((sum, call) => sum + call.costUsd, 0) * 10_000) / 10_000 };
}
