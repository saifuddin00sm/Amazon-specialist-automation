import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { updateSession } from "@/lib/supabase/proxy";

/** With DATA_SOURCE=supabase, keeps the session fresh and sends signed-out visitors to /login. */
export async function proxy(request: NextRequest) {
  const env = serverEnv();
  if (env.DATA_SOURCE !== "supabase") return NextResponse.next();
  return updateSession(request, env);
}

export const config = {
  // Everything but static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
