import { AgentRunSchema, LlmCallSchema, type AgentRun, type AgentRunStep, type LlmCall } from "@app/core";
import { scriptedCall, type Prompt, type PromptInput, type PromptOutput } from "@app/llm";
import { AgentRunError } from "../data-source";

export const LLM_CALLS_BACKEND_ONLY = "Only the backend logs model calls.";

/**
 * A running run with `calls` logged after the ones it has. Throws AgentRunError for a run that
 * doesn't exist or has finished, and for calls naming a step the run doesn't have.
 */
export function withLlmCalls(run: AgentRun | undefined, calls: readonly LlmCall[]): AgentRun {
  if (!run) throw new AgentRunError("not_found", "That agent run doesn't exist.");
  if (run.status !== "running") throw new AgentRunError("conflict", "That agent run has finished; its model calls are final.");
  const parsed = LlmCallSchema.array().safeParse(calls);
  if (!parsed.success) throw new AgentRunError("invalid_input", "Those model calls aren't valid.");
  const next = AgentRunSchema.safeParse({ ...run, llmCalls: [...(run.llmCalls ?? []), ...parsed.data] });
  if (!next.success) throw new AgentRunError("invalid_input", "A model call names a step the run doesn't have.");
  return next.data;
}

/** One stand-in step's model call: the prompt version it stands for, what it would be sent, and the answer written in code. */
export type ScriptedStep = { prompt: Prompt; input: unknown; output: unknown };

/** Pairs a prompt with its input and output, typed by the prompt. */
export function scripted<P extends Prompt>(prompt: P, input: PromptInput<P>, output: PromptOutput<P>): ScriptedStep {
  return { prompt, input, output };
}

/**
 * Logs each model step of a Phase 1 stand-in run as the LLM gateway call it stands for, in step
 * order, timed like the step. `script` returns undefined for steps that aren't model work: reading
 * the inputs, guardrail checks, filing. Throws when a step's answer doesn't match its prompt's
 * output schema, as a model's wouldn't get through the gateway either.
 */
export function scriptedLlmCalls(steps: readonly AgentRunStep[], script: (step: AgentRunStep) => ScriptedStep | undefined): LlmCall[] {
  return steps.flatMap((step) => {
    const call = script(step);
    if (!call) return [];
    return [
      scriptedCall({
        id: `${step.id}_llm`,
        prompt: call.prompt,
        input: call.input as never,
        output: call.output as never,
        stepId: step.id,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
      }),
    ];
  });
}
