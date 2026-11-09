import { LwaError, MissingRefreshTokenError, TokenCryptoError } from "@app/amazon";
import { CatalogSyncError } from "@app/data";
import { NonRetriableError, cron } from "inngest";
import { authorizedSellerAccountIds, syncSellerCatalog, type RunStep } from "./catalog-sync";
import { catalogSyncRequested, inngest } from "./client";
import { workflowDeps } from "./deps";

/**
 * Failures a retry won't fix: the account is gone, the seller never authorized the app or revoked it
 * (LWA's invalid_grant), the app's credentials are wrong, or the sealed token won't open.
 */
export function isPermanentFailure(error: unknown): boolean {
  if (error instanceof LwaError) return error.code === "invalid_grant" || error.code === "invalid_client";
  return error instanceof CatalogSyncError || error instanceof MissingRefreshTokenError || error instanceof TokenCryptoError;
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
    // Step results come back through JSON. The sync's are JSON already, so their types hold.
    const run: RunStep = (name, fn) =>
      step.run(name, () =>
        fn().catch((error: unknown) => {
          throw isPermanentFailure(error) ? new NonRetriableError(error instanceof Error ? error.message : String(error), { cause: error }) : error;
        }),
      ) as never;
    return syncSellerCatalog(workflowDeps(), event.data.sellerAccountId, run);
  },
);

/** Every Inngest function, for the serve handler. */
export const functions = [nightlyCatalogSync, syncCatalog];
