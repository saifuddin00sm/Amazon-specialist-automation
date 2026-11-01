import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Where a Supabase project is and how to reach it. The secret key bypasses row-level security. */
export type SupabaseEnv = { url: string; publishableKey: string; secretKey: string };

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** From SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY, when all are set. */
export function supabaseEnvFromProcess(env: NodeJS.ProcessEnv = process.env): SupabaseEnv | undefined {
  const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SECRET_KEY: secretKey } = env;
  return url && publishableKey && secretKey ? { url, publishableKey, secretKey } : undefined;
}

/** Asks the Supabase CLI for the local stack (`pnpm db:start`). Undefined when it isn't running. */
export function localSupabaseEnv(): SupabaseEnv | undefined {
  try {
    // Through the shell, since pnpm is a .cmd shim on Windows. The command is a constant.
    const output = execSync("pnpm exec supabase status --output json", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
    const status = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)) as Record<string, string | undefined>;
    const { API_URL: url, PUBLISHABLE_KEY: publishableKey, SECRET_KEY: secretKey } = status;
    return url && publishableKey && secretKey ? { url, publishableKey, secretKey } : undefined;
  } catch {
    return undefined;
  }
}

/** The configured project, or else the local stack. */
export function resolveSupabaseEnv(): SupabaseEnv | undefined {
  return supabaseEnvFromProcess() ?? localSupabaseEnv();
}
