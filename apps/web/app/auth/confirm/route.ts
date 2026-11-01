import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The magic link lands here: verifying its token starts the session and sets the cookies. */
export async function GET(request: NextRequest) {
  const env = serverEnv();
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (env.DATA_SOURCE === "supabase" && tokenHash && type) {
    const supabase = await createSupabaseServerClient(env);
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
