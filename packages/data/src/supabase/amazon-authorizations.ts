import { SupabaseDataError, type AppSupabaseClient } from "./supabase-data-source";

/**
 * Sealed Amazon refresh tokens by seller id, in amazon_authorizations: the shape of packages/amazon's
 * RefreshTokenStore, plus which sellers have one. It never sees an unsealed token.
 */
export type AmazonAuthorizationStore = {
  get(sellerId: string): Promise<string | undefined>;
  set(sellerId: string, sealed: string): Promise<void>;
  /** Sellers with a token on file. */
  sellerIds(): Promise<string[]>;
};

/** Needs a client with the secret key: the table has no policies, so members can't reach it. */
export function createSupabaseAmazonAuthorizationStore(admin: AppSupabaseClient, now: () => Date = () => new Date()): AmazonAuthorizationStore {
  const fail = (error: { code: string; message: string }) => new SupabaseDataError(error.code, error.message);
  return {
    async get(sellerId) {
      const { data, error } = await admin.from("amazon_authorizations").select("refresh_token_sealed").eq("seller_id", sellerId).maybeSingle();
      if (error) throw fail(error);
      return data?.refresh_token_sealed;
    },
    async set(sellerId, sealed) {
      const { error } = await admin
        .from("amazon_authorizations")
        .upsert({ seller_id: sellerId, refresh_token_sealed: sealed, updated_at: now().toISOString() });
      if (error) throw fail(error);
    },
    async sellerIds() {
      // One row per seller, and a workspace connects a handful: no paging needed.
      const { data, error } = await admin.from("amazon_authorizations").select("seller_id").order("seller_id");
      if (error) throw fail(error);
      return data.map((row) => row.seller_id);
    },
  };
}
