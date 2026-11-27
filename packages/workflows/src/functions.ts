import { LwaError, MissingRefreshTokenError, ProposalNotApprovedError, TokenCryptoError } from "@app/amazon";
import { AgentRunError, CatalogSyncError, ProposalWriteError } from "@app/data";
import { NonRetriableError, cron } from "inngest";
import { authorizedSellerAccountIds, syncSellerCatalog, type RunStep } from "./catalog-sync";
import { catalogSyncRequested, inngest, listingOptimizeRequested, listingsItemChanged, newListingRequested, proposalDecided } from "./client";
import { workflowDeps } from "./deps";
import { approvedListingsToSubmit, draftNewListing, failNewListingSubmission, runIdFor, submitNewListing, trackNewListing } from "./new-listing";
import { OPTIMIZER_STOPPED, optimizeListingRun } from "./optimize-listing";

/**
 * Failures a retry won't fix: the account is gone, the seller never authorized the app or revoked it
 * (LWA's invalid_grant), the app's credentials are wrong, or the sealed token won't open.
 */
export function isPermanentFailure(error: unknown): boolean {
  if (error instanceof LwaError) return error.code === "invalid_grant" || error.code === "invalid_client";
  return (
    error instanceof CatalogSyncError ||
    error instanceof MissingRefreshTokenError ||
    error instanceof TokenCryptoError ||
    // A refused write stays refused: a member may not act, or the proposal isn't approved.
    error instanceof AgentRunError ||
    error instanceof ProposalWriteError ||
    error instanceof ProposalNotApprovedError
  );
}

/** Retries a step, unless its failure is permanent. Step results come back through JSON. */
function permanentFailuresStop(step: { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> }): RunStep {
  return (name, fn) =>
    step.run(name, () =>
      fn().catch((error: unknown) => {
        throw isPermanentFailure(error) ? new NonRetriableError(error instanceof Error ? error.message : String(error), { cause: error }) : error;
      }),
    ) as never;
}

/** Every night at 03:00 UTC: one catalog sync per seller account with an Amazon authorization. */
export const nightlyCatalogSync = inngest.createFunction(
  { id: "nightly-catalog-sync", name: "Nightly catalog sync", triggers: [cron("TZ=UTC 0 3 * * *")] },
  async ({ step }) => {
    const sellerAccountIds = await step.run("list authorized accounts", () => authorizedSellerAccountIds(workflowDeps()));
    if (sellerAccountIds.length > 0) {
      await step.sendEvent(
        "request a sync per account",
        sellerAccountIds.map((sellerAccountId) => catalogSyncRequested.create({ sellerAccountId })),
      );
    }
    return { accounts: sellerAccountIds.length };
  },
);

/** Imports one seller account's listings from Amazon, a step per page. One sync per account at a time. */
export const syncCatalog = inngest.createFunction(
  {
    id: "sync-catalog",
    name: "Sync catalog from Amazon",
    triggers: [catalogSyncRequested],
    concurrency: { key: "event.data.sellerAccountId", limit: 1 },
  },
  async ({ event, step }) => {
    // The sync's step results are JSON already, so their types hold.
    return syncSellerCatalog(workflowDeps(), event.data.sellerAccountId, permanentFailuresStop(step));
  },
);

/** Drafts a new listing from a New listing wizard brief and files it for approval (see draftNewListing). */
export const newListing = inngest.createFunction(
  {
    id: "new-listing",
    name: "New listing: draft",
    triggers: [newListingRequested],
    // Drafting stopped without saying why: say so on the run. A run that already finished stays as it is.
    onFailure: async ({ event }) => {
      const requestId = event.data.event.id;
      if (!requestId) return;
      await workflowDeps()
        .dataSource.failAgentRun({ runId: runIdFor(requestId), error: "The listing creator stopped unexpectedly before filing a draft. Nothing was sent to Amazon." })
        .catch((error: unknown) => {
          // The run was never started (a refused request): there is nothing to stop.
          if (!(error instanceof AgentRunError && error.code === "not_found")) throw error;
        });
    },
  },
  async ({ event, step }) => {
    return draftNewListing(
      workflowDeps(),
      { requestId: event.id, sellerAccountId: event.data.sellerAccountId, memberId: event.data.memberId, brief: event.data.brief },
      { run: permanentFailuresStop(step), sendEvent: (name, events) => step.sendEvent(name, events) },
    );
  },
);

/**
 * Submits a new listing to Amazon once it is approved (see submitNewListing). One at a time per
 * proposal, so a repeated decision finds it submitted and does nothing.
 */
export const submitApprovedNewListing = inngest.createFunction(
  {
    id: "submit-new-listing",
    name: "New listing: submit",
    triggers: [proposalDecided],
    concurrency: { key: "event.data.proposalId", limit: 1 },
    // Submitting gave up: the proposal fails with why, rather than staying approved with nothing on Amazon.
    onFailure: async ({ event, error }) => {
      await failNewListingSubmission(workflowDeps(), event.data.event.data.proposalId, error.message);
    },
  },
  async ({ event, step }) => {
    if (event.data.status !== "approved") return { outcome: "skipped", reason: `It was ${event.data.status}.` };
    return submitNewListing(workflowDeps(), event.data.proposalId, permanentFailuresStop(step));
  },
);

/** Brings a submitted new listing up to date on each of Amazon's notifications about it (see trackNewListing). */
export const trackListingChange = inngest.createFunction(
  {
    id: "track-new-listing",
    name: "New listing: follow on Amazon",
    triggers: [listingsItemChanged],
    // In order per listing, so an older answer never overwrites a newer one.
    concurrency: { key: "event.data.sku", limit: 1 },
  },
  async ({ event, step }) => trackNewListing(workflowDeps(), event.data, permanentFailuresStop(step)),
);

/** Every night: approved new listings whose decision never reached Inngest are announced again. */
export const sweepApprovedNewListings = inngest.createFunction(
  { id: "sweep-approved-new-listings", name: "New listing: submit approved stragglers", triggers: [cron("TZ=UTC 30 3 * * *")] },
  async ({ step }) => {
    const proposalIds = await step.run("find approved listings not submitted", () => approvedListingsToSubmit(workflowDeps()));
    if (proposalIds.length > 0) {
      await step.sendEvent(
        "announce them again",
        proposalIds.map((proposalId) => proposalDecided.create({ proposalId, status: "approved" })),
      );
    }
    return { proposals: proposalIds.length };
  },
);

/**
 * Optimizes a product's listing on the run a member started: optimizer, rules check and reviewer,
 * up to three rounds, then a proposal (see optimizeListingRun). One run per product at a time.
 */
export const optimizeListing = inngest.createFunction(
  {
    id: "optimize-listing",
    name: "Listing optimizer",
    triggers: [listingOptimizeRequested],
    concurrency: { key: "event.data.productId", limit: 1 },
    // It gave up: say so on the run, so the product page doesn't wait on it. A run that finished stays as it is.
    onFailure: async ({ event }) => {
      await workflowDeps().dataSource.failAgentRun({ runId: event.data.event.data.runId, error: OPTIMIZER_STOPPED });
    },
  },
  async ({ event, step }) => optimizeListingRun(workflowDeps(), event.data, { run: permanentFailuresStop(step) }),
);

/** Every Inngest function, for the serve handler. */
export const functions = [nightlyCatalogSync, syncCatalog, newListing, submitApprovedNewListing, trackListingChange, sweepApprovedNewListings, optimizeListing];
