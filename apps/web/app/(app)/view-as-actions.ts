"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { VIEW_AS_COOKIE, getViewAs } from "@/lib/data";

/**
 * Mock mode only: act as another member (or, with null, as each workspace's owner again), to see
 * the app as a specialist or a client approver would. With Supabase you are who you signed in as.
 */
export async function setViewAs(input: { memberId: string | null }): Promise<{ ok: boolean }> {
  const parsed = z.object({ memberId: z.string().min(1).nullable() }).safeParse(input);
  const viewAs = await getViewAs();
  if (!parsed.success || !viewAs) return { ok: false };
  const { memberId } = parsed.data;
  if (memberId !== null && !viewAs.options.some((option) => option.id === memberId)) return { ok: false };

  const jar = await cookies();
  if (memberId === null) jar.delete(VIEW_AS_COOKIE);
  else jar.set(VIEW_AS_COOKIE, memberId, { path: "/", sameSite: "lax", httpOnly: true });
  refresh();
  return { ok: true };
}
