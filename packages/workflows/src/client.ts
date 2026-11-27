import { LISTINGS_ITEM_NOTIFICATION_TYPES } from "@app/amazon";
import { NewListingBriefSchema, ProposalStatusSchema } from "@app/core";
import { Inngest, eventType } from "inngest";
import { z } from "zod";

/** The app's Inngest client. The web app serves its functions at /api/inngest. */
export const inngest = new Inngest({ id: "specialist" });

/** Sync one seller account's catalog from Amazon now: sent nightly for every authorized account, and on demand. */
export const catalogSyncRequested = eventType("amazon/catalog.sync.requested", {
  schema: z.object({ sellerAccountId: z.string().min(1) }),
});

/** A member asked for a new listing from the New listing wizard's brief. Starts the newListing workflow. */
export const newListingRequested = eventType("listing/new.requested", {
  schema: z.object({ sellerAccountId: z.string().min(1), memberId: z.string().min(1), brief: NewListingBriefSchema }),
});

/**
 * A member started the listing optimizer on a product (DataSource.startListingOptimizer made the
 * run). Starts the optimizeListing workflow, which fills that run in.
 */
export const listingOptimizeRequested = eventType("listing/optimize.requested", {
  schema: z.object({ runId: z.string().min(1), productId: z.string().min(1) }),
});

/**
 * A member (or autonomy) decided a proposal. Sent after the decision is saved; workflows waiting on a
 * proposal read its status again rather than trust this.
 */
export const proposalDecided = eventType("app/proposal.decided", {
  schema: z.object({ proposalId: z.string().min(1), status: ProposalStatusSchema }),
});

/**
 * Amazon says a listing's issues or status changed (an SP-API LISTINGS_ITEM_ISSUES_CHANGE or
 * LISTINGS_ITEM_STATUS_CHANGE notification). Only which listing: the rest is read from Amazon.
 */
export const listingsItemChanged = eventType("amazon/listings-item.changed", {
  schema: z.object({
    notificationType: z.enum(LISTINGS_ITEM_NOTIFICATION_TYPES),
    sellerId: z.string().min(1),
    marketplaceId: z.string().min(1),
    sku: z.string().min(1),
  }),
});
