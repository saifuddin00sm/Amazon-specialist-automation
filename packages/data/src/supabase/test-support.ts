import { createClient } from "@supabase/supabase-js";
import type { MockDataset } from "../mock/generate";
import type { Database } from "./database.types";
import { resolveSupabaseEnv, type SupabaseEnv } from "./env";
import { datasetRows, resetMutableTables, seedDatabase, type SeedTable } from "./seed";
import type { AppSupabaseClient } from "./supabase-data-source";

/**
 * Supabase tests run when a project is reachable (the local stack, or SUPABASE_* env vars) and skip
 * otherwise; `pnpm test:supabase` fails instead of skipping. They reset the tables the app writes to,
 * so changes made by hand in the local database are lost.
 */
export const testSupabaseEnv: SupabaseEnv | undefined = resolveSupabaseEnv();

if (!testSupabaseEnv && process.env.npm_lifecycle_event === "test:supabase") {
  throw new Error("No Supabase to test against. Start it with `pnpm db:start`, or set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.");
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

/** A client with the secret key: bypasses row-level security. */
export function adminClient(env: SupabaseEnv): AppSupabaseClient {
  return createClient<Database>(env.url, env.secretKey, clientOptions);
}

/** A client with no session, like a visitor who hasn't signed in. */
export function anonymousClient(env: SupabaseEnv): AppSupabaseClient {
  return createClient<Database>(env.url, env.publishableKey, clientOptions);
}

/** Seeds the database unless it already holds `dataset`, then restores the tables the app writes to. */
export async function prepareDatabase(admin: AppSupabaseClient, dataset: MockDataset): Promise<void> {
  const rows = datasetRows(dataset);
  const counts = await Promise.all(
    (Object.keys(rows) as SeedTable[]).map(async (table) => {
      const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
      if (error) throw new Error(`Counting ${table} failed: ${error.message}`);
      return count === rows[table].length;
    }),
  );
  if (counts.every(Boolean)) await resetMutableTables(admin, dataset);
  else await seedDatabase(admin, dataset);
}

/** Signs in as a member the way the app does, through a magic link, without sending the email. */
export async function signInAs(env: SupabaseEnv, admin: AppSupabaseClient, email: string): Promise<{ client: AppSupabaseClient; userId: string }> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`Creating a magic link for ${email} failed: ${error.message}`);
  const client = anonymousClient(env);
  const { data, error: verifyError } = await client.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (verifyError || !data.user) throw new Error(`Signing in as ${email} failed: ${verifyError?.message ?? "no user"}`);
  return { client, userId: data.user.id };
}
