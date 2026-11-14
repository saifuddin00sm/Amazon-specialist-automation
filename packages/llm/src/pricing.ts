/** US dollars per million tokens. */
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * Anthropic's first-party list prices. Cache writes are the 5-minute kind, 1.25x input. Thinking
 * tokens are billed as output and arrive in the output count.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export class UnpricedModelError extends Error {
  constructor(readonly model: string) {
    super(`No price for ${model}; add it to MODEL_PRICES before routing calls to it.`);
    this.name = "UnpricedModelError";
  }
}

export function priceOf(model: string, prices: Record<string, ModelPrice> = MODEL_PRICES): ModelPrice {
  const price = prices[model];
  if (!price) throw new UnpricedModelError(model);
  return price;
}

/** What a call cost, rounded to a millionth of a dollar. */
export function callCost(usage: TokenUsage, price: ModelPrice): number {
  const dollars =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
