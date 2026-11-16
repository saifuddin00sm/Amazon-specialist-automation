import { LISTING_COPY_FIELDS, LISTING_LIMITS, type ListingCopy, type Violation } from "@app/core";
import { validateAttributes } from "./attributes";
import { DEFAULT_PROHIBITED_CLAIMS, checkClaims, type ProhibitedClaim } from "./claims";
import { checkTitle, titleMaxLength, type TitleOptions } from "./title";

/** The product type attribute each listing field is sent to Amazon as. */
export const LISTING_ATTRIBUTES = {
  title: "item_name",
  bullets: "bullet_point",
  description: "product_description",
  backendKeywords: "generic_keyword",
} as const satisfies Record<(typeof LISTING_COPY_FIELDS)[number], string>;

export type ListingLimits = { [K in keyof typeof LISTING_LIMITS]: number };

export type ListingCheckOptions = TitleOptions & {
  /** The product type, for its title length. */
  category?: string;
  /** Claims this product may not make, on top of Amazon's: its ProductFacts' prohibitedClaims. */
  prohibitedClaims?: readonly string[];
  /** The product type's JSON schema. When given, the copy must also pass it as the attributes it is sent as. */
  productTypeSchema?: unknown;
  marketplaceId: string;
  languageTag: string;
};

const UNBACKED = "The product facts rule this claim out.";

/** Amazon's prohibited claims and the product's own, as the guard checks them. */
export function listingClaims(prohibitedClaims: readonly string[] = []): ProhibitedClaim[] {
  return [...DEFAULT_PROHIBITED_CLAIMS, ...prohibitedClaims.map((phrase) => ({ phrase, reason: UNBACKED }))];
}

/**
 * The compliance guard for a whole listing: the title policy, prohibited claims in every field, and,
 * with a product type schema, the copy as Amazon would validate it. Every violation names its field.
 */
export function checkListingCopy(copy: ListingCopy, options: ListingCheckOptions): Violation[] {
  const violations = checkTitle(copy.title, options.category, options);
  const claims = listingClaims(options.prohibitedClaims);
  const fields: [string, string][] = [
    ["title", copy.title],
    ...copy.bullets.map((bullet, i): [string, string] => [`bullets.${i}`, bullet]),
    ["description", copy.description],
    ["backendKeywords", copy.backendKeywords],
  ];
  for (const [path, text] of fields) violations.push(...checkClaims(text, claims).map((violation) => ({ ...violation, path })));

  if (options.productTypeSchema !== undefined) {
    const attributes = listingAttributes(copy, options);
    // A listing update patches these attributes only; the ones it doesn't send keep their values.
    const sent = new Set(Object.keys(attributes).map((name) => `/${name}`));
    const unsent = (violation: Violation) => violation.keyword === "required" && violation.path?.split("/").length === 2 && !sent.has(violation.path);
    violations.push(...validateAttributes(attributes, options.productTypeSchema).filter((violation) => !unsent(violation)));
  }
  return violations;
}

/** Listing copy as Amazon listing attributes, the way a patch sends them. Empty fields are left out. */
export function listingAttributes(
  copy: ListingCopy,
  { marketplaceId, languageTag }: { marketplaceId: string; languageTag: string },
): Record<string, { value: string; language_tag: string; marketplace_id: string }[]> {
  const value = (text: string) => ({ value: text, language_tag: languageTag, marketplace_id: marketplaceId });
  const attributes: Record<string, ReturnType<typeof value>[]> = {
    [LISTING_ATTRIBUTES.title]: [value(copy.title)],
    [LISTING_ATTRIBUTES.bullets]: copy.bullets.map(value),
  };
  if (copy.description.length > 0) attributes[LISTING_ATTRIBUTES.description] = [value(copy.description)];
  if (copy.backendKeywords.length > 0) attributes[LISTING_ATTRIBUTES.backendKeywords] = [value(copy.backendKeywords)];
  return attributes;
}

/**
 * The limits a product type puts on listing copy, read from its schema, never looser than Amazon's
 * own (LISTING_LIMITS) or the category's title length. A writer told these can stay inside the guard.
 */
export function listingLimits(productTypeSchema: unknown, category?: string, options: Pick<TitleOptions, "lengthOverrides"> = {}): ListingLimits {
  const property = (field: keyof typeof LISTING_ATTRIBUTES) => schemaObject(schemaObject(productTypeSchema)?.properties)?.[LISTING_ATTRIBUTES[field]];
  const value = (field: keyof typeof LISTING_ATTRIBUTES) => schemaObject(schemaObject(schemaObject(property(field))?.items)?.properties)?.value;
  const limit = (fallback: number, found: unknown) => (typeof found === "number" && found >= 0 ? Math.min(fallback, found) : fallback);
  const keywords = schemaObject(value("backendKeywords"));
  return {
    titleMaxLength: limit(titleMaxLength(category, options.lengthOverrides), schemaObject(value("title"))?.maxLength),
    bulletMaxCount: limit(LISTING_LIMITS.bulletMaxCount, schemaObject(property("bullets"))?.maxItems),
    bulletMaxLength: limit(LISTING_LIMITS.bulletMaxLength, schemaObject(value("bullets"))?.maxLength),
    descriptionMaxLength: limit(LISTING_LIMITS.descriptionMaxLength, schemaObject(value("description"))?.maxLength),
    backendKeywordsMaxBytes: limit(LISTING_LIMITS.backendKeywordsMaxBytes, keywords?.maxUtf8ByteLength ?? keywords?.maxLength),
  };
}

function schemaObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
