import type { Database } from "@app/data";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseServerEnv } from "@/lib/env";

/** Pages anyone may open; everything else needs a session. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth/");
}

/**
 * Refreshes the session cookie on every request and sends visitors without a session to /login.
 * This is the optimistic check: row-level security still decides what each member sees.
 */
export async function updateSession(request: NextRequest, env: SupabaseServerEnv): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const { pathname } = request.nextUrl;
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    // Keep any refreshed session cookies.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!data?.claims && !isPublicPath(pathname)) return redirectTo("/login");
  if (data?.claims && pathname === "/login") return redirectTo("/dashboard");
  return response;
}
