import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LlmProviderError, type Completion, type LlmProvider } from "../provider";

/**
 * Claude through the Anthropic API. Under Anthropic's commercial terms, API inputs and outputs
 * aren't used to train models; that is the provider's default, with no request setting to turn on.
 * Output is constrained to the prompt's schema with structured outputs, and the gateway still
 * validates it. The SDK retries rate limits and server errors itself.
 */
export function createAnthropicProvider({ client = new Anthropic() }: { client?: Anthropic } = {}): LlmProvider {
  return {
    name: "anthropic",
    dataPolicy: {
      trainsOnInputs: false,
      basis: "Anthropic's commercial terms: API inputs and outputs aren't used to train models.",
    },
    async complete({ model, system, user, maxTokens, effort, temperature, output }): Promise<Completion> {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          // A prompt version's system text never changes, so it caches across calls once it is long enough to.
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: user }],
          // Only on routes that pin it: the current models refuse any temperature but their default.
          ...(temperature !== undefined ? { temperature } : {}),
          output_config: { effort, format: zodOutputFormat(output) },
        });
      } catch (error) {
        throw providerError(error);
      }
      return {
        model: response.model,
        text: response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
        stopReason: response.stop_reason === "refusal" ? "refusal" : response.stop_reason === "max_tokens" ? "max_tokens" : "end",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

/** Names the failure by status; the API's own message can echo the request. */
function providerError(error: unknown): LlmProviderError {
  if (error instanceof Anthropic.RateLimitError) return new LlmProviderError("Anthropic rate limit (429) after retries.", true, { cause: error });
  if (error instanceof Anthropic.AuthenticationError) return new LlmProviderError("Anthropic rejected the API key (401).", false, { cause: error });
  if (error instanceof Anthropic.BadRequestError) return new LlmProviderError("Anthropic rejected the request (400).", false, { cause: error });
  if (error instanceof Anthropic.APIConnectionError) return new LlmProviderError("Couldn't reach the Anthropic API.", true, { cause: error });
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? "no status";
    return new LlmProviderError(`Anthropic API error (${status}).`, typeof error.status === "number" && error.status >= 500, { cause: error });
  }
  return new LlmProviderError("The Anthropic call failed.", false, { cause: error });
}
