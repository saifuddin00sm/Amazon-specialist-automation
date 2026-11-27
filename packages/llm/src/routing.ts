import type { LlmTask } from "@app/core";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Where a task's calls go and how hard the model works on them. `temperature` pins sampling, for
 * models that take it (the current Opus, Sonnet and Haiku refuse any but their default).
 */
export type Route = { model: string; effort: Effort; maxTokens: number; temperature?: number };

/**
 * Model routing by task. Writing and planning get more effort than scoring a draft against a
 * rubric. The reviewer is a different model from the writer, so a draft isn't judged by the model
 * that wrote it, at temperature 0 so the same draft gets the same scores; that takes a model that
 * still accepts a temperature. Every model named here needs a price in MODEL_PRICES; a test holds that.
 */
export const ROUTES: Record<LlmTask, Route> = {
  listing_rewrite: { model: "claude-opus-5-5", effort: "high", maxTokens: 16_000 },
  listing_create: { model: "claude-opus-5-5", effort: "high", maxTokens: 16_000 },
  listing_review: { model: "claude-sonnet-4-6", effort: "medium", maxTokens: 8_000, temperature: 0 },
  listing_attributes: { model: "claude-opus-5-5", effort: "medium", maxTokens: 8_000 },
  campaign_optimize: { model: "claude-opus-5-5", effort: "high", maxTokens: 16_000 },
  campaign_strategy: { model: "claude-opus-5-5", effort: "high", maxTokens: 16_000 },
};
