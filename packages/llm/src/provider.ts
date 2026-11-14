import type { LlmProviderName } from "@app/core";
import type { z } from "zod";
import type { TokenUsage } from "./pricing";
import type { Effort } from "./routing";

/**
 * What a provider does with what we send it. The gateway refuses a provider that may train on it:
 * prompts carry seller data.
 */
export type DataPolicy = {
  trainsOnInputs: boolean;
  /** Where the commitment comes from: a contract term, an account setting, or "nothing leaves the process". */
  basis: string;
};

export type CompletionRequest = {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  effort: Effort;
  /** The prompt's output schema, for providers that can constrain output to it. The gateway validates either way. */
  output: z.ZodType;
};

export type Completion = {
  /** The model that answered, which prices the call. */
  model: string;
  text: string;
  /** end: finished on its own. max_tokens: cut off, so the text is incomplete. refusal: declined to answer. */
  stopReason: "end" | "max_tokens" | "refusal";
  usage: TokenUsage;
};

/** One model vendor behind the gateway. Only packages/llm talks to a vendor's SDK. */
export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly dataPolicy: DataPolicy;
  complete(request: CompletionRequest): Promise<Completion>;
}

/** A provider call that failed before answering. `message` names what failed, never what was sent. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LlmProviderError";
  }
}
