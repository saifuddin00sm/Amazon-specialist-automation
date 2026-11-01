/**
 * Seeds Supabase from the mock generator: `pnpm db:seed`. Uses SUPABASE_URL / SUPABASE_SECRET_KEY
 * when set, otherwise the local stack. Replaces everything in the database.
 */
import { createClient } from "@supabase/supabase-js";
import { generateMockDataset } from "../src/mock/generate";
import type { Database } from "../src/supabase/database.types";
import { resolveSupabaseEnv } from "../src/supabase/env";
import { seedDatabase } from "../src/supabase/seed";

const env = resolveSupabaseEnv();
if (!env) {
  console.error("No Supabase to seed. Start the local stack with `pnpm db:start`, or set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const admin = createClient<Database>(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const startedAt = Date.now();
console.log(`Seeding ${env.url}`);
await seedDatabase(admin, generateMockDataset(), { onProgress: (message) => console.log(`  ${message}`) });
console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. Members sign in with a magic link sent to their email.`);
