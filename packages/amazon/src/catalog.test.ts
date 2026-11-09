import { describe, expect, it } from "vitest";
import { CATALOG_PAGE_SIZE, fetchCatalogPage, importListing } from "./catalog";
import { createSpApiClient } from "./client";
import sandbox from "./fixtures/sandbox-responses.json";
import type { ListingsItem } from "./listings-items";
import { createAccessTokenProvider } from "./lwa";
import { createMemoryRefreshTokenStore, createRefreshTokenVault } from "./refresh-tokens";
import { fakeAmazon, fakeClock, json, recordingLogger } from "./test-support";
import { generateEncryptionKey, parseEncryptionKey } from "./token-crypto";

const sellerId = "A1SELLER000001";
const US = "ATVPDKIKX0DER";
const CA = "A2EUQ1WTGCTBG2";

const text = (value: string, marketplace = US, language = "en_US") => ({ value, language_tag: language, marketplace_id: marketplace });

/** A buyable listing with its copy, in the shape Amazon returns attributes. */
function listing(overrides: Partial<ListingsItem> = {}): ListingsItem {
  return {
    sku: "MUG-001",
    summaries: [
      {
        marketplaceId: US,
        asin: "B0CERAMIC1",
        productType: "HOME_BED_AND_BATH",
        status: ["BUYABLE", "DISCOVERABLE"],
        itemName: "Stoneware Coffee Mug, 12 oz",
        createdDate: "2025-04-02T10:00:00Z",
        lastUpdatedDate: "2026-10-01T10:00:00Z",
      },
    ],
    attributes: {
      item_name: [text("Stoneware Coffee Mug, 12 oz")],
      brand: [text("Kilnworks")],
      bullet_point: [text("Holds 12 oz"), text("Contient 350 ml", US, "fr_CA"), text("Dishwasher safe"), text("Sells in Canada only", CA)],
      product_description: [text("A sturdy mug for every morning.")],
      generic_keyword: [text("cup ceramic"), text("tea")],
    },
    offers: [{ marketplaceId: US, offerType: "B2C", price: { currencyCode: "USD", amount: "18.50" } }],
    ...overrides,
  };
}

describe("importListing", () => {
  it("maps Amazon's sandbox example, suppressed by an enforcement without exemption", () => {
    const [item] = sandbox.searchListingsItems_200_0.items as ListingsItem[];
    const { listing: imported, skipped } = importListing(item!, US);
    expect(imported).toEqual({
      asin: "B071VG5N9D",
      sku: "GM-ZDPI-9B4E",
      title: "Hardside Carry-On Spinner Suitcase Luggage",
      brand: "Generic",
      category: "Luggage",
      price: 100,
      status: "suppressed",
      createdAt: "2021-02-01T00:00:00.000Z",
    });
    // The example has no attributes, so no bullet points: the product comes in without its copy.
    expect(skipped).toBe("Imported without its copy: no bullet points");
  });

  it("takes the copy in the marketplace and language of the title", () => {
    expect(importListing(listing(), US).listing).toEqual({
      asin: "B0CERAMIC1",
      sku: "MUG-001",
      title: "Stoneware Coffee Mug, 12 oz",
      brand: "Kilnworks",
      category: "Home bed and bath",
      price: 18.5,
      status: "active",
      createdAt: "2025-04-02T10:00:00.000Z",
      copy: {
        title: "Stoneware Coffee Mug, 12 oz",
        bullets: ["Holds 12 oz", "Dishwasher safe"],
        description: "A sturdy mug for every morning.",
        backendKeywords: "cup ceramic tea",
      },
    });
  });

  it("reads the price from the listing's offer attribute when there is no B2C offer", () => {
    const item = listing({ offers: [] });
    item.attributes!.purchasable_offer = [{ marketplace_id: US, currency: "USD", our_price: [{ schedule: [{ value_with_tax: 21.99 }] }] }];
    expect(importListing(item, US).listing?.price).toBe(21.99);
    expect(importListing(listing({ offers: [], attributes: {} }), US).listing?.price).toBe(0);
  });

  it("is inactive when neither buyable nor suppressed", () => {
    const [summary] = listing().summaries!;
    expect(importListing(listing({ summaries: [{ ...summary!, status: ["DISCOVERABLE"] }] }), US).listing?.status).toBe("inactive");
  });

  it("leaves out listings the catalog can't hold, saying why", () => {
    const [summary] = listing().summaries!;
    expect(importListing(listing(), CA)).toEqual({ skipped: "Not listed in this marketplace" });
    expect(importListing(listing({ summaries: [{ ...summary!, asin: undefined }] }), US)).toEqual({ skipped: "No ASIN yet" });
    expect(importListing(listing({ summaries: [{ ...summary!, asin: "0316769487" }] }), US)).toEqual({
      skipped: "ASIN isn't a B0 ASIN (a book's ISBN, say)",
    });
    expect(importListing(listing({ summaries: [{ ...summary!, itemName: undefined }], attributes: {} }), US)).toEqual({ skipped: "No title" });
  });

  it("imports the product without copy that breaks Amazon's limits", () => {
    const item = listing();
    item.attributes!.bullet_point = Array.from({ length: 7 }, (_, i) => text(`Bullet ${i + 1}`));
    const { listing: imported, skipped } = importListing(item, US);
    expect(imported?.sku).toBe("MUG-001");
    expect(imported?.copy).toBeUndefined();
    expect(skipped).toBe("Imported without its copy: more than 5 bullet points");
  });
});

describe("fetchCatalogPage", () => {
  async function client(handler: Parameters<typeof fakeAmazon>[0]) {
    const amazon = fakeAmazon(handler);
    const { clock } = fakeClock();
    const vault = createRefreshTokenVault(createMemoryRefreshTokenStore(), parseEncryptionKey(generateEncryptionKey()));
    await vault.save(sellerId, "Atzr|refresh-1");
    const { logger } = recordingLogger();
    const accessTokens = createAccessTokenProvider(vault, { clientId: "client", clientSecret: "secret" }, { fetch: amazon.fetch, logger, clock });
    return { amazon, client: createSpApiClient({ region: "na", environment: "sandbox", accessTokens, fetch: amazon.fetch, logger, clock }) };
  }

  it("asks for a full page of everything the catalog needs, and counts what it left out", async () => {
    const { amazon, client: sp } = await client(() =>
      json(200, { numberOfResults: 3, pagination: { nextToken: "page-2" }, items: [listing(), listing({ sku: "MUG-002", summaries: [] }), listing({ sku: "MUG-003", summaries: [] })] }),
    );
    const page = await fetchCatalogPage(sp, { sellerId, marketplace: "US" });

    const [request] = amazon.spApiRequests();
    expect(request!.url.pathname).toBe(`/listings/2021-08-01/items/${sellerId}`);
    expect(Object.fromEntries(request!.url.searchParams)).toEqual({
      marketplaceIds: US,
      includedData: "summaries,attributes,offers,issues",
      pageSize: String(CATALOG_PAGE_SIZE),
    });
    expect(page.listings.map((imported) => imported.sku)).toEqual(["MUG-001"]);
    expect(page.skipped).toEqual({ "Not listed in this marketplace": 2 });
    expect(page.nextPageToken).toBe("page-2");
  });

  it("passes the page token on, and has none after the last page", async () => {
    const { amazon, client: sp } = await client(() => json(200, { numberOfResults: 1, items: [listing()] }));
    const page = await fetchCatalogPage(sp, { sellerId, marketplace: "US", pageToken: "page-2" });
    expect(amazon.spApiRequests()[0]!.url.searchParams.get("pageToken")).toBe("page-2");
    expect(page).not.toHaveProperty("nextPageToken");
  });
});
