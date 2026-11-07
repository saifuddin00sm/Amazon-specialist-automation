import { z } from "zod";
import type { RateLimit } from "./rate-limit";
import type { SpApiRequest } from "./sp-api";

// Product Type Definitions API 2020-09-01, following Amazon's model
// (definitionsProductTypes_2020-09-01.json).

const BASE_PATH = "/definitions/2020-09-01/productTypes";

/** Amazon's usage plans, per seller and operation. */
export const PRODUCT_TYPE_DEFINITIONS_RATE_LIMITS = {
  searchDefinitionsProductTypes: { rate: 5, burst: 10 },
  getDefinitionsProductType: { rate: 5, burst: 10 },
} as const satisfies Record<string, RateLimit>;

export const ProductTypeSummarySchema = z.object({ name: z.string(), displayName: z.string(), marketplaceIds: z.array(z.string()) });
export type ProductTypeSummary = z.infer<typeof ProductTypeSummarySchema>;

export const ProductTypeListSchema = z.object({ productTypes: z.array(ProductTypeSummarySchema), productTypeVersion: z.string() });
export type ProductTypeList = z.infer<typeof ProductTypeListSchema>;

/** A presigned link to a JSON schema; it expires, so fetch it soon and check the checksum. */
const SchemaLinkSchema = z.object({ link: z.object({ resource: z.string(), verb: z.string() }), checksum: z.string() });

export const ProductTypeDefinitionSchema = z.object({
  metaSchema: SchemaLinkSchema.optional(),
  /** The JSON schema a listing's attributes must satisfy. */
  schema: SchemaLinkSchema,
  requirements: z.enum(["LISTING", "LISTING_PRODUCT_ONLY", "LISTING_OFFER_ONLY"]),
  requirementsEnforced: z.enum(["ENFORCED", "NOT_ENFORCED"]),
  propertyGroups: z.record(
    z.string(),
    z.object({ title: z.string().optional(), description: z.string().optional(), propertyNames: z.array(z.string()).optional() }),
  ),
  locale: z.string(),
  marketplaceIds: z.array(z.string()),
  productType: z.string(),
  displayName: z.string(),
  productTypeVersion: z.object({ version: z.string(), latest: z.boolean(), releaseCandidate: z.boolean().optional() }),
});
export type ProductTypeDefinition = z.infer<typeof ProductTypeDefinitionSchema>;

export type SearchProductTypesInput = {
  /** Whose access token signs the call. */
  sellerId: string;
  marketplaceIds: string[];
  /** Matched against product type names; can't be combined with itemName. */
  keywords?: string[];
  /** Product types recommended for an item with this title. */
  itemName?: string;
  locale?: string;
  searchLocale?: string;
};

export type GetProductTypeDefinitionInput = {
  /** Whose access token signs the call; also sent, so Amazon can tailor the requirements. */
  sellerId: string;
  productType: string;
  marketplaceIds: string[];
  productTypeVersion?: string;
  requirements?: ProductTypeDefinition["requirements"];
  requirementsEnforced?: ProductTypeDefinition["requirementsEnforced"];
  locale?: string;
};

export function productTypeDefinitionsOperations(request: SpApiRequest) {
  return {
    /** Product types matching keywords or an item name. */
    searchDefinitionsProductTypes(input: SearchProductTypesInput): Promise<ProductTypeList> {
      const { sellerId, ...query } = input;
      return request({
        operation: "searchDefinitionsProductTypes",
        rateLimit: PRODUCT_TYPE_DEFINITIONS_RATE_LIMITS.searchDefinitionsProductTypes,
        sellerId,
        method: "GET",
        path: BASE_PATH,
        query,
        schema: ProductTypeListSchema,
      });
    },

    /** One product type's definition: its attribute groups and a link to its JSON schema. */
    getDefinitionsProductType(input: GetProductTypeDefinitionInput): Promise<ProductTypeDefinition> {
      const { productType, ...query } = input;
      return request({
        operation: "getDefinitionsProductType",
        rateLimit: PRODUCT_TYPE_DEFINITIONS_RATE_LIMITS.getDefinitionsProductType,
        sellerId: input.sellerId,
        method: "GET",
        path: `${BASE_PATH}/${encodeURIComponent(productType)}`,
        query,
        schema: ProductTypeDefinitionSchema,
      });
    },
  };
}
