import { z } from "zod";
import { LISTING_LIMITS, ListingCopySchema, type ProductFacts } from "./catalog";
import type { ListingCopy } from "./compliance";

/** Where in a listing a change or claim is: a field, or one bullet by its 0-based index. */
export const LISTING_COPY_PATHS = [
  "title",
  ...Array.from({ length: LISTING_LIMITS.bulletMaxCount }, (_, i) => `bullets.${i}` as const),
  "description",
  "backendKeywords",
] as const;
export const ListingCopyPathSchema = z.enum(LISTING_COPY_PATHS);
export type ListingCopyPath = z.infer<typeof ListingCopyPathSchema>;

/** One fact a draft may cite, by a ref that stays put while the facts do: "material", "features.2". */
export const FactSheetEntrySchema = z.object({ ref: z.string().min(1), fact: z.string().min(1) });
export type FactSheetEntry = z.infer<typeof FactSheetEntrySchema>;

/**
 * Everything a listing may claim about a product, one entry per fact. Prohibited claims and target
 * keywords aren't facts about the product, so they aren't in it.
 */
export function factSheet(brand: string, facts: ProductFacts): FactSheetEntry[] {
  const { lengthCm, widthCm, heightCm } = facts.dimensions;
  return [
    { ref: "brand", fact: brand },
    { ref: "material", fact: facts.material },
    { ref: "color", fact: facts.color },
    { ref: "dimensions", fact: `${lengthCm} × ${widthCm} × ${heightCm} cm` },
    { ref: "weight", fact: `${facts.weightGrams} g` },
    ...facts.features.map((fact, i) => ({ ref: `features.${i}`, fact })),
    ...facts.includedComponents.map((fact, i) => ({ ref: `includedComponents.${i}`, fact })),
  ];
}

/**
 * A rewritten listing as the optimizer returns it: the copy, why each field changed, and the facts
 * behind each claim it makes. Claims quote the copy, so a reader can find each one.
 */
export const ListingDraftSchema = z.object({
  listing: ListingCopySchema,
  changes: z.array(z.object({ path: ListingCopyPathSchema, reason: z.string().min(1) })),
  claims: z.array(z.object({ path: ListingCopyPathSchema, text: z.string().min(1), facts: z.array(z.string().min(1)).min(1) })),
});
export type ListingDraft = z.infer<typeof ListingDraftSchema>;

/** The paths whose text differs between two listings, in listing order. */
export function changedListingPaths(before: ListingCopy, after: ListingCopy): ListingCopyPath[] {
  return LISTING_COPY_PATHS.filter((path) => listingText(before, path) !== listingText(after, path));
}

export const GroundingProblemKindSchema = z.enum(["missing_reason", "reason_for_unchanged", "unknown_fact", "claim_not_in_copy", "uncited"]);
export type GroundingProblemKind = z.infer<typeof GroundingProblemKindSchema>;

export type GroundingProblem = { kind: GroundingProblemKind; path: ListingCopyPath; message: string };

/**
 * Where a draft doesn't explain or ground itself: a changed field with no reason (or a reason for one
 * that didn't change), a claim citing a fact the sheet doesn't have or quoting words the copy doesn't
 * contain, and a bullet or description that cites no fact at all.
 */
export function checkDraftGrounding(draft: ListingDraft, live: ListingCopy, sheet: readonly FactSheetEntry[]): GroundingProblem[] {
  const problems: GroundingProblem[] = [];
  const changed = new Set(changedListingPaths(live, draft.listing));
  const explained = new Set(draft.changes.map((change) => change.path));
  for (const path of changed) {
    if (!explained.has(path)) problems.push({ kind: "missing_reason", path, message: `${path} changed without a reason.` });
  }
  for (const path of explained) {
    if (!changed.has(path)) problems.push({ kind: "reason_for_unchanged", path, message: `${path} has a reason but didn't change.` });
  }

  const refs = new Set(sheet.map((entry) => entry.ref));
  for (const claim of draft.claims) {
    const unknown = claim.facts.filter((ref) => !refs.has(ref));
    if (unknown.length > 0) {
      problems.push({ kind: "unknown_fact", path: claim.path, message: `A claim in ${claim.path} cites ${unknown.join(", ")}, which the facts don't have.` });
    }
    if (!normalized(listingText(draft.listing, claim.path)).includes(normalized(claim.text))) {
      problems.push({ kind: "claim_not_in_copy", path: claim.path, message: `A claim cited in ${claim.path} isn't in its text.` });
    }
  }

  const cited = new Set(draft.claims.map((claim) => claim.path));
  const claimPaths: ListingCopyPath[] = [...draft.listing.bullets.map((_, i) => `bullets.${i}` as ListingCopyPath), "description"];
  for (const path of claimPaths) {
    if (listingText(draft.listing, path).trim().length > 0 && !cited.has(path)) {
      problems.push({ kind: "uncited", path, message: `${path} cites no fact.` });
    }
  }
  return problems;
}

/** The text at a path; empty for a bullet the listing doesn't have. */
export function listingText(copy: ListingCopy, path: ListingCopyPath): string {
  if (path.startsWith("bullets.")) return copy.bullets[Number(path.slice("bullets.".length))] ?? "";
  return copy[path as "title" | "description" | "backendKeywords"];
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
