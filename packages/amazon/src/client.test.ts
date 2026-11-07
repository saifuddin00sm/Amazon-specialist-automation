import { describe, expect, it } from "vitest";
import { createSpApiClient } from "./client";
import { spApiEndpoint, type AmazonEnvironment } from "./endpoints";
import sandbox from "./fixtures/sandbox-responses.json";
import { ProposalNotApprovedError } from "./listings-items";
import { createAccessTokenProvider } from "./lwa";
import { createMemoryRefreshTokenStore, createRefreshTokenVault } from "./refresh-tokens";
import { SpApiError } from "./sp-api";
import { fakeAmazon, fakeClock, json, recordingLogger, type RecordedRequest } from "./test-support";
import { generateEncryptionKey, parseEncryptionKey } from "./token-crypto";
import { USER_AGENT } from "./user-agent";

const sellerId = "A1SELLER000001";
const US = "ATVPDKIKX0DER";
const CA = "A2EUQ1WTGCTBG2";
const patchBody = {
  productType: "LUGGAGE",
  patches: [{ op: "replace" as const, path: "/attributes/item_name", value: [{ value: "Hardside Carry-On Spinner", marketplace_id: US }] }],
};

/** Answers with Amazon's own sandbox examples, by operation. */
function sandboxExamples(request: RecordedRequest): Response {
  const { pathname } = request.url;
  if (pathname.startsWith("/listings/2021-08-01/items/")) {
    const segments = pathname.split("/").length;
    if (segments === 5) return json(200, sandbox.searchListingsItems_200_0);
    if (request.method === "PATCH") {
      const sku = decodeURIComponent(pathname.split("/").at(-1)!);
      if (sku === "VALIDATION_VALID") return json(200, sandbox.patchListingsItem_200_1);
      if (sku === "VALIDATION_INVALID") return json(200, sandbox.patchListingsItem_200_2);
      return json(200, sandbox.patchListingsItem_200_0);
    }
    return json(200, sandbox.getListingsItem_200_0);
  }
  if (pathname === "/definitions/2020-09-01/productTypes") return json(200, sandbox.searchDefinitionsProductTypes_200_0);
  if (pathname.startsWith("/definitions/2020-09-01/productTypes/")) return json(200, sandbox.getDefinitionsProductType_200_0);
  return json(404, { errors: [{ code: "NotFound", message: "No such operation" }] });
}

async function setup(handler: (request: RecordedRequest) => Response = sandboxExamples, environment: AmazonEnvironment = "sandbox") {
  const amazon = fakeAmazon(handler);
  const { clock, sleeps } = fakeClock();
  const { logger, entries } = recordingLogger();
  const vault = createRefreshTokenVault(createMemoryRefreshTokenStore(), parseEncryptionKey(generateEncryptionKey()));
  await vault.save(sellerId, "Atzr|refresh-1");
  const accessTokens = createAccessTokenProvider(vault, { clientId: "client", clientSecret: "secret" }, { fetch: amazon.fetch, logger, clock });
  const client = createSpApiClient({ region: "na", environment, accessTokens, fetch: amazon.fetch, logger, clock, random: () => 1 });
  return { client, amazon, entries, sleeps };
}

describe("SP-API client", () => {
  it("reads Amazon's sandbox examples into typed results", async () => {
    const { client } = await setup();
    const item = await client.getListingsItem({ sellerId, sku: "GM-ZDPI-9B4E", marketplaceIds: [US], includedData: ["summaries", "offers"] });
    expect(item.sku).toBe("GM-ZDPI-9B4E");
    expect(item.summaries?.[0]?.asin).toBe("B071VG5N9D");

    const search = await client.searchListingsItems({ sellerId, marketplaceIds: [US], identifiersType: "SKU", identifiers: ["GM-ZDPI-9B4E"] });
    expect(search.numberOfResults).toBe(3);
    expect(search.pagination?.nextToken).toBeDefined();

    const productTypes = await client.searchDefinitionsProductTypes({ sellerId, marketplaceIds: [US], keywords: ["luggage"] });
    expect(productTypes.productTypes.map((productType) => productType.name)).toEqual(["LUGGAGE"]);

    const definition = await client.getDefinitionsProductType({ sellerId, productType: "LUGGAGE", marketplaceIds: [US] });
    expect(definition.requirements).toBe("LISTING");
    expect(definition.propertyGroups.product_identity?.propertyNames).toContain("item_name");
  });

  it("sets the user agent and access token on every request, and logs each one", async () => {
    const { client, amazon, entries } = await setup();
    await client.getListingsItem({ sellerId, sku: "GM-ZDPI-9B4E", marketplaceIds: [US] });
    await client.searchDefinitionsProductTypes({ sellerId, marketplaceIds: [US] });

    expect(amazon.requests).toHaveLength(3);
    for (const request of amazon.requests) expect(request.headers.get("user-agent")).toBe(USER_AGENT);
    for (const request of amazon.spApiRequests()) expect(request.headers.get("x-amz-access-token")).toBe("Atza|access-1");
    expect(entries.map((entry) => [entry.service, entry.operation, entry.status, entry.userAgent])).toEqual([
      ["lwa", "refreshToken", 200, USER_AGENT],
      ["sp-api", "getListingsItem", 200, USER_AGENT],
      ["sp-api", "searchDefinitionsProductTypes", 200, USER_AGENT],
    ]);
  });

  it("logs no tokens and no seller data", async () => {
    const { client, entries } = await setup();
    await client.getListingsItem({ sellerId, sku: "GM-ZDPI-9B4E", marketplaceIds: [US] });
    expect(JSON.stringify(entries)).not.toMatch(/Atz[ar]\||secret|A1SELLER000001|GM-ZDPI-9B4E/);
  });

  it("calls the sandbox unless told production", async () => {
    const sandboxed = await setup();
    await sandboxed.client.searchDefinitionsProductTypes({ sellerId, marketplaceIds: [US] });
    expect(sandboxed.amazon.spApiRequests()[0]!.url.origin).toBe("https://sandbox.sellingpartnerapi-na.amazon.com");

    const production = await setup(sandboxExamples, "production");
    await production.client.searchDefinitionsProductTypes({ sellerId, marketplaceIds: [US] });
    expect(production.amazon.spApiRequests()[0]!.url.origin).toBe(spApiEndpoint("na", "production"));
  });

  it("sends lists comma-separated and escapes path segments", async () => {
    const { client, amazon } = await setup();
    await client.searchListingsItems({ sellerId, marketplaceIds: [US, CA], includedData: ["summaries", "issues"], pageSize: 1 });
    await client.getListingsItem({ sellerId, sku: "BOX/12 #3", marketplaceIds: [US] });
    const [search, get] = amazon.spApiRequests();
    expect(search!.url.pathname).toBe(`/listings/2021-08-01/items/${sellerId}`);
    expect(search!.url.search).toBe(`?marketplaceIds=${US},${CA}&includedData=summaries,issues&pageSize=1`);
    expect(get!.url.pathname).toBe(`/listings/2021-08-01/items/${sellerId}/BOX%2F12%20%233`);
  });

  it("backs off exponentially on 429, then succeeds", async () => {
    let throttles = 2;
    const { client, entries, sleeps } = await setup((request) =>
      throttles-- > 0 ? json(429, { errors: [{ code: "QuotaExceeded", message: "You exceeded your quota for the requested resource." }] }) : sandboxExamples(request),
    );
    const definition = await client.getDefinitionsProductType({ sellerId, productType: "LUGGAGE", marketplaceIds: [US] });
    expect(definition.productType).toBe("LUGGAGE");
    expect(entries.filter((entry) => entry.service === "sp-api").map((entry) => [entry.attempt, entry.status])).toEqual([
      [1, 429],
      [2, 429],
      [3, 200],
    ]);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("gives up after the last retry", async () => {
    const { client, entries } = await setup(() => json(429, { errors: [{ code: "QuotaExceeded", message: "You exceeded your quota." }] }));
    const call = client.getListingsItem({ sellerId, sku: "GM-ZDPI-9B4E", marketplaceIds: [US] });
    await expect(call).rejects.toThrow(SpApiError);
    await expect(call).rejects.toMatchObject({ status: 429, errors: [{ code: "QuotaExceeded" }] });
    expect(entries.filter((entry) => entry.service === "sp-api")).toHaveLength(6);
  });

  it("waits for the seller's bucket before calling", async () => {
    const { client, sleeps } = await setup();
    for (let call = 0; call < 6; call += 1) await client.searchListingsItems({ sellerId, marketplaceIds: [US] });
    // A burst of 5, then one every 200ms.
    expect(sleeps).toEqual([200]);
  });

  it("reports Amazon's errors with the request id", async () => {
    const { client } = await setup(() => json(400, sandbox.getListingsItem_400_0, { "x-amzn-RequestId": "request-400" }));
    await expect(client.getListingsItem({ sellerId, sku: "BadSKU", marketplaceIds: [US] })).rejects.toMatchObject({
      name: "SpApiError",
      operation: "getListingsItem",
      status: 400,
      requestId: "request-400",
      errors: [{ code: "BAD_REQUEST" }],
    });
  });

  it("refuses a response that doesn't match the model", async () => {
    const { client } = await setup(() => json(200, { productTypes: "LUGGAGE" }));
    await expect(client.searchDefinitionsProductTypes({ sellerId, marketplaceIds: [US] })).rejects.toMatchObject({
      errors: [{ code: "UnexpectedResponse" }],
    });
  });
});

describe("patchListingsItem", () => {
  it("writes for an approved proposal", async () => {
    const { client, amazon } = await setup();
    const submission = await client.patchListingsItem({
      sellerId,
      sku: "GM-ZDPI-9B4E",
      marketplaceIds: [US],
      body: patchBody,
      proposal: { id: "proposal-1", status: "approved" },
    });
    expect(submission.status).toBe("ACCEPTED");
    const [patch] = amazon.spApiRequests();
    expect(patch!.method).toBe("PATCH");
    expect(patch!.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(patch!.body!)).toEqual(patchBody);
  });

  it("refuses, without calling Amazon, unless the proposal is approved", async () => {
    const { client, amazon } = await setup();
    for (const status of ["pending_approval", "rejected", "applied", "failed", "superseded"] as const) {
      const write = client.patchListingsItem({ sellerId, sku: "GM-ZDPI-9B4E", marketplaceIds: [US], body: patchBody, proposal: { id: "proposal-1", status } });
      await expect(write).rejects.toThrow(ProposalNotApprovedError);
    }
    await expect(
      client.patchListingsItem({ sellerId, sku: "GM-ZDPI-9B4E", marketplaceIds: [US], body: patchBody, proposal: { id: "proposal-1", status: "pending_approval" } }),
    ).rejects.toThrow("Only approved proposals can be published. This one is still pending approval.");
    expect(amazon.requests).toEqual([]);
  });

  it("validates a draft with VALIDATION_PREVIEW without a proposal", async () => {
    const { client, amazon } = await setup();
    const preview = await client.patchListingsItem({
      sellerId,
      sku: "VALIDATION_INVALID",
      marketplaceIds: [US],
      body: patchBody,
      mode: "VALIDATION_PREVIEW",
      includedData: ["identifiers", "issues"],
    });
    expect(preview.status).toBe("INVALID");
    expect(preview.issues?.[0]?.attributeNames).toEqual(["fake_attribute"]);
    expect(amazon.spApiRequests()[0]!.url.searchParams.get("mode")).toBe("VALIDATION_PREVIEW");
  });
});
