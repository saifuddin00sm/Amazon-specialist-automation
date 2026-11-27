import { createStandInProvider } from "@app/agents";
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
let standIn: LlmProvider | undefined;

/** Long enough that the run viewer shows each step arrive. */
const STAND_IN_LATENCY_MS = 700;

/**
 * One provider per process: Anthropic, whose SDK reads ANTHROPIC_API_KEY on first use, or with
 * LLM_PROVIDER=stand-in the stand-in that answers in code and calls no model (the e2e, local
 * development without a key). Its calls are logged as scripted, and the run viewer says so.
 */
export function llmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  if (env.LLM_PROVIDER === "stand-in") {
    standIn ??= createStandInProvider({ latencyMs: STAND_IN_LATENCY_MS });
    return standIn;
  }
  anthropic ??= createAnthropicProvider();
  return anthropic;
}
