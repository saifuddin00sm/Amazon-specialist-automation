import {
  checkDraftGrounding,
  factSheet,
  type GroundingProblem,
  type ListingCopy,
  type ListingDraft,
  type LlmCall,
  type ProductFacts,
  type ReviewReport,
  type Violation,
} from "@app/core";
import { PROMPTS, type LlmGateway } from "@app/llm";
import { checkListingCopy, listingClaims, listingLimits } from "@app/rules";

export type ListingOptimizerInput = {
  brand: string;
  /** The Amazon product type, e.g. "BOTTLE". */
  productType: string;
  /** The product type's JSON schema: the copy's limits come from it, and the draft must pass it. */
  productTypeSchema: unknown;
  facts: ProductFacts;
  /** Most important first. */
  keywords: string[];
  live: ListingCopy;
  marketplaceId: string;
  languageTag: string;
  /** A reviewer's findings on the previous draft, when revising. */
  findings?: ReviewReport["findings"];
  /** The agent run step the call works on. */
  stepId?: string;
};

export type ListingOptimizerResult = {
  draft: ListingDraft;
  /** The compliance guard's verdict on the draft as returned. */
  violations: Violation[];
  /** Changes without a reason and claims without a fact. */
  grounding: GroundingProblem[];
  calls: LlmCall[];
};

/**
 * The listing optimizer: one call through the gateway for a draft that explains each change and cites
 * a fact for each claim, then the compliance guard and the grounding check on it as it came back.
 * Nothing here fixes the draft; whoever calls it decides what a failing draft means.
 */
export async function optimizeListing(gateway: LlmGateway, input: ListingOptimizerInput): Promise<ListingOptimizerResult> {
  const sheet = factSheet(input.brand, input.facts);
  const { output, calls } = await gateway.generate({
    prompt: PROMPTS.listingRewrite,
    input: {
      productType: input.productType,
      limits: listingLimits(input.productTypeSchema, input.productType),
      facts: sheet,
      prohibitedClaims: prohibitedPhrases(input.facts),
      keywords: input.keywords,
      live: input.live,
      findings: input.findings ?? [],
    },
    stepId: input.stepId,
  });
  const violations = checkListingCopy(output.listing, {
    brand: input.brand,
    category: input.productType,
    prohibitedClaims: input.facts.prohibitedClaims,
    productTypeSchema: input.productTypeSchema,
    marketplaceId: input.marketplaceId,
    languageTag: input.languageTag,
  });
  return { draft: output, violations, grounding: checkDraftGrounding(output, input.live, sheet), calls };
}

/** True when the guard found nothing that blocks approval. */
export function passesGuard(violations: readonly Violation[]): boolean {
  return !violations.some((violation) => violation.severity === "error");
}

/** Every phrase the guard rejects for this product, once each. */
function prohibitedPhrases(facts: ProductFacts): string[] {
  const seen = new Set<string>();
  return listingClaims(facts.prohibitedClaims).flatMap(({ phrase }) => {
    const key = phrase.trim().toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [phrase.trim()];
  });
}
