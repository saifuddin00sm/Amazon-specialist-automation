import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmProviderError } from "../provider";
import { createAnthropicProvider } from "./anthropic";

const output = z.object({ title: z.string() });
const request = { model: "claude-opus-5-5", system: "Write a title.", user: "Product: Bowl", maxTokens: 8_000, effort: "medium" as const, output };

/** A client whose messages.create answers with `answer`, keeping what it was sent. */
function stubClient(answer: () => Promise<unknown>) {
  const sent: unknown[] = [];
  const client = {
    messages: {
      create: async (params: unknown) => {
        sent.push(params);
        return answer();
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

const message = (overrides: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [
    { type: "thinking", thinking: "", signature: "x" },
    { type: "text", text: '{"title":"Teal Bowl"}' },
  ],
  usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: null },
  ...overrides,
});

describe("createAnthropicProvider", () => {
  it("doesn't train on what it's sent", () => {
    expect(createAnthropicProvider({ client: stubClient(async () => message()).client }).dataPolicy.trainsOnInputs).toBe(false);
  });

  it("sends the route's model, effort and token limit with the schema as structured output", async () => {
    const { client, sent } = stubClient(async () => message());
    const completion = await createAnthropicProvider({ client }).complete(request);

    expect(sent).toEqual([
      {
        model: "claude-opus-5-5",
        max_tokens: 8_000,
        system: [{ type: "text", text: "Write a title.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: "Product: Bowl" }],
        output_config: { effort: "medium", format: expect.objectContaining({ type: "json_schema", schema: expect.objectContaining({ type: "object" }) }) },
      },
    ]);
    expect(completion).toEqual({
      model: "claude-opus-5-5",
      text: '{"title":"Teal Bowl"}',
      stopReason: "end",
      usage: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 0 },
    });
  });

  it("reports refusals and truncated output", async () => {
    const refused = stubClient(async () => message({ stop_reason: "refusal", content: [] }));
    expect(await createAnthropicProvider({ client: refused.client }).complete(request)).toMatchObject({ stopReason: "refusal", text: "" });
    const cut = stubClient(async () => message({ stop_reason: "max_tokens" }));
    expect(await createAnthropicProvider({ client: cut.client }).complete(request)).toMatchObject({ stopReason: "max_tokens" });
  });

  it("turns SDK errors into provider errors that don't repeat the API's message", async () => {
    const { client } = stubClient(async () => {
      throw new Anthropic.APIConnectionError({ message: "socket hang up while sending Product: Bowl" });
    });
    const error = await createAnthropicProvider({ client })
      .complete(request)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error).toMatchObject({ message: "Couldn't reach the Anthropic API.", retryable: true });
  });
});
