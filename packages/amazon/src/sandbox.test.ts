import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSpApiClient, type SpApiClient } from "./client";
import { MARKETPLACE_IDS } from "./endpoints";
import { consoleLogger, type AmazonRequestLog } from "./http";
import { ProposalNotApprovedError } from "./listings-items";
import { createAccessTokenProvider, lwaCredentialsFromEnv } from "./lwa";
import { createMemoryRefreshTokenStore, createRefreshTokenVault } from "./refresh-tokens";
import { SpApiError } from "./sp-api";
import { generateEncryptionKey, parseEncryptionKey } from "./token-crypto";
import { USER_AGENT } from "./user-agent";

/**
 * Calls Amazon's SP-API sandbox, which answers with the static examples in Amazon's models and
 * changes nothing. Needs an LWA app: AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET and a refresh
 * token from self-authorizing it, AMAZON_SANDBOX_REFRESH_TOKEN (see .env.example). Skips without
 * them; `pnpm test:sandbox` fails instead.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch {
  // No .env.local; the environment may still have the variables.
}

const credentials = lwaCredentialsFromEnv();
const refreshToken = process.env.AMAZON_SANDBOX_REFRESH_TOKEN;
const skip = !credentials || !refreshToken;

if (skip && process.env.npm_lifecycle_event === "test:sandbox") {
  throw new Error("No sandbox credentials. Set AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET and AMAZON_SANDBOX_REFRESH_TOKEN (packages/amazon/.env.local).");
}

// The sandbox matches requests against canned parameters, not the seller, so any merchant token does.
const sellerId = "A1SANDBOXSELLR";
const US = MARKETPLACE_IDS.US;
const patchBody = {
  productType: "LUGGAGE",
  patches: [{ op: "replace" as const, path: "/attributes/item_name", value: [{ value: "Hardside Carry-On Spinner", marketplace_id: US }] }],
};

describe.skipIf(skip)("SP-API sandbox", () => {
  const logs: AmazonRequestLog[] = [];
  let client: SpApiClient;

  beforeAll(async () => {
    const vault = createRefreshTokenVault(createMemoryRefreshTokenStore(), parseEncryptionKey(generateEncryptionKey()));
    await vault.save(sellerId, refreshToken!);
    const logger = (entry: AmazonRequestLog) => {
      logs.push(entry);
      consoleLogger(entry);
    };
    const accessTokens = createAccessTokenProvider(vault, credentials!, { logger });
    client = createSpApiClient({ region: "na", environment: "sandbox", accessTokens, logger });
  });

  afterAll(() => {
    // Done when every request, the LWA exchange included, logged the app's user agent.
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.filter((entry) => entry.service === "lwa")).not.toHaveLength(0);
    for (const entry of logs) expect(entry.userAgent).toBe(USER_AGENT);
  });

  it("getListingsItem", async () => {
    const item = await client.getListingsItem({ sellerId, sku: "GM-ZDPI-9B4E", marketplaceIds: [US] });
    expect(item.sku).toBeTruthy();
    expect(item.summaries?.length).toBeGreaterThan(0);
  });

  it("getListingsItem with a bad SKU", async () => {
    await expect(client.getListingsItem({ sellerId, sku: "BadSKU", marketplaceIds: [US] })).rejects.toMatchObject({
      name: SpApiError.name,
      status: 400,
    });
  });

  it("searchListingsItems", async () => {
    const result = await client.searchListingsItems({
      sellerId,
      identifiersType: "SKU",
      identifiers: ["GM-ZDPI-9B4E", "HW-ZDPI-9B4E", "TC-ZDPI-9B4E"],
      marketplaceIds: [US, MARKETPLACE_IDS.CA],
      includedData: ["summaries", "offers", "fulfillmentAvailability", "issues"],
      pageSize: 1,
    });
    expect(result.numberOfResults).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("patchListingsItem for an approved proposal", async () => {
    const submission = await client.patchListingsItem({
      sellerId,
      sku: "GM-ZDPI-9B4E",
      marketplaceIds: [US],
      body: patchBody,
      proposal: { id: "sandbox-proposal", status: "approved" },
    });
    expect(submission.status).toBe("ACCEPTED");
  });

  it("patchListingsItem refuses an unapproved proposal before calling Amazon", async () => {
    const before = logs.length;
    await expect(
      client.patchListingsItem({ sellerId, sku: "GM-ZDPI-9B4E", marketplaceIds: [US], body: patchBody, proposal: { id: "sandbox-proposal", status: "pending_approval" } }),
    ).rejects.toThrow(ProposalNotApprovedError);
    expect(logs).toHaveLength(before);
  });

  it("patchListingsItem validation preview", async () => {
    const preview = (sku: string) =>
      client.patchListingsItem({ sellerId, sku, marketplaceIds: [US], body: patchBody, mode: "VALIDATION_PREVIEW", includedData: ["identifiers", "issues"] });
    expect((await preview("VALIDATION_VALID")).status).toBe("VALID");
    const invalid = await preview("VALIDATION_INVALID");
    expect(invalid.status).toBe("INVALID");
    expect(invalid.issues?.length).toBeGreaterThan(0);
  });

  it("searchDefinitionsProductTypes", async () => {
    const result = await client.searchDefinitionsProductTypes({ sellerId, marketplaceIds: [US], keywords: ["luggage"] });
    expect(result.productTypes.length).toBeGreaterThan(0);
  });

  it("getDefinitionsProductType", async () => {
    const definition = await client.getDefinitionsProductType({ sellerId, productType: "LUGGAGE", marketplaceIds: [US] });
    expect(definition.productType).toBe("LUGGAGE");
    expect(definition.schema.link.resource).toBeTruthy();
  });
});
