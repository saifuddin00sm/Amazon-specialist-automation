import { createSupabaseDataSource, getMockDataSource, type DataSource } from "@app/data";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { serverEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Who is signed in. Undefined in mock mode, which has no sign-in. */
export type SignedInUser = { id: string; email: string };

const session = cache(async () => {
  const env = serverEnv();
  if (env.DATA_SOURCE !== "supabase") return undefined;
  // Request time only: checking the token reads the clock, which Next won't allow while prerendering
  // (Partial Prefetching prerenders with the request's cookies).
  await connection();
  const supabase = await createSupabaseServerClient(env);
  const { data } = await supabase.auth.getClaims();
  return { supabase, claims: data?.claims };
});

/**
 * The DataSource for this request, picked by DATA_SOURCE. With Supabase it reads and writes as the
 * signed-in member (row-level security applies); without a session it sends the visitor to /login.
 */
export const getDataSource = cache(async (): Promise<DataSource> => {
  const current = await session();
  if (!current) return getMockDataSource();
  if (!current.claims) redirect("/login");
  return createSupabaseDataSource(current.supabase, { userId: current.claims.sub });
});

export const getSignedInUser = cache(async (): Promise<SignedInUser | undefined> => {
  const claims = (await session())?.claims;
  return claims ? { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" } : undefined;
});
