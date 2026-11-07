import { z } from "zod";
import { LWA_TOKEN_URL } from "./endpoints";
import { amazonFetch, consoleLogger, type AmazonLogger, type Fetch } from "./http";
import { systemClock, type Clock } from "./rate-limit";
import type { RefreshTokenVault } from "./refresh-tokens";

/** The app's Login with Amazon client, from Seller Central's developer console. */
export type LwaCredentials = { clientId: string; clientSecret: string };

/** From AMAZON_LWA_CLIENT_ID and AMAZON_LWA_CLIENT_SECRET, when both are set. */
export function lwaCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): LwaCredentials | undefined {
  const { AMAZON_LWA_CLIENT_ID: clientId, AMAZON_LWA_CLIENT_SECRET: clientSecret } = env;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
});

const TokenErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

/** LWA refused the exchange, e.g. invalid_grant when the seller revoked the app. */
export class LwaError extends Error {
  override name = "LwaError";
  constructor(
    readonly status: number,
    readonly code: string,
    description?: string,
  ) {
    super(`Login with Amazon refused the token exchange (${status} ${code})${description ? `: ${description}` : ""}`);
  }
}

export type LwaExchange = { accessToken: string; refreshToken: string; expiresAt: number };

export type LwaOptions = { fetch?: Fetch; logger?: AmazonLogger; clock?: Clock };

/** Trades a seller's refresh token for an access token, good for about an hour. */
export async function exchangeRefreshToken(refreshToken: string, credentials: LwaCredentials, options: LwaOptions = {}): Promise<LwaExchange> {
  const { fetch = globalThis.fetch, logger = consoleLogger, clock = systemClock } = options;
  const response = await amazonFetch(
    {
      service: "lwa",
      operation: "refreshToken",
      attempt: 1,
      url: LWA_TOKEN_URL,
      init: {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }).toString(),
      },
    },
    fetch,
    logger,
    () => clock.now(),
  );
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = TokenErrorSchema.safeParse(body);
    throw new LwaError(response.status, error.success ? error.data.error : "unknown_error", error.data?.error_description);
  }
  const token = TokenResponseSchema.safeParse(body);
  if (!token.success) throw new LwaError(response.status, "malformed_response");
  return {
    accessToken: token.data.access_token,
    refreshToken: token.data.refresh_token ?? refreshToken,
    expiresAt: clock.now() + token.data.expires_in * 1000,
  };
}

/** Hands out a seller's access token, exchanging their refresh token only when needed. */
export type AccessTokenProvider = {
  get(sellerId: string): Promise<string>;
  /** Forgets the cached token, e.g. after Amazon rejected it. */
  invalidate(sellerId: string): void;
};

/** Access tokens are treated as expired this long before LWA says, so none expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Access tokens live only in memory. Refresh tokens come out of the vault (sealed at rest) for the
 * exchange; when LWA hands back a different one, it goes back in sealed.
 */
export function createAccessTokenProvider(vault: RefreshTokenVault, credentials: LwaCredentials, options: LwaOptions = {}): AccessTokenProvider {
  const clock = options.clock ?? systemClock;
  const cached = new Map<string, { token: string; expiresAt: number }>();
  const pending = new Map<string, Promise<string>>();

  const refresh = async (sellerId: string) => {
    const refreshToken = await vault.load(sellerId);
    const exchange = await exchangeRefreshToken(refreshToken, credentials, options);
    if (exchange.refreshToken !== refreshToken) await vault.save(sellerId, exchange.refreshToken);
    cached.set(sellerId, { token: exchange.accessToken, expiresAt: exchange.expiresAt - EXPIRY_MARGIN_MS });
    return exchange.accessToken;
  };

  return {
    async get(sellerId) {
      const hit = cached.get(sellerId);
      if (hit && hit.expiresAt > clock.now()) return hit.token;
      // Concurrent callers share one exchange.
      let exchange = pending.get(sellerId);
      if (!exchange) {
        exchange = refresh(sellerId).finally(() => pending.delete(sellerId));
        pending.set(sellerId, exchange);
      }
      return exchange;
    },
    invalidate(sellerId) {
      cached.delete(sellerId);
    },
  };
}
