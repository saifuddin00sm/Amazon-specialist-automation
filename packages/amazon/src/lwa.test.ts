import { describe, expect, it } from "vitest";
import { LWA_TOKEN_URL } from "./endpoints";
import type { Fetch } from "./http";
import { createAccessTokenProvider, exchangeRefreshToken, LwaError } from "./lwa";
import { createMemoryRefreshTokenStore, createRefreshTokenVault } from "./refresh-tokens";
import { fakeClock, json, lwaTokenResponse, recordingLogger, type RecordedRequest } from "./test-support";
import { generateEncryptionKey, parseEncryptionKey } from "./token-crypto";
import { USER_AGENT } from "./user-agent";

const credentials = { clientId: "amzn1.application-oa2-client.example", clientSecret: "client-secret" };
const sellerId = "A1SELLER000001";

function lwa(...responses: Response[]) {
  const requests: RecordedRequest[] = [];
  const fetch: Fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body) });
    return responses.shift() ?? lwaTokenResponse();
  };
  return { fetch, requests };
}

async function vaultWith(refreshToken: string) {
  const store = createMemoryRefreshTokenStore();
  const vault = createRefreshTokenVault(store, parseEncryptionKey(generateEncryptionKey()));
  await vault.save(sellerId, refreshToken);
  return { store, vault };
}

describe("LWA refresh-token exchange", () => {
  it("posts the refresh token grant with the app's user agent, and logs it without secrets", async () => {
    const { fetch, requests } = lwa();
    const { logger, entries } = recordingLogger();
    const { clock } = fakeClock();
    const exchange = await exchangeRefreshToken("Atzr|refresh-1", credentials, { fetch, logger, clock });

    expect(exchange).toEqual({ accessToken: "Atza|access-1", refreshToken: "Atzr|refresh-1", expiresAt: clock.now() + 3_600_000 });
    const [request] = requests;
    expect(request!.url.href).toBe(LWA_TOKEN_URL);
    expect(request!.method).toBe("POST");
    expect(request!.headers.get("user-agent")).toBe(USER_AGENT);
    expect(Object.fromEntries(new URLSearchParams(request!.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "Atzr|refresh-1",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    expect(entries).toEqual([
      { service: "lwa", operation: "refreshToken", method: "POST", status: 200, attempt: 1, durationMs: 0, userAgent: USER_AGENT, requestId: "request-1" },
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/Atz[ar]\||client-secret/);
  });

  it("reports LWA's refusal", async () => {
    const { fetch } = lwa(json(400, { error: "invalid_grant", error_description: "The request has an invalid grant parameter" }));
    const refusal = exchangeRefreshToken("Atzr|revoked", credentials, { fetch, logger: () => {} });
    await expect(refusal).rejects.toThrow(LwaError);
    await expect(refusal).rejects.toMatchObject({ status: 400, code: "invalid_grant" });
  });
});

describe("access token provider", () => {
  it("exchanges once and reuses the token until shortly before it expires", async () => {
    const { fetch, requests } = lwa(lwaTokenResponse("Atza|first"), lwaTokenResponse("Atza|second"));
    const { clock, advance } = fakeClock();
    const { vault } = await vaultWith("Atzr|refresh-1");
    const tokens = createAccessTokenProvider(vault, credentials, { fetch, logger: () => {}, clock });

    expect(await tokens.get(sellerId)).toBe("Atza|first");
    advance(58 * 60_000);
    expect(await tokens.get(sellerId)).toBe("Atza|first");
    advance(60_000);
    expect(await tokens.get(sellerId)).toBe("Atza|second");
    expect(requests).toHaveLength(2);
  });

  it("shares one exchange between concurrent callers", async () => {
    const { fetch, requests } = lwa();
    const { vault } = await vaultWith("Atzr|refresh-1");
    const tokens = createAccessTokenProvider(vault, credentials, { fetch, logger: () => {}, clock: fakeClock().clock });
    await Promise.all([tokens.get(sellerId), tokens.get(sellerId), tokens.get(sellerId)]);
    expect(requests).toHaveLength(1);
  });

  it("seals a rotated refresh token back into the store", async () => {
    const { fetch } = lwa(lwaTokenResponse("Atza|first", "Atzr|rotated"));
    const { store, vault } = await vaultWith("Atzr|refresh-1");
    const tokens = createAccessTokenProvider(vault, credentials, { fetch, logger: () => {}, clock: fakeClock().clock });
    await tokens.get(sellerId);
    expect(await vault.load(sellerId)).toBe("Atzr|rotated");
    expect(await store.get(sellerId)).not.toContain("Atzr|rotated");
  });

  it("exchanges again after the token is invalidated", async () => {
    const { fetch, requests } = lwa();
    const { vault } = await vaultWith("Atzr|refresh-1");
    const tokens = createAccessTokenProvider(vault, credentials, { fetch, logger: () => {}, clock: fakeClock().clock });
    await tokens.get(sellerId);
    tokens.invalidate(sellerId);
    await tokens.get(sellerId);
    expect(requests).toHaveLength(2);
  });
});
