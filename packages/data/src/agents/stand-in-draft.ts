import { changedListingPaths, listingText, type FactSheetEntry, type LISTING_COPY_FIELDS, type ListingCopy, type ListingCopyPath, type ListingDraft } from "@app/core";

const REASONS: Record<(typeof LISTING_COPY_FIELDS)[number], string> = {
  title: "Leads with the main keyword, then the details shoppers filter by.",
  bullets: "One distinct benefit per bullet, from the product's features.",
  description: "Covers the product's features and what's in the box.",
  backendKeywords: "Adds target keywords the copy doesn't use yet.",
};

/**
 * A stand-in draft's account of itself, as the writer's prompt asks for it: a reason for each changed
 * path, and a claim for each fact whose words appear in the title, a bullet or the description.
 */
export function standInDraft(live: ListingCopy, listing: ListingCopy, sheet: readonly FactSheetEntry[]): ListingDraft {
  const changes = changedListingPaths(live, listing).map((path) => ({ path, reason: REASONS[path.startsWith("bullets.") ? "bullets" : (path as keyof typeof REASONS)] }));
  const paths: ListingCopyPath[] = ["title", ...listing.bullets.map((_, i) => `bullets.${i}` as ListingCopyPath), "description"];
  const claims = paths.flatMap((path) => {
    const text = listingText(listing, path);
    return sheet.flatMap(({ ref, fact }) => {
      const words = fact.replace(/\.$/, "");
      const at = text.toLowerCase().indexOf(words.toLowerCase());
      return at < 0 ? [] : [{ path, text: text.slice(at, at + words.length), facts: [ref] }];
    });
  });
  return { listing, changes, claims };
}
