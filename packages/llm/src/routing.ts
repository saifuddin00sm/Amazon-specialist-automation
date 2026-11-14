import type { LlmTask } from "@app/core";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Where a task's calls go and how hard the model works on them. */
export type Route = { model: string; effort: Effort; maxTokens: number };

/**
 * Model routing by task. Writing and planning get more effort than scoring a draft against a
 * rubric. Every model named here needs a price in MODEL_PRICES; a test holds that.
 */
export const ROUTES: Record<LlmTask, Route> = {
  listing_rewrite: { model: "claude-opus-5-5", effort: "high", maxTokens: 16_000 },
  listing_create: { model: "claude-opus-5-5", effort: "high", maxTokens: 16_000 },
  listing_review: { model: "claude-opus-5-5", effort: "medium", maxTokens: 8_000 },
  listing_attributes: { model: "claude-opus-5-5", effort: "medium", maxTokens: 8_000 },
  campaign_optimize: { model: "claude-opus-5-5", effort: "high", maxTokens: 16_000 },
  campaign_strategy: { model: "claude-opus-5-5", effort: "high", maxTokens: 16_000 },
};
