import type { AppSupabaseClient, Database } from "@app/data";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseServerEnv } from "@/lib/env";

/** A Supabase client for this request, carrying the signed-in member's session from cookies. */
export async function createSupabaseServerClient(env: SupabaseServerEnv): Promise<AppSupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies. The proxy refreshes the session before they render.
        }
      },
    },
  });
}
