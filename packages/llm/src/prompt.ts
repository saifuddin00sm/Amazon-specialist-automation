import type { LlmTask } from "@app/core";
import { z } from "zod";

/**
 * One version of a prompt. A published version never changes (prompts.lock.json holds each one's
 * fingerprint); a change is a new file with the next version, so every logged call names the exact
 * text it ran. The output schema is part of the version: it is what the gateway validates against.
 */
export type Prompt<I extends z.ZodObject = z.ZodObject, O extends z.ZodType = z.ZodType> = {
  /** "<agent>.<job>", e.g. "listing_writer.rewrite". */
  id: string;
  version: number;
  task: LlmTask;
  /** Instructions that stay the same on every call, so the provider can cache them. */
  system: string;
  /** The user turn. Each {{name}} slot is filled from the input's field of that name. */
  template: string;
  input: I;
  output: O;
};

export type PromptInput<P extends Prompt> = z.input<P["input"]>;
export type PromptOutput<P extends Prompt> = z.output<P["output"]>;

const SLOT = /\{\{(\w+)\}\}/g;

/** Checks that the template's slots and the input's fields are the same set. */
export function definePrompt<I extends z.ZodObject, O extends z.ZodType>(prompt: Prompt<I, O>): Prompt<I, O> {
  if (!Number.isInteger(prompt.version) || prompt.version < 1) throw new Error(`${prompt.id}: version must be a positive integer.`);
  const slots = new Set([...prompt.template.matchAll(SLOT)].map((match) => match[1]!));
  const fields = new Set(Object.keys(prompt.input.shape));
  const unfilled = [...slots].filter((slot) => !fields.has(slot));
  const unused = [...fields].filter((field) => !slots.has(field));
  if (unfilled.length > 0) throw new Error(`${prompt.id} v${prompt.version}: no input field for {{${unfilled.join("}}, {{")}}}.`);
  if (unused.length > 0) throw new Error(`${prompt.id} v${prompt.version}: the template never uses ${unused.join(", ")}.`);
  return prompt;
}

/** The system prompt and user turn for one call. Strings go in as they are; anything else as JSON. */
export function renderPrompt<P extends Prompt>(prompt: P, input: PromptInput<P>): { system: string; user: string } {
  const values = prompt.input.parse(input) as Record<string, unknown>;
  const user = prompt.template.replace(SLOT, (_, name: string) => {
    const value = values[name];
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  });
  return { system: prompt.system, user };
}

export function promptLabel(prompt: Pick<Prompt, "id" | "version">): string {
  return `${prompt.id}@v${prompt.version}`;
}
