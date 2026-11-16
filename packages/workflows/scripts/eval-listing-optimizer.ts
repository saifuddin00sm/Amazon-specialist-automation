/**
 * Runs the listing optimizer on its ten test products through Claude and checks the bar: the first
 * draft passes the compliance guard, with no fixes, on at least 8 of them.
 *
 *   pnpm eval:listing-optimizer
 *
 * Needs ANTHROPIC_API_KEY, from the environment or packages/workflows/.env.local. Makes ten model
 * calls (more when an answer doesn't match the schema) and prints what they cost. Exits 1 under the bar.
 */
import type { LlmCall } from "@app/core";
import { createLlmGateway } from "@app/llm";
import { fileURLToPath } from "node:url";
import { LISTING_OPTIMIZER_PASS_BAR, evalSpend, evaluateListingOptimizer } from "../src/evals/listing-optimizer";
import { llmProvider } from "../src/llm";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch {
  // No .env.local; the environment may still have the variables.
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to run the eval.");
  process.exit(1);
}

const calls: LlmCall[] = [];
const gateway = createLlmGateway({ provider: llmProvider(), record: (call) => void calls.push(call) });
const { results, passed, total, ok } = await evaluateListingOptimizer(gateway);

for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}`);
  if (result.error) console.log(`      ${result.error}`);
  for (const violation of result.violations) {
    console.log(`      ${violation.severity} ${violation.rule}${violation.path ? ` (${violation.path})` : ""}: ${violation.message}`);
  }
  for (const problem of result.grounding) console.log(`      grounding ${problem.kind}: ${problem.message}`);
}

const spend = evalSpend(calls);
console.log(`\n${passed}/${total} drafts passed the guard without fixes; the bar is ${LISTING_OPTIMIZER_PASS_BAR}.`);
console.log(`${spend.calls} model calls, $${spend.costUsd.toFixed(4)}.`);
process.exit(ok ? 0 : 1);
