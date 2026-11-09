import { z } from "zod";
import { ActorSchema, IdSchema, IsoDateTimeSchema, MoneySchema } from "./common";

export const AsinSchema = z.string().regex(/^B0[0-9A-Z]{8}$/);

export const ProductStatusSchema = z.enum(["active", "inactive", "suppressed"]);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const ProductSchema = z.object({
  id: IdSchema,
  sellerAccountId: IdSchema,
  asin: AsinSchema,
  sku: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().min(1),
  category: z.string().min(1),
  price: MoneySchema,
  status: ProductStatusSchema,
  createdAt: IsoDateTimeSchema,
  /** When the catalog sync last found it on Amazon. Undefined for products it never imported. */
  syncedAt: IsoDateTimeSchema.optional(),
});
export type Product = z.infer<typeof ProductSchema>;

/** Ground truth about a product. Agents may only claim what is in here. */
export const ProductFactsSchema = z.object({
  productId: IdSchema,
  material: z.string().min(1),
  color: z.string().min(1),
  dimensions: z.object({
    lengthCm: z.number().positive(),
    widthCm: z.number().positive(),
    heightCm: z.number().positive(),
  }),
  weightGrams: z.number().positive(),
  includedComponents: z.array(z.string().min(1)).min(1),
  features: z.array(z.string().min(1)).min(1),
  /** Claims that must never appear in copy, e.g. "BPA free" when unverified. */
  prohibitedClaims: z.array(z.string().min(1)),
  targetKeywords: z.array(z.string().min(1)),
  updatedAt: IsoDateTimeSchema,
});
export type ProductFacts = z.infer<typeof ProductFactsSchema>;

/** Amazon limits enforced on every version, human or agent written. */
export const LISTING_LIMITS = {
  titleMaxLength: 200,
  bulletMaxCount: 5,
  bulletMaxLength: 500,
  descriptionMaxLength: 2000,
  backendKeywordsMaxBytes: 249,
} as const;

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const ListingVersionStatusSchema = z.enum(["draft", "proposed", "live", "superseded", "rejected"]);
export type ListingVersionStatus = z.infer<typeof ListingVersionStatusSchema>;

export const ListingVersionSchema = z.object({
  id: IdSchema,
  productId: IdSchema,
  version: z.number().int().positive(),
  status: ListingVersionStatusSchema,
  title: z.string().min(1).max(LISTING_LIMITS.titleMaxLength),
  bullets: z
    .array(z.string().min(1).max(LISTING_LIMITS.bulletMaxLength))
    .min(1)
    .max(LISTING_LIMITS.bulletMaxCount),
  description: z.string().max(LISTING_LIMITS.descriptionMaxLength),
  backendKeywords: z
    .string()
    .refine((value) => utf8ByteLength(value) <= LISTING_LIMITS.backendKeywordsMaxBytes, {
      message: `Backend keywords must be at most ${LISTING_LIMITS.backendKeywordsMaxBytes} bytes`,
    }),
  createdBy: ActorSchema,
  createdAt: IsoDateTimeSchema,
});
export type ListingVersion = z.infer<typeof ListingVersionSchema>;

/** A listing's copy (the ListingCopy type): what a ListingVersion holds besides its bookkeeping. */
export const ListingCopySchema = ListingVersionSchema.pick({ title: true, bullets: true, description: true, backendKeywords: true });

/**
 * One listing as it is on Amazon, read by the catalog sync. `copy` is left out when Amazon's copy
 * doesn't fit LISTING_LIMITS (no bullet points yet, say); the product is imported without it.
 */
export const ImportedListingSchema = ProductSchema.pick({
  asin: true,
  sku: true,
  title: true,
  brand: true,
  category: true,
  price: true,
  status: true,
  createdAt: true,
}).extend({ copy: ListingCopySchema.optional() });
export type ImportedListing = z.infer<typeof ImportedListingSchema>;
