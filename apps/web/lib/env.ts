import { z } from "zod";

/**
 * DATA_SOURCE picks the backend: `mock` (the default) serves the in-memory dataset with no sign-in;
 * `supabase` reads the database at SUPABASE_URL as the member signed in with a magic link.
 * Server-only: nothing here reaches the browser.
 */
const ServerEnvSchema = z.discriminatedUnion("DATA_SOURCE", [
  z.object({ DATA_SOURCE: z.literal("mock") }),
  z.object({
    DATA_SOURCE: z.literal("supabase"),
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  }),
]);

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type SupabaseServerEnv = Extract<ServerEnv, { DATA_SOURCE: "supabase" }>;

let parsed: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  parsed ??= ServerEnvSchema.parse({
    DATA_SOURCE: process.env.DATA_SOURCE || "mock",
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  return parsed;
}
