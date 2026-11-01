import type { Member } from "@app/core";
import { createSupabaseDataSource, getMockDataSource, type DataSource } from "@app/data";
import { cookies } from "next/headers";
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

/** Mock mode only: which member the app acts as. Unset, the owner of each workspace acts and sees all. */
export const VIEW_AS_COOKIE = "view_as";

/** The member the mock acts as, from the view-as cookie; undefined with Supabase or when unset. */
const viewAsMemberId = cache(async (): Promise<string | undefined> => {
  if (serverEnv().DATA_SOURCE === "supabase") return undefined;
  return (await cookies()).get(VIEW_AS_COOKIE)?.value || undefined;
});

/**
 * The DataSource for this request, picked by DATA_SOURCE. With Supabase it reads and writes as the
 * signed-in member (row-level security applies); without a session it sends the visitor to /login.
 * The mock reads and writes as the member picked in "View as", seeing only what they may see.
 */
export const getDataSource = cache(async (): Promise<DataSource> => {
  const current = await session();
  if (!current) {
    const mock = getMockDataSource();
    const memberId = await viewAsMemberId();
    return (memberId && mock.asMember(memberId)) || mock;
  }
  if (!current.claims) redirect("/login");
  return createSupabaseDataSource(current.supabase, { userId: current.claims.sub });
});

export type ViewAsOption = Pick<Member, "id" | "name" | "role" | "sellerAccountIds"> & { workspaceName: string };

/** Mock mode only: everyone the app can act as, and who it acts as now. Undefined with Supabase. */
export const getViewAs = cache(async (): Promise<{ current?: string; options: ViewAsOption[] } | undefined> => {
  if (serverEnv().DATA_SOURCE === "supabase") return undefined;
  // From the whole mock, not the current view: you can always switch back.
  const mock = getMockDataSource();
  const workspaces = await mock.listWorkspaces();
  const members = await Promise.all(workspaces.map((workspace) => mock.listMembers(workspace.id)));
  const options = workspaces.flatMap((workspace, i) =>
    (members[i] ?? []).map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      sellerAccountIds: member.sellerAccountIds,
      workspaceName: workspace.name,
    })),
  );
  const current = await viewAsMemberId();
  return { current: options.some((option) => option.id === current) ? current : undefined, options };
});

export const getSignedInUser = cache(async (): Promise<SignedInUser | undefined> => {
  const claims = (await session())?.claims;
  return claims ? { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" } : undefined;
});
