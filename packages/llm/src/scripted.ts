import { LlmCallSchema, type LlmCall } from "@app/core";
import { MODEL_PRICES, callCost, priceOf, type TokenUsage } from "./pricing";
import { renderPrompt, type Prompt, type PromptInput, type PromptOutput } from "./prompt";
import { ROUTES } from "./routing";

export type ScriptedCallInput<P extends Prompt> = {
  id: string;
  prompt: P;
  input: PromptInput<P>;
  /** The answer, written in code. It must match the prompt's output schema like a model's would. */
  output: PromptOutput<P>;
  stepId?: string;
  startedAt: string;
  finishedAt: string;
};

/** Characters per token, roughly, for English text and JSON. */
const CHARS_PER_TOKEN = 4;

/**
 * Logs a Phase 1 stand-in's step as the gateway call a model would have made: the same prompt
 * version and route, the answer checked against the same schema, and tokens estimated from the
 * rendered prompt and the answer, priced on the routed model. Nothing is sent anywhere.
 */
export function scriptedCall<P extends Prompt>({ id, prompt, input, output, stepId, startedAt, finishedAt }: ScriptedCallInput<P>): LlmCall {
  const { system, user } = renderPrompt(prompt, input);
  const answer = JSON.stringify(prompt.output.parse(output));
  const model = ROUTES[prompt.task].model;
  const usage: TokenUsage = {
    inputTokens: estimateTokens(system) + estimateTokens(user),
    outputTokens: estimateTokens(answer),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  return LlmCallSchema.parse({
    id,
    stepId,
    task: prompt.task,
    promptId: prompt.id,
    promptVersion: prompt.version,
    provider: "scripted",
    model,
    attempt: 1,
    outcome: "ok",
    ...usage,
    costUsd: callCost(usage, priceOf(model, MODEL_PRICES)),
    startedAt,
    finishedAt,
  });
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
