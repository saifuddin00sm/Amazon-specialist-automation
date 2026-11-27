import type { ComplianceCheck, LlmCall, Violation } from "@app/core";
import type { DataSource } from "@app/data";
import { createLlmGateway, type LlmGateway, type LlmProvider } from "@app/llm";

// How a workflow runs model work as Inngest steps: each call is its own step, and what came of it is
// recorded in the next one, so a retry records the answer it already has rather than asking again.

/** A model call's answer, with the calls it took, kept as a step's result until it is recorded. */
export type Generated<O> = { output: O; calls: LlmCall[]; startedAt: string; finishedAt: string };

/**
 * A gateway whose calls are kept until their step is on the run: the run only takes calls that name
 * one of its steps, and a step is recorded once its work is done.
 */
export function bufferedGateway(deps: { llm(): LlmProvider }): { gateway: LlmGateway; calls: LlmCall[] } {
  const calls: LlmCall[] = [];
  return { gateway: createLlmGateway({ provider: deps.llm(), record: (call) => void calls.push(call) }), calls };
}

/** Logs calls whose step never came to be: they happened, and were paid for, all the same. */
export async function recordStepless(deps: { dataSource: Pick<DataSource, "recordLlmCalls"> }, runId: string, calls: readonly LlmCall[]): Promise<void> {
  if (calls.length === 0) return;
  const stepless = calls.map((call) => {
    const copy = { ...call };
    delete copy.stepId;
    return copy;
  });
  await deps.dataSource.recordLlmCalls({ runId, calls: stepless });
}

/** The guard's violations as one check: failing on any error, warning on any warning. */
export function violationCheck(id: string, label: string, violations: readonly Violation[]): ComplianceCheck {
  const errors = violations.filter((violation) => violation.severity === "error");
  const warnings = violations.filter((violation) => violation.severity === "warning");
  if (errors.length > 0) return { id, label, status: "fail", detail: errors.map((violation) => violation.message).join(" ") };
  if (warnings.length > 0) return { id, label, status: "warn", detail: warnings.map((violation) => violation.message).join(" ") };
  return { id, label, status: "pass" };
}
