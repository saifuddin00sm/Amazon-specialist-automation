import { LlmCallSchema, type LlmCall } from "@app/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmCallError, TrainingProviderError, createLlmGateway } from "./gateway";
import { UnpricedModelError } from "./pricing";
import { definePrompt } from "./prompt";
import { LlmProviderError, type Completion, type CompletionRequest, type LlmProvider } from "./provider";
import { ROUTES } from "./routing";

const prompt = definePrompt({
  id: "test_writer.title",
  version: 3,
  task: "listing_rewrite",
  system: "Write a title.",
  template: "Product: {{name}}\nFacts: {{facts}}",
  input: z.object({ name: z.string(), facts: z.object({ color: z.string() }) }),
  output: z.object({ title: z.string().min(1).max(20) }),
});

const usage = { inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 2_000, cacheWriteTokens: 0 };

/** Answers each call with the next completion, keeping the requests it was sent. */
function fakeProvider(answers: (Partial<Completion> | Error)[], policy = { trainsOnInputs: false, basis: "test" }) {
  const requests: CompletionRequest[] = [];
  const provider: LlmProvider = {
    name: "anthropic",
    dataPolicy: policy,
    async complete(request) {
      requests.push(request);
      const answer = answers.shift();
      if (!answer) throw new Error("No more answers.");
      if (answer instanceof Error) throw answer;
      return { model: request.model, text: "{}", stopReason: "end", usage, ...answer };
    },
  };
  return { provider, requests };
}

function gatewayWith(provider: LlmProvider, repairs?: number) {
  const recorded: LlmCall[] = [];
  let id = 0;
  let clock = Date.parse("2026-11-14T10:00:00.000Z");
  const gateway = createLlmGateway({
    provider,
    record: (call) => {
      recorded.push(call);
    },
    repairs,
    newId: () => `llm_${++id}`,
    now: () => new Date((clock += 1_000)),
  });
  return { gateway, recorded };
}

const request = { prompt, input: { name: "Bowl", facts: { color: "Teal" } }, stepId: "run_1_s1" };

describe("createLlmGateway", () => {
  it("routes by task, renders the prompt, validates output and logs the call with its cost", async () => {
    const { provider, requests } = fakeProvider([{ text: '{"title":"Teal Bowl"}' }]);
    const { gateway, recorded } = gatewayWith(provider);

    const { output, calls } = await gateway.generate(request);

    expect(output).toEqual({ title: "Teal Bowl" });
    expect(requests).toEqual([
      {
        model: ROUTES.listing_rewrite.model,
        effort: ROUTES.listing_rewrite.effort,
        maxTokens: ROUTES.listing_rewrite.maxTokens,
        system: "Write a title.",
        user: 'Product: Bowl\nFacts: {\n  "color": "Teal"\n}',
        output: prompt.output,
      },
    ]);
    expect(calls).toEqual(recorded);
    expect(recorded).toEqual([
      {
        id: "llm_1",
        stepId: "run_1_s1",
        task: "listing_rewrite",
        promptId: "test_writer.title",
        promptVersion: 3,
        provider: "anthropic",
        model: "claude-opus-5-5",
        attempt: 1,
        outcome: "ok",
        ...usage,
        // 1,000 × $4 + 500 × $20 + 2,000 × $0.20 per million.
        costUsd: 0.0144,
        startedAt: "2026-11-14T10:00:01.000Z",
        finishedAt: "2026-11-14T10:00:02.000Z",
      },
    ]);
    expect(LlmCallSchema.safeParse(recorded[0]).success).toBe(true);
  });

  it("asks again once on output that doesn't match the schema, logging both attempts", async () => {
    const { provider, requests } = fakeProvider([{ text: '{"title":""}' }, { text: '{"title":"Teal Bowl"}' }]);
    const { gateway, recorded } = gatewayWith(provider);

    const { output } = await gateway.generate(request);

    expect(output).toEqual({ title: "Teal Bowl" });
    expect(recorded.map((call) => [call.attempt, call.outcome])).toEqual([
      [1, "invalid_output"],
      [2, "ok"],
    ]);
    expect(recorded[0]!.error).toMatch(/^title: /);
    expect(requests[1]!.user).toContain("didn't match the required output schema (title: ");
  });

  it("gives up after the repairs run out, and never logs the text it got", async () => {
    const { provider } = fakeProvider([{ text: "Sure! Here's a title: Teal Bowl" }, { text: '{"title":"A title far too long for this"}' }]);
    const { gateway, recorded } = gatewayWith(provider);

    const error = await gateway.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmCallError);
    expect(error).toMatchObject({ outcome: "invalid_output", calls: recorded });
    expect(recorded.map((call) => call.error)).toEqual(["The output isn't valid JSON.", expect.stringMatching(/^title: /)]);
    expect(JSON.stringify(recorded)).not.toContain("Teal Bowl");
  });

  it("doesn't ask again when the output was cut off at the token limit", async () => {
    const { provider } = fakeProvider([{ text: '{"title":"Te', stopReason: "max_tokens" }]);
    const { gateway, recorded } = gatewayWith(provider);

    await expect(gateway.generate(request)).rejects.toMatchObject({ outcome: "invalid_output" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ outcome: "invalid_output", costUsd: 0.0144 });
  });

  it("logs refusals with what they cost", async () => {
    const { provider } = fakeProvider([{ text: "", stopReason: "refusal" }]);
    const { gateway, recorded } = gatewayWith(provider);

    await expect(gateway.generate(request)).rejects.toMatchObject({ outcome: "refused" });
    expect(recorded).toEqual([expect.objectContaining({ outcome: "refused", outputTokens: 500, costUsd: 0.0144 })]);
  });

  it("logs a failed provider call at no cost, with only the provider's safe message", async () => {
    const { provider } = fakeProvider([new LlmProviderError("Anthropic rate limit (429) after retries.", true), new Error("secret listing text")]);
    const { gateway, recorded } = gatewayWith(provider);

    await expect(gateway.generate(request)).rejects.toMatchObject({ outcome: "error", message: "Anthropic rate limit (429) after retries." });
    await expect(gateway.generate(request)).rejects.toMatchObject({ outcome: "error", message: "The anthropic provider failed." });
    expect(recorded.map((call) => [call.outcome, call.inputTokens, call.costUsd, call.error])).toEqual([
      ["error", 0, 0, "Anthropic rate limit (429) after retries."],
      ["error", 0, 0, "The anthropic provider failed."],
    ]);
  });

  it("prices the call on the model that answered", async () => {
    const { provider } = fakeProvider([{ text: '{"title":"Teal Bowl"}', model: "claude-sonnet-5-5" }]);
    const { gateway, recorded } = gatewayWith(provider);

    await gateway.generate(request);
    // 1,000 × $2 + 500 × $10 + 2,000 × $0.20 per million.
    expect(recorded[0]).toMatchObject({ model: "claude-sonnet-5-5", costUsd: 0.0074 });
  });

  it("waits for each call to be logged before going on", async () => {
    const { provider } = fakeProvider([{ text: '{"title":"Teal Bowl"}' }]);
    const order: string[] = [];
    const gateway = createLlmGateway({
      provider,
      record: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("logged");
      },
    });
    await gateway.generate(request);
    order.push("returned");
    expect(order).toEqual(["logged", "returned"]);
  });

  it("refuses a provider that may train on what it's sent", () => {
    const { provider } = fakeProvider([], { trainsOnInputs: true, basis: "consumer terms" });
    expect(() => createLlmGateway({ provider, record: () => {} })).toThrow(TrainingProviderError);
  });

  it("refuses routes to a model it has no price for", () => {
    const { provider } = fakeProvider([]);
    const routes = { ...ROUTES, listing_review: { model: "claude-unknown", effort: "low" as const, maxTokens: 1_000 } };
    expect(() => createLlmGateway({ provider, record: () => {}, routes })).toThrow(UnpricedModelError);
  });

  it("rejects input that doesn't match the prompt before calling anyone", async () => {
    const { provider, requests } = fakeProvider([]);
    const { gateway, recorded } = gatewayWith(provider);
    await expect(gateway.generate({ prompt, input: { name: "Bowl" } as never })).rejects.toThrow();
    expect(requests).toEqual([]);
    expect(recorded).toEqual([]);
  });
});

describe("definePrompt", () => {
  const base = { id: "x.y", version: 1, task: "listing_review" as const, system: "s", output: z.object({}) };

  it("refuses a template slot with no input field, and an input field the template never uses", () => {
    expect(() => definePrompt({ ...base, template: "{{a}} {{b}}", input: z.object({ a: z.string() }) })).toThrow("no input field for {{b}}");
    expect(() => definePrompt({ ...base, template: "{{a}}", input: z.object({ a: z.string(), c: z.string() }) })).toThrow("never uses c");
  });

  it("refuses a version that isn't a positive integer", () => {
    expect(() => definePrompt({ ...base, version: 0, template: "", input: z.object({}) })).toThrow("positive integer");
  });
});
