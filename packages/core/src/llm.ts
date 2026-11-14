import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/** What a model call is for. The LLM gateway (packages/llm) routes each task to a model. */
export const LlmTaskSchema = z.enum(["listing_rewrite", "listing_create", "listing_review", "listing_attributes", "campaign_optimize", "campaign_strategy"]);
export type LlmTask = z.infer<typeof LlmTaskSchema>;

/** Who answered: a model provider, or `scripted`, the Phase 1 stand-ins whose answers are written in code. */
export const LlmProviderNameSchema = z.enum(["anthropic", "scripted"]);
export type LlmProviderName = z.infer<typeof LlmProviderNameSchema>;

/**
 * ok: the output matched the prompt's schema. invalid_output: it didn't (the gateway may ask again).
 * refused: the model declined. error: the provider failed before answering.
 */
export const LlmCallOutcomeSchema = z.enum(["ok", "invalid_output", "refused", "error"]);
export type LlmCallOutcome = z.infer<typeof LlmCallOutcomeSchema>;

const TokenCountSchema = z.number().int().nonnegative();

/**
 * One model call an agent run made, as the LLM gateway logged it. Holds no prompt or output text:
 * those carry seller data, and the agent run's steps already show what came of the call.
 */
export const LlmCallSchema = z.object({
  id: IdSchema,
  /** The run step the call worked on, when it worked on one. */
  stepId: IdSchema.optional(),
  task: LlmTaskSchema,
  promptId: z.string().min(1),
  promptVersion: z.number().int().positive(),
  provider: LlmProviderNameSchema,
  /** The model that answered. */
  model: z.string().min(1),
  /** 1 for the first try; higher when the gateway asked again after invalid output. */
  attempt: z.number().int().positive(),
  outcome: LlmCallOutcomeSchema,
  /** Uncached input tokens. */
  inputTokens: TokenCountSchema,
  outputTokens: TokenCountSchema,
  cacheReadTokens: TokenCountSchema,
  cacheWriteTokens: TokenCountSchema,
  /** What the call cost in US dollars, from the model's list prices. Estimated for scripted calls. */
  costUsd: z.number().nonnegative(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  /** Why the call didn't come back ok. Never holds prompt or output text. */
  error: z.string().optional(),
});
export type LlmCall = z.infer<typeof LlmCallSchema>;

/** A run's model usage, summed over its calls. */
export function llmUsage(calls: readonly LlmCall[]): { calls: number; inputTokens: number; outputTokens: number; costUsd: number } {
  return calls.reduce(
    (total, call) => ({
      calls: total.calls + 1,
      inputTokens: total.inputTokens + call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens,
      outputTokens: total.outputTokens + call.outputTokens,
      costUsd: total.costUsd + call.costUsd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
}
