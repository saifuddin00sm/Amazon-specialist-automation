import {
  ImportedListingSchema,
  ListingVersionSchema,
  ProductSchema,
  type AuditEvent,
  type ImportedListing,
  type ListingCopy,
  type ListingVersion,
  type Product,
  type SellerAccount,
} from "@app/core";

export type CatalogSyncErrorCode = "not_found" | "forbidden" | "invalid_input";

/** A catalog sync write the data source refused. `message` is safe to show. */
export class CatalogSyncError extends Error {
  constructor(
    readonly code: CatalogSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CatalogSyncError";
  }
}

export const CATALOG_SYNC_ONLY = "Only the catalog sync imports listings from Amazon.";

/** How a page of listings changed the catalog. */
export type CatalogImportCounts = { created: number; updated: number; unchanged: number; newVersions: number };

type AuditEventDraft = Omit<AuditEvent, "id">;

export type CatalogImportContext = {
  account: SellerAccount | undefined;
  /** The account's products with the listings' SKUs. */
  products: readonly Product[];
  /** Every version of those products. */
  versions: readonly ListingVersion[];
  syncedAt: string;
  nextId: { product: () => string; listingVersion: () => string };
};

export type CatalogImportResult = {
  /** New products, and existing ones brought up to date (syncedAt included). */
  products: Product[];
  /** Live versions whose copy changed on Amazon, now superseded. */
  superseded: ListingVersion[];
  /** Their replacements, live, written by the system. */
  versions: ListingVersion[];
  counts: CatalogImportCounts;
};

const PRODUCT_FIELDS = ["asin", "title", "brand", "category", "price", "status"] as const;

const sameCopy = (version: ListingVersion, copy: ListingCopy) =>
  version.title === copy.title &&
  version.description === copy.description &&
  version.backendKeywords === copy.backendKeywords &&
  version.bullets.length === copy.bullets.length &&
  version.bullets.every((bullet, i) => bullet === copy.bullets[i]);

/**
 * Imports listings as Amazon has them, shared by every DataSource. Pure: matches products by SKU,
 * adds the new ones, brings the rest up to date, and gives a listing whose copy changed a new live
 * version (the old one is superseded). Copy Amazon didn't send leaves the live version alone.
 */
export function catalogImportWrite(ctx: CatalogImportContext, listings: ImportedListing[]): CatalogImportResult {
  const { account, syncedAt } = ctx;
  if (!account) throw new CatalogSyncError("not_found", "That seller account no longer exists.");
  const parsed = ImportedListingSchema.array().safeParse(listings);
  if (!parsed.success) throw new CatalogSyncError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid listings.");

  const result: CatalogImportResult = { products: [], superseded: [], versions: [], counts: { created: 0, updated: 0, unchanged: 0, newVersions: 0 } };
  for (const { copy, createdAt, sku, ...fields } of parsed.data) {
    const existing = ctx.products.find((product) => product.sku === sku);
    const product = ProductSchema.parse(
      existing
        ? { ...existing, ...fields, syncedAt }
        : { id: ctx.nextId.product(), sellerAccountId: account.id, sku, ...fields, createdAt, syncedAt },
    );
    result.products.push(product);
    if (!existing) result.counts.created += 1;
    else if (PRODUCT_FIELDS.some((field) => existing[field] !== product[field])) result.counts.updated += 1;
    else result.counts.unchanged += 1;

    if (!copy) continue;
    const versions = ctx.versions.filter((version) => version.productId === product.id);
    const live = versions.find((version) => version.status === "live");
    if (live && sameCopy(live, copy)) continue;
    if (live) result.superseded.push({ ...live, status: "superseded" });
    result.versions.push(
      ListingVersionSchema.parse({
        id: ctx.nextId.listingVersion(),
        productId: product.id,
        version: Math.max(0, ...versions.map((version) => version.version)) + 1,
        status: "live",
        ...copy,
        createdBy: { type: "system" },
        createdAt: syncedAt,
      }),
    );
    result.counts.newVersions += 1;
  }
  return result;
}

export type CatalogFinishContext = {
  account: SellerAccount | undefined;
  /** Every product in the account. */
  products: readonly Product[];
  at: string;
};

export type CatalogFinishInput = {
  syncedAt: string;
  counts: CatalogImportCounts;
  /** Why listings, or their copy, were left out, with how many. */
  skipped: Record<string, number>;
};

/**
 * Ends a sync that saw every listing. Pure: products it didn't see are no longer on Amazon and become
 * inactive; the catalog.synced event records what the sync did.
 */
export function catalogFinishWrite(ctx: CatalogFinishContext, { syncedAt, counts, skipped }: CatalogFinishInput): { deactivated: Product[]; events: AuditEventDraft[] } {
  const { account } = ctx;
  if (!account) throw new CatalogSyncError("not_found", "That seller account no longer exists.");
  const deactivated = ctx.products
    .filter((product) => product.syncedAt !== syncedAt && product.status !== "inactive")
    .map((product) => ProductSchema.parse({ ...product, status: "inactive" }));
  return {
    deactivated,
    events: [
      {
        workspaceId: account.workspaceId,
        sellerAccountId: account.id,
        at: ctx.at,
        actor: { type: "system" },
        action: "catalog.synced",
        entity: { type: "seller_account", id: account.id },
        metadata: { syncedAt, ...counts, deactivated: deactivated.length, skipped },
      },
    ],
  };
}
