import {
  amazonEnvironment,
  createAccessTokenProvider,
  createRateLimiter,
  createRefreshTokenVault,
  createSpApiClient,
  encryptionKeyFromEnv,
  loadProductTypeSchema,
  lwaCredentialsFromEnv,
  type JsonSchema,
  type ProductTypeDefinition,
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
import type { LlmProvider } from "@app/llm";
import { createClient } from "@supabase/supabase-js";
import { llmProvider } from "./llm";

/** What the workflows work with; tests and scripts supply their own. */
export type WorkflowDeps = {
  /** Trusted backend access: it acts with the secret key, not as a member. */
  dataSource: DataSource;
  authorizations: AmazonAuthorizationStore;
  /** The SP-API client for one region. */
  amazon(region: SpApiRegion): Pick<SpApiClient, "searchListingsItems">;
  now(): Date;
};

/** The SP-API operations the newListing workflow calls. */
export type NewListingAmazon = Pick<SpApiClient, "getListingsRestrictions" | "getDefinitionsProductType" | "putListingsItem" | "getListingsItem">;

/** What the newListing workflow works with, on top of the data and the clock. */
export type NewListingDeps = Pick<WorkflowDeps, "dataSource" | "authorizations" | "now"> & {
  amazon(region: SpApiRegion): NewListingAmazon;
  /** A product type's JSON schema, from its definition: downloaded and checksummed, or the sandbox's stand-in. */
  productTypeSchema(definition: ProductTypeDefinition): Promise<JsonSchema>;
  /** The model provider the workflow's LLM gateways call. */
  llm(): LlmProvider;
};

/** Everything every workflow needs, as built from the environment. */
export type AllWorkflowDeps = WorkflowDeps & NewListingDeps;

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
 * Why workflowDepsFromEnv can't build the workflows' dependencies from this environment, or
 * undefined when it can. Check it before starting work a workflow has to finish.
 */
export function backgroundWorkUnavailable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DATA_SOURCE === "supabase" && (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)) {
    return "Background work with DATA_SOURCE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY.";
  }
  return undefined;
}

/**
 * From the environment, like the web app. DATA_SOURCE=supabase works on SUPABASE_URL with
 * SUPABASE_SECRET_KEY, where Amazon authorizations are kept too; mock (the default) works on the
 * in-memory dataset, which has none, so there is nothing to sync.
 */
export function workflowDepsFromEnv(env: NodeJS.ProcessEnv = process.env): AllWorkflowDeps {
  const base = {
    productTypeSchema: (definition: ProductTypeDefinition) => loadProductTypeSchema(definition, { environment: amazonEnvironment(env) }),
    llm: llmProvider,
    now: () => new Date(),
  };
  if (env.DATA_SOURCE !== "supabase") {
    return { ...base, dataSource: getMockDataSource(), authorizations: NO_AUTHORIZATIONS, amazon: amazonClients(NO_AUTHORIZATIONS, env) };
  }
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey } = env;
  const unavailable = backgroundWorkUnavailable(env);
  if (unavailable || !url || !secretKey) throw new Error(unavailable);
  const admin = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authorizations = createSupabaseAmazonAuthorizationStore(admin);
  return { ...base, dataSource: createSupabaseDataSource(admin), authorizations, amazon: amazonClients(authorizations, env) };
}

let deps: AllWorkflowDeps | undefined;

/** One set per process, so access tokens and rate limits carry across function runs. */
export function workflowDeps(): AllWorkflowDeps {
  deps ??= workflowDepsFromEnv();
  return deps;
}
