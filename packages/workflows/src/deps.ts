import {
  amazonEnvironment,
  createAccessTokenProvider,
  createRateLimiter,
  createRefreshTokenVault,
  createSpApiClient,
  encryptionKeyFromEnv,
  lwaCredentialsFromEnv,
  type RefreshTokenStore,
  type SpApiClient,
  type SpApiClientOptions,
  type SpApiRegion,
} from "@app/amazon";
import {
  createSupabaseAmazonAuthorizationStore,
  createSupabaseDataSource,
  getMockDataSource,
  type AmazonAuthorizationStore,
  type DataSource,
  type Database,
} from "@app/data";
import { createClient } from "@supabase/supabase-js";

/** What the workflows work with; tests and scripts supply their own. */
export type WorkflowDeps = {
  /** Trusted backend access: it acts with the secret key, not as a member. */
  dataSource: DataSource;
  authorizations: AmazonAuthorizationStore;
  /** The SP-API client for one region. */
  amazon(region: SpApiRegion): Pick<SpApiClient, "searchListingsItems">;
  now(): Date;
};

/**
 * SP-API clients, one per region, sharing one access token provider and one rate limiter so every
 * call for a seller draws from the same buckets. Needs AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET
 * and AMAZON_TOKEN_ENCRYPTION_KEY, read on first use.
 */
export function amazonClients(store: RefreshTokenStore, env: NodeJS.ProcessEnv = process.env): (region: SpApiRegion) => SpApiClient {
  let shared: Omit<SpApiClientOptions, "region"> | undefined;
  const clients = new Map<SpApiRegion, SpApiClient>();
  return (region) => {
    if (!shared) {
      const credentials = lwaCredentialsFromEnv(env);
      if (!credentials) throw new Error("Set AMAZON_LWA_CLIENT_ID and AMAZON_LWA_CLIENT_SECRET to reach Amazon.");
      const vault = createRefreshTokenVault(store, encryptionKeyFromEnv(env));
      shared = { accessTokens: createAccessTokenProvider(vault, credentials), limiter: createRateLimiter(), environment: amazonEnvironment(env) };
    }
    let client = clients.get(region);
    if (!client) clients.set(region, (client = createSpApiClient({ region, ...shared })));
    return client;
  };
}

/** The mock dataset's accounts were never authorized by Amazon. */
const NO_AUTHORIZATIONS: AmazonAuthorizationStore = {
  get: async () => undefined,
  set: async () => {
    throw new Error("Amazon authorizations are kept in Supabase. Set DATA_SOURCE=supabase.");
  },
  sellerIds: async () => [],
};

/**
 * From the environment, like the web app. DATA_SOURCE=supabase works on SUPABASE_URL with
 * SUPABASE_SECRET_KEY, where Amazon authorizations are kept too; mock (the default) works on the
 * in-memory dataset, which has none, so there is nothing to sync.
 */
export function workflowDepsFromEnv(env: NodeJS.ProcessEnv = process.env): WorkflowDeps {
  if (env.DATA_SOURCE !== "supabase") {
    return { dataSource: getMockDataSource(), authorizations: NO_AUTHORIZATIONS, amazon: amazonClients(NO_AUTHORIZATIONS, env), now: () => new Date() };
  }
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey } = env;
  if (!url || !secretKey) throw new Error("Background work with DATA_SOURCE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY.");
  const admin = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authorizations = createSupabaseAmazonAuthorizationStore(admin);
  return { dataSource: createSupabaseDataSource(admin), authorizations, amazon: amazonClients(authorizations, env), now: () => new Date() };
}

let deps: WorkflowDeps | undefined;

/** One set per process, so access tokens and rate limits carry across function runs. */
export function workflowDeps(): WorkflowDeps {
  deps ??= workflowDepsFromEnv();
  return deps;
}
