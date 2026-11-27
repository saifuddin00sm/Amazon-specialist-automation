import { LlmCallSchema, type LlmCall, type LlmCallOutcome, type LlmTask } from "@app/core";
import type { z } from "zod";
import { MODEL_PRICES, NO_USAGE, callCost, priceOf, type ModelPrice, type TokenUsage } from "./pricing";
import { renderPrompt, type Prompt, type PromptInput, type PromptOutput } from "./prompt";
import { LlmProviderError, type Completion, type LlmProvider } from "./provider";
import { ROUTES, type Route } from "./routing";

export type LlmGatewayOptions = {
  provider: LlmProvider;
  /**
   * Where every call is logged, ok or not: the agent run's llmCalls. Awaited before the call's
   * result is used, so a run never acts on a call it didn't log.
   */
  record: (call: LlmCall) => Promise<void> | void;
  routes?: Record<LlmTask, Route>;
  prices?: Record<string, ModelPrice>;
  /** How many times to ask again after output that doesn't match the prompt's schema. */
  repairs?: number;
  newId?: () => string;
  now?: () => Date;
};

export type GenerateRequest<P extends Prompt> = {
  prompt: P;
  input: PromptInput<P>;
  /** The agent run step the call works on. */
  stepId?: string;
};

export type Generation<P extends Prompt> = {
  /** Parsed by the prompt's output schema. */
  output: PromptOutput<P>;
  /** Every attempt it took, as logged. */
  calls: LlmCall[];
};

export type LlmGateway = {
  generate<P extends Prompt>(request: GenerateRequest<P>): Promise<Generation<P>>;
};

/** A call that didn't produce valid output. `calls` were logged; `message` holds no prompt or output text. */
export class LlmCallError extends Error {
  constructor(
    readonly outcome: Exclude<LlmCallOutcome, "ok">,
    message: string,
    readonly calls: LlmCall[],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LlmCallError";
  }
}

export class TrainingProviderError extends Error {
  constructor(provider: string) {
    super(`The ${provider} provider may train on what it's sent. Prompts carry seller data; use a provider that doesn't.`);
    this.name = "TrainingProviderError";
  }
}

/**
 * The one way to call a model. Renders the prompt version, routes it by task, validates the output
 * with the prompt's Zod schema (asking again on a mismatch), and logs every attempt with its
 * tokens and cost through `record`.
 */
export function createLlmGateway({
  provider,
  record,
  routes = ROUTES,
  prices = MODEL_PRICES,
  repairs = 1,
  newId = () => `llm_${crypto.randomUUID()}`,
  now = () => new Date(),
}: LlmGatewayOptions): LlmGateway {
  if (provider.dataPolicy.trainsOnInputs) throw new TrainingProviderError(provider.name);
  // Fail on setup, not on a run's first call.
  for (const route of Object.values(routes)) priceOf(route.model, prices);

  return {
    async generate({ prompt, input, stepId }) {
      const route = routes[prompt.task];
      const { system, user } = renderPrompt(prompt, input);
      const parsed: unknown = prompt.input.parse(input);
      const calls: LlmCall[] = [];
      let problem: string | undefined;

      for (let attempt = 1; ; attempt += 1) {
        const startedAt = now();
        const log = async (outcome: LlmCallOutcome, model: string, usage: TokenUsage, error?: string) => {
          const call = LlmCallSchema.parse({
            id: newId(),
            stepId,
            task: prompt.task,
            promptId: prompt.id,
            promptVersion: prompt.version,
            provider: provider.name,
            model,
            attempt,
            outcome,
            ...usage,
            costUsd: callCost(usage, priceOf(model, prices)),
            startedAt: startedAt.toISOString(),
            finishedAt: now().toISOString(),
            error,
          });
          calls.push(call);
          await record(call);
        };

        let completion: Completion;
        try {
          completion = await provider.complete({
            model: route.model,
            system,
            user: problem ? `${user}\n\n${repairNote(problem)}` : user,
            maxTokens: route.maxTokens,
            effort: route.effort,
            ...(route.temperature !== undefined ? { temperature: route.temperature } : {}),
            output: prompt.output,
            prompt: { id: prompt.id, version: prompt.version, task: prompt.task, input: parsed },
          });
        } catch (error) {
          const message = error instanceof LlmProviderError ? error.message : `The ${provider.name} provider failed.`;
          await log("error", route.model, NO_USAGE, message);
          throw new LlmCallError("error", message, calls, { cause: error });
        }

        if (completion.stopReason === "refusal") {
          await log("refused", completion.model, completion.usage, "The model declined to answer.");
          throw new LlmCallError("refused", `${completion.model} declined to answer ${prompt.id}.`, calls);
        }
        const checked = completion.stopReason === "max_tokens" ? truncated(route) : parseOutput(prompt.output, completion.text);
        if (checked.ok) {
          await log("ok", completion.model, completion.usage);
          return { output: checked.output as PromptOutput<typeof prompt>, calls };
        }
        await log("invalid_output", completion.model, completion.usage, checked.problem);
        // Asking again won't fit more into the same token limit.
        if (attempt > repairs || completion.stopReason === "max_tokens") {
          throw new LlmCallError("invalid_output", `${prompt.id} v${prompt.version} didn't return valid output: ${checked.problem}`, calls);
        }
        problem = checked.problem;
      }
    },
  };
}

type Checked = { ok: true; output: unknown } | { ok: false; problem: string };

/** Validates model output. Problems name paths and rules, never the text, which may hold seller data. */
export function parseOutput(schema: z.ZodType, text: string): Checked {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // JSON.parse's own message quotes the text.
    return { ok: false, problem: "The output isn't valid JSON." };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, output: result.data };
  const issues = result.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return { ok: false, problem: issues.join("; ") };
}

function truncated(route: Route): Checked {
  return { ok: false, problem: `The output was cut off at ${route.maxTokens} tokens.` };
}

function repairNote(problem: string): string {
  return `An earlier answer to this didn't match the required output schema (${problem}). Answer again, matching the schema exactly.`;
}
