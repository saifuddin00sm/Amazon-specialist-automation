import { MARKETPLACE_REGIONS, MissingRefreshTokenError, fetchCatalogPage } from "@app/amazon";
import { CatalogSyncError, type CatalogImportCounts } from "@app/data";
import type { WorkflowDeps } from "./deps";

/**
 * Runs one named step: Inngest's step.run, which retries it and keeps its result, or the function
 * itself in a script. Results must be JSON.
 */
export type RunStep = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** A page is 20 listings, so this stops at 10,000, well inside Inngest's limit on steps per run. */
export const CATALOG_SYNC_MAX_PAGES = 500;

export type CatalogSyncSummary = CatalogImportCounts & {
  pages: number;
  deactivated: number;
  /** Why listings, or their copy, were left out, with how many. */
  skipped: Record<string, number>;
};

/**
 * Syncs one seller account's catalog from Amazon: a step per page of listings, each imported as it
 * arrives, then a step that deactivates what Amazon no longer lists and audits the sync. Steps
 * return counts and page tokens, never listings, so no seller data lands in the workflow's state.
 * Only reads Amazon; a retried page imports the same listings again, changing nothing.
 */
export async function syncSellerCatalog(deps: WorkflowDeps, sellerAccountId: string, run: RunStep): Promise<CatalogSyncSummary> {
  const syncedAt = await run("start", async () => {
    const account = await sellerAccount(deps, sellerAccountId);
    if (!(await deps.authorizations.get(account.sellerId))) throw new MissingRefreshTokenError();
    return deps.now().toISOString();
  });

  const counts: CatalogImportCounts = { created: 0, updated: 0, unchanged: 0, newVersions: 0 };
  const skipped: Record<string, number> = {};
  let pages = 0;
  let pageToken: string | undefined;
  do {
    if (pages === CATALOG_SYNC_MAX_PAGES) {
      throw new Error(`Stopped after ${CATALOG_SYNC_MAX_PAGES} pages without reaching the end; nothing was deactivated.`);
    }
    pages += 1;
    const token = pageToken;
    const page = await run(`import page ${pages}`, async () => {
      const account = await sellerAccount(deps, sellerAccountId);
      const catalog = await fetchCatalogPage(deps.amazon(MARKETPLACE_REGIONS[account.marketplace]), {
        sellerId: account.sellerId,
        marketplace: account.marketplace,
        pageToken: token,
      });
      const imported = await deps.dataSource.importCatalogListings({ sellerAccountId, syncedAt, listings: catalog.listings });
      // JSON has no undefined; null marks the last page.
      return { counts: imported, skipped: catalog.skipped, nextPageToken: catalog.nextPageToken ?? null };
    });
    for (const key of Object.keys(counts) as (keyof CatalogImportCounts)[]) counts[key] += page.counts[key];
    for (const [reason, count] of Object.entries(page.skipped)) skipped[reason] = (skipped[reason] ?? 0) + count;
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);

  const { deactivated } = await run("finish", () => deps.dataSource.finishCatalogSync({ sellerAccountId, syncedAt, counts, skipped }));
  return { ...counts, pages, deactivated, skipped };
}

/** Seller accounts whose seller has an Amazon authorization on file. */
export async function authorizedSellerAccountIds(deps: WorkflowDeps): Promise<string[]> {
  const sellers = new Set(await deps.authorizations.sellerIds());
  return (await deps.dataSource.listSellerAccounts()).filter((account) => sellers.has(account.sellerId)).map((account) => account.id);
}

async function sellerAccount(deps: WorkflowDeps, sellerAccountId: string) {
  const account = await deps.dataSource.getSellerAccount(sellerAccountId);
  if (!account) throw new CatalogSyncError("not_found", "That seller account no longer exists.");
  return account;
}
