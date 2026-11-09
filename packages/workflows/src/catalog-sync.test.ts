import { LwaError, MissingRefreshTokenError, TokenCryptoError, type ListingsItem, type SearchListingsItemsInput } from "@app/amazon";
import { CatalogSyncError, createMockDataSource, generateMockDataset, type AmazonAuthorizationStore } from "@app/data";
import { describe, expect, it } from "vitest";
import { authorizedSellerAccountIds, syncSellerCatalog, type RunStep } from "./catalog-sync";
import type { WorkflowDeps } from "./deps";
import { isPermanentFailure } from "./functions";

const dataset = generateMockDataset();
const merchant = dataset.workspaces[0]!;
const owner = dataset.members.find((member) => member.workspaceId === merchant.id && member.role === "owner")!;
const sellerId = "A2TESTSELLER01";
const US = "ATVPDKIKX0DER";

/** A buyable US listing in the shape Amazon returns it. */
function item(sku: string, bullets = ["Holds 20 lb", "Machine washable"]): ListingsItem {
  const text = (value: string) => ({ value, language_tag: "en_US", marketplace_id: US });
  return {
    sku,
    summaries: [
      {
        marketplaceId: US,
        asin: `B0SYNC${sku.slice(-4)}`,
        productType: "TOTE_BAG",
        status: ["BUYABLE"],
        itemName: `Canvas Tote ${sku}`,
        createdDate: "2026-03-01T12:00:00Z",
        lastUpdatedDate: "2026-10-01T12:00:00Z",
      },
    ],
    attributes: { brand: [text("Fieldmade")], bullet_point: bullets.map(text) },
    offers: [{ marketplaceId: US, offerType: "B2C", price: { currencyCode: "USD", amount: "24.99" } }],
  };
}

/** A listing Amazon hasn't given an ASIN yet. */
function withoutAsin(listing: ListingsItem): ListingsItem {
  return { ...listing, summaries: listing.summaries?.map((summary) => ({ ...summary, asin: undefined })) };
}

/** Amazon serving `pages` in order, chained by page token; records each search. */
function fakeAmazon(pages: ListingsItem[][]) {
  const searches: SearchListingsItemsInput[] = [];
  const client = {
    async searchListingsItems(input: SearchListingsItemsInput) {
      searches.push(input);
      const index = input.pageToken ? Number(input.pageToken.slice("page-".length)) : 0;
      const next = index + 1 < pages.length ? `page-${index + 1}` : undefined;
      return { numberOfResults: pages.flat().length, items: pages[index] ?? [], ...(next ? { pagination: { nextToken: next } } : {}) };
    },
  };
  return { client, searches };
}

function memoryAuthorizations(): AmazonAuthorizationStore {
  const sealed = new Map<string, string>();
  return {
    get: async (id) => sealed.get(id),
    set: async (id, value) => void sealed.set(id, value),
    sellerIds: async () => [...sealed.keys()],
  };
}

async function setup(pages: ListingsItem[][]) {
  let clock = Date.parse("2026-11-09T03:00:00.000Z");
  const dataSource = createMockDataSource(dataset, { now: () => new Date(clock) });
  const authorizations = memoryAuthorizations();
  const account = await dataSource.connectSellerAccount({ workspaceId: merchant.id, memberId: owner.id, name: "Test seller", marketplace: "US", sellerId });
  await authorizations.set(sellerId, "v1.sealed");
  const amazon = fakeAmazon(pages);
  const deps: WorkflowDeps = { dataSource, authorizations, amazon: () => amazon.client, now: () => new Date(clock) };

  // Like Inngest: each step's result is kept as JSON and handed back from it.
  const steps: { name: string; output: string }[] = [];
  const run: RunStep = async (name, fn) => {
    const output = JSON.stringify(await fn());
    steps.push({ name, output });
    return JSON.parse(output);
  };
  return { dataSource, deps, account, amazon, steps, run, nextDay: () => (clock += 24 * 60 * 60 * 1000) };
}

describe("syncSellerCatalog", () => {
  it("imports every page into the catalog, a step each, and audits the sync", async () => {
    const { dataSource, deps, account, amazon, steps, run } = await setup([[item("SYNC-0001"), withoutAsin(item("SYNC-0002"))], [item("SYNC-0003", [])]]);

    const summary = await syncSellerCatalog(deps, account.id, run);

    expect(summary).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
      newVersions: 1,
      pages: 2,
      deactivated: 0,
      skipped: { "No ASIN yet": 1, "Imported without its copy: no bullet points": 1 },
    });
    expect(steps.map((step) => step.name)).toEqual(["start", "import page 1", "import page 2", "finish"]);
    expect(amazon.searches.map((search) => [search.sellerId, search.marketplaceIds, search.pageToken])).toEqual([
      [sellerId, [US], undefined],
      [sellerId, [US], "page-1"],
    ]);

    const products = await dataSource.listProducts({ sellerAccountId: account.id });
    expect(products.map((product) => [product.sku, product.title, product.status, product.price])).toEqual([
      ["SYNC-0001", "Canvas Tote SYNC-0001", "active", 24.99],
      ["SYNC-0003", "Canvas Tote SYNC-0003", "active", 24.99],
    ]);
    const [live] = await dataSource.listListingVersions(products[0]!.id);
    expect(live).toMatchObject({ status: "live", bullets: ["Holds 20 lb", "Machine washable"], createdBy: { type: "system" } });
    const [event] = await dataSource.listAuditEvents({ workspaceId: merchant.id, sellerAccountId: account.id, limit: 1 });
    expect(event).toMatchObject({ action: "catalog.synced", actor: { type: "system" }, metadata: { created: 2, deactivated: 0 } });
  });

  it("keeps listings and seller data out of the steps' results", async () => {
    const { deps, account, steps, run } = await setup([[item("SYNC-0001")]]);
    await syncSellerCatalog(deps, account.id, run);
    const outputs = steps.map((step) => step.output).join("\n");
    for (const secret of ["SYNC-0001", "Canvas Tote", "B0SYNC0001", "Holds 20 lb", "Fieldmade", sellerId]) expect(outputs).not.toContain(secret);
  });

  it("brings the catalog up to date the next night, deactivating what Amazon dropped", async () => {
    const first = await setup([[item("SYNC-0001"), item("SYNC-0002")]]);
    await syncSellerCatalog(first.deps, first.account.id, first.run);

    first.nextDay();
    const amazon = fakeAmazon([[item("SYNC-0001", ["Holds 25 lb", "Machine washable"])]]);
    const summary = await syncSellerCatalog({ ...first.deps, amazon: () => amazon.client }, first.account.id, first.run);

    expect(summary).toMatchObject({ created: 0, updated: 0, unchanged: 1, newVersions: 1, deactivated: 1 });
    const bySku = new Map((await first.dataSource.listProducts({ sellerAccountId: first.account.id })).map((product) => [product.sku, product]));
    expect(bySku.get("SYNC-0002")?.status).toBe("inactive");
    const versions = await first.dataSource.listListingVersions(bySku.get("SYNC-0001")!.id);
    expect(versions.map((version) => [version.version, version.status, version.bullets[0]])).toEqual([
      [2, "live", "Holds 25 lb"],
      [1, "superseded", "Holds 20 lb"],
    ]);
  });

  it("stops before reading Amazon when the seller never authorized the app", async () => {
    const { dataSource, deps, account, amazon, run } = await setup([[item("SYNC-0001")]]);
    const unauthorized = { ...deps, authorizations: memoryAuthorizations() };
    await expect(syncSellerCatalog(unauthorized, account.id, run)).rejects.toThrow(MissingRefreshTokenError);
    await expect(syncSellerCatalog(deps, "nope", run)).rejects.toMatchObject({ code: "not_found" });
    expect(amazon.searches).toEqual([]);
    expect(await dataSource.listProducts({ sellerAccountId: account.id })).toEqual([]);
  });
});

describe("authorizedSellerAccountIds", () => {
  it("lists the accounts whose seller has an authorization on file", async () => {
    const { deps, account } = await setup([]);
    expect(await authorizedSellerAccountIds(deps)).toEqual([account.id]);
  });
});

describe("isPermanentFailure", () => {
  it("stops retrying what a retry won't fix", () => {
    expect(isPermanentFailure(new LwaError(400, "invalid_grant"))).toBe(true);
    expect(isPermanentFailure(new MissingRefreshTokenError())).toBe(true);
    expect(isPermanentFailure(new CatalogSyncError("not_found", "Gone"))).toBe(true);
    expect(isPermanentFailure(new TokenCryptoError("Wrong key"))).toBe(true);
    expect(isPermanentFailure(new LwaError(503, "unknown_error"))).toBe(false);
    expect(isPermanentFailure(new Error("socket hang up"))).toBe(false);
  });
});
