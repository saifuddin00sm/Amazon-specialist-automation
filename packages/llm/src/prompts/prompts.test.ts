import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LlmTaskSchema } from "@app/core";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MODEL_PRICES } from "../pricing";
import { promptLabel, type Prompt } from "../prompt";
import { ROUTES } from "../routing";
import { PROMPTS, PROMPT_VERSIONS } from "./index";

/** "<id>@v<version>" → fingerprint of every published prompt version. */
const LOCK: Record<string, string> = JSON.parse(readFileSync(new URL("./prompts.lock.json", import.meta.url), "utf8"));

/** Everything a version's behaviour depends on: its text and both schemas. */
function fingerprint(prompt: Prompt): string {
  const content = JSON.stringify({
    task: prompt.task,
    system: prompt.system,
    template: prompt.template,
    input: z.toJSONSchema(prompt.input, { unrepresentable: "any" }),
    output: z.toJSONSchema(prompt.output, { unrepresentable: "any" }),
  });
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("prompt versions", () => {
  it.each(PROMPT_VERSIONS.map((prompt) => [promptLabel(prompt), prompt] as const))("%s is unchanged since it was published", (label, prompt) => {
    const actual = fingerprint(prompt);
    expect(
      LOCK[label],
      `${label} isn't in prompts.lock.json. If it is new, add "${label}": "${actual}". If you edited a published version, put the change in a new version instead.`,
    ).toBe(actual);
  });

  it("keeps every published version", () => {
    expect(Object.keys(LOCK).sort()).toEqual(PROMPT_VERSIONS.map(promptLabel).sort());
  });

  it("has one file per id and version", () => {
    expect(new Set(PROMPT_VERSIONS.map(promptLabel)).size).toBe(PROMPT_VERSIONS.length);
  });

  it("uses only registered versions, and one prompt for every task", () => {
    for (const prompt of Object.values(PROMPTS)) expect(PROMPT_VERSIONS).toContain(prompt);
    expect(Object.values(PROMPTS).map((prompt) => prompt.task).sort()).toEqual([...LlmTaskSchema.options].sort());
  });

  it.each(PROMPT_VERSIONS.map((prompt) => [promptLabel(prompt), prompt] as const))("%s's output schema converts to a structured output format", (_, prompt) => {
    expect(() => zodOutputFormat(prompt.output)).not.toThrow();
  });
});

describe("routes", () => {
  it("route every task to a priced model", () => {
    for (const task of LlmTaskSchema.options) expect(MODEL_PRICES[ROUTES[task].model], task).toBeDefined();
  });

  it("send drafts to a different model from the one that wrote them, at temperature 0", () => {
    expect(ROUTES.listing_review.model).not.toBe(ROUTES.listing_rewrite.model);
    expect(ROUTES.listing_review.model).not.toBe(ROUTES.listing_create.model);
    expect(ROUTES.listing_review.temperature).toBe(0);
  });
});
