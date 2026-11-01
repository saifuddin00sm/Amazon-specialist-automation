"use server";

import { BrandingSchema } from "@app/core";
import { SettingsWriteError } from "@app/data";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDataSource } from "@/lib/data";

export type SettingsActionResult = { ok: true } | { ok: false; message: string };

const BrandingInput = z.object({ workspaceId: z.string().min(1), branding: BrandingSchema.nullable() });

/** Saves a workspace's report branding as the acting member; null goes back to the default. */
export async function updateBranding(input: z.input<typeof BrandingInput>): Promise<SettingsActionResult> {
  const parsed = BrandingInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid branding." };
  const { workspaceId, branding } = parsed.data;

  const dataSource = await getDataSource();
  const member = await dataSource.getActingMember(workspaceId);
  if (!member) return { ok: false, message: "You aren't a member of that workspace." };
  try {
    await dataSource.updateWorkspaceBranding({ workspaceId, memberId: member.id, branding });
  } catch (error) {
    if (error instanceof SettingsWriteError) return { ok: false, message: error.message };
    throw error;
  }
  // The shell reads workspaces (and their branding) at request time; refreshing updates every view.
  refresh();
  return { ok: true };
}
