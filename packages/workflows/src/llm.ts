import type { DataSource } from "@app/data";
import { createLlmGateway, type LlmGateway, type LlmProvider } from "@app/llm";
import { createAnthropicProvider } from "@app/llm/anthropic";

/**
 * The LLM gateway for one agent run: every call, ok or not, is logged to the run as it is made, so
 * the run viewer shows its prompt version, model, tokens and cost. A retried Inngest step logs its
 * calls again: they happened, and were paid for, again.
 */
export function agentRunGateway({ dataSource, provider, runId }: { dataSource: DataSource; provider: LlmProvider; runId: string }): LlmGateway {
  return createLlmGateway({
    provider,
    record: async (call) => {
      await dataSource.recordLlmCalls({ runId, calls: [call] });
    },
  });
}

let anthropic: LlmProvider | undefined;

/** One Anthropic provider per process. The SDK reads ANTHROPIC_API_KEY on first use. */
export function llmProvider(): LlmProvider {
  anthropic ??= createAnthropicProvider();
  return anthropic;
}
