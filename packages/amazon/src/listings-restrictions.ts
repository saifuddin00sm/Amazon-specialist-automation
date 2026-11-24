import { z } from "zod";
import type { RateLimit } from "./rate-limit";
import type { SpApiRequest } from "./sp-api";

// Listings Restrictions API 2021-08-01, following Amazon's model
// (listingsRestrictions_2021-08-01.json). Open-ended fields stay strings, so a new value doesn't
// break parsing.

const PATH = "/listings/2021-08-01/restrictions";

/** Amazon's usage plan, per seller and operation. */
export const LISTINGS_RESTRICTIONS_RATE_LIMITS = {
  getListingsRestrictions: { rate: 5, burst: 10 },
} as const satisfies Record<string, RateLimit>;

/** A path forward: usually Seller Central's page for requesting approval. */
export const RestrictionLinkSchema = z.object({ resource: z.string(), verb: z.string(), title: z.string().optional(), type: z.string().optional() });

export const RestrictionReasonSchema = z.object({
  message: z.string(),
  /** APPROVAL_REQUIRED, ASIN_NOT_FOUND or NOT_ELIGIBLE. */
  reasonCode: z.string().optional(),
  links: z.array(RestrictionLinkSchema).optional(),
});
export type RestrictionReason = z.infer<typeof RestrictionReasonSchema>;

export const RestrictionSchema = z.object({
  marketplaceId: z.string(),
  /** The condition it applies to; every condition when absent. */
  conditionType: z.string().optional(),
  reasons: z.array(RestrictionReasonSchema).optional(),
});
export type Restriction = z.infer<typeof RestrictionSchema>;

export const RestrictionListSchema = z.object({ restrictions: z.array(RestrictionSchema) });
export type RestrictionList = z.infer<typeof RestrictionListSchema>;

export type GetListingsRestrictionsInput = {
  /** Whose restrictions, and whose access token signs the call. */
  sellerId: string;
  asin: string;
  marketplaceIds: string[];
  /** e.g. new_new; every condition when left out. */
  conditionType?: string;
  reasonLocale?: string;
};

export function listingsRestrictionsOperations(request: SpApiRequest) {
  return {
    /** What keeps the seller from listing an ASIN, by marketplace and condition. Empty when nothing does. */
    getListingsRestrictions(input: GetListingsRestrictionsInput): Promise<RestrictionList> {
      return request({
        operation: "getListingsRestrictions",
        rateLimit: LISTINGS_RESTRICTIONS_RATE_LIMITS.getListingsRestrictions,
        sellerId: input.sellerId,
        method: "GET",
        path: PATH,
        query: input,
        schema: RestrictionListSchema,
      });
    },
  };
}

/** The restrictions that keep the seller from listing in this marketplace and condition. */
export function applicableRestrictions(list: RestrictionList, { marketplaceId, conditionType }: { marketplaceId: string; conditionType: string }): Restriction[] {
  return list.restrictions.filter(
    (restriction) => restriction.marketplaceId === marketplaceId && (restriction.conditionType === undefined || restriction.conditionType === conditionType),
  );
}

/**
 * Why the seller can't list, in Amazon's words, with where to ask for approval when Amazon offers it:
 * "Amazon restricts this ASIN: You need approval to list in this brand. Request approval via Seller
 * Central: https://…".
 */
export function restrictionMessage(restrictions: readonly Restriction[]): string {
  const reasons = restrictions.flatMap((restriction) => restriction.reasons ?? []);
  if (reasons.length === 0) return "Amazon restricts this ASIN for this seller and gave no reason.";
  const lines = reasons.map((reason) => {
    const link = reason.links?.find((candidate) => candidate.verb === "GET");
    const action = link ? ` ${(link.title ?? "Request approval").replace(/\.$/, "")}: ${link.resource}` : "";
    return `${reason.message.replace(/\.?$/, ".")}${action}`;
  });
  return `Amazon restricts this ASIN: ${lines.join(" ")}`;
}
