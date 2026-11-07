import { openToken, sealToken } from "./token-crypto";

/** Where refresh tokens rest, keyed by seller id. It only ever sees sealed tokens. */
export interface RefreshTokenStore {
  get(sellerId: string): Promise<string | undefined>;
  set(sellerId: string, sealed: string): Promise<void>;
}

/** An in-process store, for tests and local runs. */
export function createMemoryRefreshTokenStore(): RefreshTokenStore {
  const sealed = new Map<string, string>();
  return {
    get: async (sellerId) => sealed.get(sellerId),
    set: async (sellerId, value) => {
      sealed.set(sellerId, value);
    },
  };
}

/** Thrown when a seller has no refresh token on file. */
export class MissingRefreshTokenError extends Error {
  override name = "MissingRefreshTokenError";
  constructor() {
    super("This seller account has no Amazon authorization on file. Reconnect it.");
  }
}

/** Seals refresh tokens on the way into the store and opens them on the way out. */
export type RefreshTokenVault = {
  save(sellerId: string, refreshToken: string): Promise<void>;
  load(sellerId: string): Promise<string>;
};

export function createRefreshTokenVault(store: RefreshTokenStore, key: Buffer): RefreshTokenVault {
  return {
    save: (sellerId, refreshToken) => store.set(sellerId, sealToken(refreshToken, key, sellerId)),
    async load(sellerId) {
      const sealed = await store.get(sellerId);
      if (!sealed) throw new MissingRefreshTokenError();
      return openToken(sealed, key, sellerId);
    },
  };
}
