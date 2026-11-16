import { ListingCopySchema, changedListingPaths, type ListingCopy, type ListingDraft, type LlmCall } from "@app/core";
import { createLlmGateway, type CompletionRequest, type LlmProvider } from "@app/llm";
import { validateAttributes } from "@app/rules";
import { describe, expect, it } from "vitest";
import { LISTING_OPTIMIZER_PASS_BAR, evaluateListingOptimizer } from "./evals/listing-optimizer";
import { EVAL_LANGUAGE_TAG, EVAL_MARKETPLACE_ID, LISTING_OPTIMIZER_CASES, type ListingOptimizerCase } from "./evals/listing-optimizer.cases";
import { optimizeListing, passesGuard } from "./listing-optimizer";

/** A provider that answers each test product with a draft written in the test. */
function fakeProvider(answer: (testCase: ListingOptimizerCase) => ListingDraft | string, requests: CompletionRequest[] = []): LlmProvider {
  return {
    name: "anthropic",
    dataPolicy: { trainsOnInputs: false, basis: "test" },
    complete: async (request) => {
      requests.push(request);
      const testCase = LISTING_OPTIMIZER_CASES.find((candidate) => request.user.includes(JSON.stringify(candidate.live.title)))!;
      const draft = answer(testCase);
      return {
        model: request.model,
        text: typeof draft === "string" ? draft : JSON.stringify(draft),
        stopReason: "end",
        usage: { inputTokens: 2000, outputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

function gatewayFor(provider: LlmProvider, calls: LlmCall[] = []) {
  return createLlmGateway({ provider, record: (call) => void calls.push(call), repairs: 0 });
}

/** A plain, grounded draft: features as bullets, each citing its fact. */
function groundedDraft({ brand, facts, live }: ListingOptimizerCase): ListingDraft {
  const listing: ListingCopy = {
    title: `${brand} – ${facts.material}, ${facts.color}`,
    bullets: facts.features.slice(0, 5),
    description: `In the box: ${facts.includedComponents.join(", ")}.`,
    backendKeywords: live.backendKeywords,
  };
  return {
    listing,
    changes: changedListingPaths(live, listing).map((path) => ({ path, reason: "Grounded in the facts." })),
    claims: [
      { path: "title", text: facts.material, facts: ["material"] },
      ...listing.bullets.map((bullet, i) => ({ path: `bullets.${i}` as const, text: bullet, facts: [`features.${i}`] })),
      { path: "description", text: facts.includedComponents.join(", "), facts: facts.includedComponents.map((_, i) => `includedComponents.${i}`) },
    ],
  };
}

/** Hands the live listing back unchanged. */
const echoLive = ({ live }: ListingOptimizerCase): ListingDraft => ({ listing: live, changes: [], claims: [] });

const [bottle] = LISTING_OPTIMIZER_CASES;
const input = { ...bottle!, marketplaceId: EVAL_MARKETPLACE_ID, languageTag: EVAL_LANGUAGE_TAG };

describe("optimizeListing", () => {
  it("asks for a draft with the schema's limits and every claim the guard rejects, and logs the call", async () => {
    const requests: CompletionRequest[] = [];
    const calls: LlmCall[] = [];
    const result = await optimizeListing(gatewayFor(fakeProvider(groundedDraft, requests), calls), input);

    expect(result.violations).toEqual([]);
    expect(result.grounding).toEqual([]);
    expect(result.calls).toEqual(calls);
    expect(calls[0]).toMatchObject({ promptId: "listing_writer.rewrite", promptVersion: 2, outcome: "ok" });
    const user = requests[0]!.user;
    expect(user).toContain('"titleMaxLength": 200');
    // The product's own prohibited claims and Amazon's.
    for (const claim of ["BPA free", "leak proof", "clinically proven", "eco-friendly"]) expect(user).toContain(JSON.stringify(claim));
    expect(user).toContain('"ref": "features.0"');
  });

  it("returns the guard's violations and the grounding problems on the draft as it came back", async () => {
    const draft = groundedDraft(bottle!);
    const leaky: ListingDraft = {
      ...draft,
      listing: { ...draft.listing, bullets: [...draft.listing.bullets.slice(0, 4), "LEAK PROOF – BPA free lid."] },
      claims: draft.claims.filter((claim) => claim.path !== "bullets.4"),
    };
    const result = await optimizeListing(gatewayFor(fakeProvider(() => leaky)), input);

    expect(passesGuard(result.violations)).toBe(false);
    expect(result.violations.map(({ rule, path, match }) => [rule, path, match])).toEqual([
      ["prohibited_claim", "bullets.4", "LEAK PROOF"],
      ["prohibited_claim", "bullets.4", "BPA free"],
    ]);
    expect(result.grounding.map(({ kind, path }) => [kind, path])).toEqual([["uncited", "bullets.4"]]);
  });

  it("uses the product type's tighter title limit", async () => {
    const shampoo = LISTING_OPTIMIZER_CASES.find((testCase) => testCase.name === "dog-shampoo")!;
    const requests: CompletionRequest[] = [];
    const long = (testCase: ListingOptimizerCase) => {
      const draft = groundedDraft(testCase);
      return { ...draft, listing: { ...draft.listing, title: `${testCase.brand} ${"Oatmeal Shampoo Formula, ".repeat(6)}`.slice(0, 180) } };
    };
    const result = await optimizeListing(gatewayFor(fakeProvider(long, requests)), { ...shampoo, marketplaceId: EVAL_MARKETPLACE_ID, languageTag: EVAL_LANGUAGE_TAG });

    expect(requests[0]!.user).toContain('"titleMaxLength": 150');
    expect(result.violations.map((violation) => violation.keyword)).toContain("maxLength");
  });
});

describe("the listing optimizer's test products", () => {
  it("are ten, each with facts, keywords, a usable schema and a live listing Amazon would hold", () => {
    expect(LISTING_OPTIMIZER_CASES).toHaveLength(10);
    expect(new Set(LISTING_OPTIMIZER_CASES.map((testCase) => testCase.name)).size).toBe(10);
    for (const testCase of LISTING_OPTIMIZER_CASES) {
      expect(ListingCopySchema.parse(testCase.live)).toEqual(testCase.live);
      expect(testCase.keywords.length, testCase.name).toBeGreaterThanOrEqual(5);
      expect(validateAttributes({}, testCase.productTypeSchema).map((violation) => violation.rule)).not.toContain("product_type_schema");
    }
  });

  it("set a bar the live listings don't clear on their own", async () => {
    const evaluation = await evaluateListingOptimizer(gatewayFor(fakeProvider(echoLive)));
    expect(evaluation.results.filter((result) => !result.passed).map((result) => result.name)).toEqual([
      "cutting-board",
      "silicone-utensils",
      "phone-case",
      "trash-bags",
      "hand-cream",
    ]);
    expect(evaluation.ok).toBe(false);
  });
});

describe("evaluateListingOptimizer", () => {
  it("passes when grounded drafts clear the guard on every product", async () => {
    const calls: LlmCall[] = [];
    const evaluation = await evaluateListingOptimizer(gatewayFor(fakeProvider(groundedDraft), calls));
    expect(evaluation).toMatchObject({ passed: 10, total: 10, ok: true });
    for (const result of evaluation.results) expect(result.grounding, result.name).toEqual([]);
    expect(calls).toHaveLength(10);
  });

  it(`fails under ${LISTING_OPTIMIZER_PASS_BAR}, counting a product with no valid draft as a failure`, async () => {
    const broken = new Set(["water-bottle", "yoga-mat", "led-desk-lamp"]);
    const evaluation = await evaluateListingOptimizer(
      gatewayFor(fakeProvider((testCase) => (broken.has(testCase.name) ? "not json" : groundedDraft(testCase)))),
    );
    expect(evaluation).toMatchObject({ passed: 7, total: 10, ok: false });
    expect(evaluation.results.find((result) => result.name === "yoga-mat")?.error).toMatch(/didn't return valid output/);
  });
});
