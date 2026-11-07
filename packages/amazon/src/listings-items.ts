import { transitionRefusal, type Proposal } from "@app/core";
import { z } from "zod";
import type { RateLimit } from "./rate-limit";
import type { SpApiRequest } from "./sp-api";

// Listings Items API 2021-08-01. Wire shapes follow Amazon's model (amzn/selling-partner-api-models,
// listingsItems_2021-08-01.json). Fields Amazon treats as open-ended stay strings, so a new value
// doesn't break parsing.

const BASE_PATH = "/listings/2021-08-01/items";

/** Amazon's usage plans, per seller and operation. */
export const LISTINGS_ITEMS_RATE_LIMITS = {
  getListingsItem: { rate: 5, burst: 10 },
  searchListingsItems: { rate: 5, burst: 5 },
  patchListingsItem: { rate: 5, burst: 5 },
} as const satisfies Record<string, RateLimit>;

export const ListingsIncludedDataSchema = z.enum([
  "summaries",
  "attributes",
  "issues",
  "offers",
  "fulfillmentAvailability",
  "procurement",
  "relationships",
  "productTypes",
]);
export type ListingsIncludedData = z.infer<typeof ListingsIncludedDataSchema>;

const MoneySchema = z.object({ currencyCode: z.string(), amount: z.string() });

export const ItemImageSchema = z.object({ link: z.string(), height: z.number().int(), width: z.number().int() });

export const ItemSummarySchema = z.object({
  marketplaceId: z.string(),
  asin: z.string().optional(),
  productType: z.string(),
  conditionType: z.string().optional(),
  /** BUYABLE, DISCOVERABLE; empty when neither. */
  status: z.array(z.string()),
  fnSku: z.string().optional(),
  itemName: z.string().optional(),
  createdDate: z.string(),
  lastUpdatedDate: z.string(),
  mainImage: ItemImageSchema.optional(),
});
export type ItemSummary = z.infer<typeof ItemSummarySchema>;

export const ListingIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["ERROR", "WARNING", "INFO"]),
  attributeNames: z.array(z.string()).optional(),
  categories: z.array(z.string()),
  enforcements: z
    .object({
      actions: z.array(z.object({ action: z.string() })),
      exemption: z.object({ status: z.string(), expiryDate: z.string().optional() }),
    })
    .optional(),
  marketplaceIds: z.array(z.string()).optional(),
});
export type ListingIssue = z.infer<typeof ListingIssueSchema>;

export const ItemOfferSchema = z.object({
  marketplaceId: z.string(),
  offerType: z.string(),
  price: MoneySchema,
  points: z.object({ pointsNumber: z.number().int() }).optional(),
  audience: z.object({ value: z.string().optional(), displayName: z.string().optional() }).optional(),
});

export const FulfillmentAvailabilitySchema = z.object({ fulfillmentChannelCode: z.string(), quantity: z.number().int().optional() });

/** Attribute values keyed by attribute name; their shape is set by the product type definition. */
export const ListingAttributesSchema = z.record(z.string(), z.unknown());

export const ListingsItemSchema = z.object({
  sku: z.string(),
  summaries: z.array(ItemSummarySchema).optional(),
  attributes: ListingAttributesSchema.optional(),
  issues: z.array(ListingIssueSchema).optional(),
  offers: z.array(ItemOfferSchema).optional(),
  fulfillmentAvailability: z.array(FulfillmentAvailabilitySchema).optional(),
  procurement: z.array(z.object({ costPrice: MoneySchema })).optional(),
  relationships: z.array(z.object({ marketplaceId: z.string(), relationships: z.array(z.record(z.string(), z.unknown())) })).optional(),
  productTypes: z.array(z.object({ marketplaceId: z.string(), productType: z.string() })).optional(),
});
export type ListingsItem = z.infer<typeof ListingsItemSchema>;

export const ListingsSearchResultSchema = z.object({
  numberOfResults: z.number().int(),
  pagination: z.object({ nextToken: z.string().optional(), previousToken: z.string().optional() }).optional(),
  items: z.array(ListingsItemSchema),
});
export type ListingsSearchResult = z.infer<typeof ListingsSearchResultSchema>;

export const PatchOperationSchema = z.object({
  op: z.enum(["add", "replace", "merge", "delete"]),
  /** JSON pointer to the attribute, e.g. "/attributes/item_name". */
  path: z.string().startsWith("/"),
  value: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

export const ListingsItemPatchRequestSchema = z.object({ productType: z.string().min(1), patches: z.array(PatchOperationSchema).min(1) });
export type ListingsItemPatchRequest = z.infer<typeof ListingsItemPatchRequestSchema>;

export const ListingsSubmissionSchema = z.object({
  sku: z.string(),
  /** ACCEPTED when submitted; VALID or INVALID for a validation preview. */
  status: z.enum(["ACCEPTED", "INVALID", "VALID"]),
  submissionId: z.string(),
  issues: z.array(ListingIssueSchema).optional(),
  identifiers: z.array(z.object({ marketplaceId: z.string().optional(), asin: z.string().optional() })).optional(),
});
export type ListingsSubmission = z.infer<typeof ListingsSubmissionSchema>;

export type GetListingsItemInput = {
  sellerId: string;
  sku: string;
  marketplaceIds: string[];
  includedData?: ListingsIncludedData[];
  issueLocale?: string;
};

export type SearchListingsItemsInput = {
  sellerId: string;
  marketplaceIds: string[];
  includedData?: ListingsIncludedData[];
  issueLocale?: string;
  identifiers?: string[];
  identifiersType?: "ASIN" | "EAN" | "FNSKU" | "GTIN" | "ISBN" | "JAN" | "MINSAN" | "SKU" | "UPC";
  variationParentSku?: string;
  packageHierarchySku?: string;
  createdAfter?: string;
  createdBefore?: string;
  lastUpdatedAfter?: string;
  lastUpdatedBefore?: string;
  withIssueSeverity?: ("WARNING" | "ERROR")[];
  withStatus?: ("BUYABLE" | "DISCOVERABLE")[];
  withoutStatus?: ("BUYABLE" | "DISCOVERABLE")[];
  sortBy?: "sku" | "createdDate" | "lastUpdatedDate";
  sortOrder?: "ASC" | "DESC";
  /** 1–20; Amazon's default is 10. */
  pageSize?: number;
  pageToken?: string;
};

/** The proposal a write publishes; the client checks its status, not its contents. */
export type PublishingProposal = Pick<Proposal, "id" | "status">;

export type PatchListingsItemInput = {
  sellerId: string;
  sku: string;
  marketplaceIds: string[];
  body: ListingsItemPatchRequest;
  includedData?: ("identifiers" | "issues")[];
  issueLocale?: string;
} & (
  | {
      /** Amazon checks the patch and changes nothing, so no proposal is needed. */
      mode: "VALIDATION_PREVIEW";
      proposal?: PublishingProposal;
    }
  | {
      mode?: undefined;
      /** Must be approved: nothing else is ever written to Amazon. */
      proposal: PublishingProposal;
    }
);

/** A write to Amazon for a proposal that isn't approved. Nothing was sent. */
export class ProposalNotApprovedError extends Error {
  override name = "ProposalNotApprovedError";
}

const listingPath = (sellerId: string, sku?: string) =>
  `${BASE_PATH}/${encodeURIComponent(sellerId)}${sku === undefined ? "" : `/${encodeURIComponent(sku)}`}`;

export function listingsItemsOperations(request: SpApiRequest) {
  return {
    /** One listing by SKU. */
    getListingsItem(input: GetListingsItemInput): Promise<ListingsItem> {
      return request({
        operation: "getListingsItem",
        rateLimit: LISTINGS_ITEMS_RATE_LIMITS.getListingsItem,
        sellerId: input.sellerId,
        method: "GET",
        path: listingPath(input.sellerId, input.sku),
        query: { marketplaceIds: input.marketplaceIds, includedData: input.includedData, issueLocale: input.issueLocale },
        schema: ListingsItemSchema,
      });
    },

    /** A page of the seller's listings, filtered by identifiers, status, dates and more. */
    searchListingsItems(input: SearchListingsItemsInput): Promise<ListingsSearchResult> {
      const { sellerId, ...query } = input;
      return request({
        operation: "searchListingsItems",
        rateLimit: LISTINGS_ITEMS_RATE_LIMITS.searchListingsItems,
        sellerId,
        method: "GET",
        path: listingPath(sellerId),
        query,
        schema: ListingsSearchResultSchema,
      });
    },

    /**
     * Changes a listing's attributes. Refused before anything is sent unless the proposal is
     * approved, or the call is a validation preview.
     */
    patchListingsItem(input: PatchListingsItemInput): Promise<ListingsSubmission> {
      if (input.mode !== "VALIDATION_PREVIEW") {
        const refusal = input.proposal ? transitionRefusal(input.proposal.status, "publish") : "A write to Amazon needs an approved proposal.";
        if (refusal) return Promise.reject(new ProposalNotApprovedError(refusal));
      }
      return request({
        operation: "patchListingsItem",
        rateLimit: LISTINGS_ITEMS_RATE_LIMITS.patchListingsItem,
        sellerId: input.sellerId,
        method: "PATCH",
        path: listingPath(input.sellerId, input.sku),
        query: { marketplaceIds: input.marketplaceIds, includedData: input.includedData, mode: input.mode, issueLocale: input.issueLocale },
        body: ListingsItemPatchRequestSchema.parse(input.body),
        schema: ListingsSubmissionSchema,
      });
    },
  };
}
