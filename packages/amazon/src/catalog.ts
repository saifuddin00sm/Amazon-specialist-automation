import {
  AsinSchema,
  ImportedListingSchema,
  LISTING_LIMITS,
  ListingCopySchema,
  type ImportedListing,
  type Marketplace,
  type ProductStatus,
} from "@app/core";
import { z } from "zod";
import type { SpApiClient } from "./client";
import { MARKETPLACE_IDS } from "./endpoints";
import type { ItemSummary, ListingsItem } from "./listings-items";

// Reads a seller's listings for the catalog sync and maps them to the catalog's records. Attribute
// values follow Amazon's listing attribute JSON: an array of { value, language_tag, marketplace_id }.

/** The most listings searchListingsItems returns per page. */
export const CATALOG_PAGE_SIZE = 20;

const CATALOG_INCLUDED_DATA = ["summaries", "attributes", "offers", "issues"] as const;

/**
 * Why listings, or their copy, stayed out of the catalog, with how many. Reasons never carry seller
 * data, so they can be logged and audited.
 */
export type SkippedListings = Record<string, number>;

export type CatalogPage = {
  listings: ImportedListing[];
  skipped: SkippedListings;
  /** Undefined on the last page. */
  nextPageToken?: string;
};

export type FetchCatalogPageInput = { sellerId: string; marketplace: Marketplace; pageToken?: string };

/** One page of a seller's listings in one marketplace, mapped to the catalog. */
export async function fetchCatalogPage(client: Pick<SpApiClient, "searchListingsItems">, input: FetchCatalogPageInput): Promise<CatalogPage> {
  const marketplaceId = MARKETPLACE_IDS[input.marketplace];
  const result = await client.searchListingsItems({
    sellerId: input.sellerId,
    marketplaceIds: [marketplaceId],
    includedData: [...CATALOG_INCLUDED_DATA],
    pageSize: CATALOG_PAGE_SIZE,
    pageToken: input.pageToken,
  });

  const listings: ImportedListing[] = [];
  const skipped: SkippedListings = {};
  for (const item of result.items) {
    const { listing, skipped: reason } = importListing(item, marketplaceId);
    if (listing) listings.push(listing);
    if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
  }
  const nextPageToken = result.pagination?.nextToken;
  return { listings, skipped, ...(nextPageToken ? { nextPageToken } : {}) };
}

/**
 * Maps one listing in one marketplace to the catalog. Without a listing, `skipped` says why it was left
 * out; with one, `skipped` says why its copy was (the product is still imported).
 */
export function importListing(item: ListingsItem, marketplaceId: string): { listing?: ImportedListing; skipped?: string } {
  const summary = item.summaries?.find((candidate) => candidate.marketplaceId === marketplaceId);
  if (!summary) return { skipped: "Not listed in this marketplace" };
  if (!summary.asin) return { skipped: "No ASIN yet" };
  if (!AsinSchema.safeParse(summary.asin).success) return { skipped: "ASIN isn't a B0 ASIN (a book's ISBN, say)" };

  const attributes = new ListingAttributes(item.attributes ?? {}, marketplaceId);
  const title = summary.itemName?.trim() || attributes.texts("item_name")[0];
  if (!title) return { skipped: "No title" };

  const copy = ListingCopySchema.safeParse({
    title,
    bullets: attributes.texts("bullet_point"),
    description: attributes.texts("product_description")[0] ?? "",
    backendKeywords: attributes.texts("generic_keyword").join(" "),
  });
  const listing = ImportedListingSchema.parse({
    asin: summary.asin,
    sku: item.sku,
    title,
    // Amazon's own brand name for unbranded products.
    brand: attributes.texts("brand")[0] ?? "Generic",
    category: categoryName(summary.productType),
    price: price(item, attributes, marketplaceId),
    status: listingStatus(item, summary, marketplaceId),
    createdAt: new Date(summary.createdDate).toISOString(),
    ...(copy.success ? { copy: copy.data } : {}),
  });
  return copy.success ? { listing } : { listing, skipped: `Imported without its copy: ${copyProblem(copy.error)}` };
}

const AttributeValuesSchema = z.array(
  // Structured attributes (purchasable_offer) have no `value`.
  z.looseObject({ value: z.unknown().optional(), marketplace_id: z.string().optional(), language_tag: z.string().optional() }),
);

/** A listing's attribute values in one marketplace, in the language of its title. */
class ListingAttributes {
  private readonly language: string | undefined;

  constructor(
    private readonly attributes: Record<string, unknown>,
    private readonly marketplaceId: string,
  ) {
    // Some marketplaces carry copy in more than one language (en_CA and fr_CA); keep the title's.
    this.language = this.entries("item_name")[0]?.language_tag;
  }

  entries(name: string) {
    const parsed = AttributeValuesSchema.safeParse(this.attributes[name]);
    if (!parsed.success) return [];
    return parsed.data.filter((entry) => entry.marketplace_id === undefined || entry.marketplace_id === this.marketplaceId);
  }

  /** Non-empty text values, in Amazon's order. */
  texts(name: string): string[] {
    return this.entries(name)
      .filter((entry) => this.language === undefined || entry.language_tag === undefined || entry.language_tag === this.language)
      .flatMap((entry) => (typeof entry.value === "string" && entry.value.trim() ? [entry.value.trim()] : []));
  }
}

/** HOME_BED_AND_BATH → "Home bed and bath". */
function categoryName(productType: string): string {
  const words = productType.toLowerCase().split("_").filter(Boolean).join(" ");
  return words ? words[0]!.toUpperCase() + words.slice(1) : productType;
}

const PurchasableOfferSchema = z.array(
  z.looseObject({
    marketplace_id: z.string().optional(),
    our_price: z.array(z.looseObject({ schedule: z.array(z.looseObject({ value_with_tax: z.number().nonnegative() })) })).optional(),
  }),
);

/** The B2C offer's price, else the price in the listing's attributes, else 0 (nothing on offer yet). */
function price(item: ListingsItem, attributes: ListingAttributes, marketplaceId: string): number {
  const offer = item.offers?.find((candidate) => candidate.marketplaceId === marketplaceId && candidate.offerType === "B2C");
  const amount = offer ? Number(offer.price.amount) : NaN;
  if (Number.isFinite(amount) && amount >= 0) return amount;
  const purchasable = PurchasableOfferSchema.safeParse(attributes.entries("purchasable_offer"));
  return (purchasable.success && purchasable.data[0]?.our_price?.[0]?.schedule[0]?.value_with_tax) || 0;
}

/** Enforcements that keep a listing from buyers. */
const SUPPRESSING_ACTIONS = new Set(["LISTING_SUPPRESSED", "SEARCH_SUPPRESSED", "CATALOG_ITEM_REMOVED"]);

/** Suppressed while an enforcement without exemption hides it; else active when buyable. */
function listingStatus(item: ListingsItem, summary: ItemSummary, marketplaceId: string): ProductStatus {
  const suppressed = (item.issues ?? []).some(
    (issue) =>
      (issue.marketplaceIds === undefined || issue.marketplaceIds.includes(marketplaceId)) &&
      issue.enforcements?.exemption.status === "NOT_EXEMPT" &&
      issue.enforcements.actions.some((enforcement) => SUPPRESSING_ACTIONS.has(enforcement.action)),
  );
  if (suppressed) return "suppressed";
  return summary.status.includes("BUYABLE") ? "active" : "inactive";
}

/** Which of LISTING_LIMITS Amazon's copy breaks, without quoting it. */
function copyProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  const [field, index] = issue?.path ?? [];
  switch (field) {
    case "title":
      return `title over ${LISTING_LIMITS.titleMaxLength} characters`;
    case "bullets":
      if (index !== undefined) return `a bullet point over ${LISTING_LIMITS.bulletMaxLength} characters`;
      return issue?.code === "too_small" ? "no bullet points" : `more than ${LISTING_LIMITS.bulletMaxCount} bullet points`;
    case "description":
      return `description over ${LISTING_LIMITS.descriptionMaxLength} characters`;
    case "backendKeywords":
      return `backend keywords over ${LISTING_LIMITS.backendKeywordsMaxBytes} bytes`;
    default:
      return "copy outside Amazon's limits";
  }
}
