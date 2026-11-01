"use server";

import {
  AutonomyByActionSchema,
  AutonomyLevelSchema,
  BrandingSchema,
  GuardrailsSchema,
  MarketplaceSchema,
  MemberRoleSchema,
} from "@app/core";
import { SettingsWriteError, type DataSource } from "@app/data";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDataSource } from "@/lib/data";

/** `id` is the record the write created or changed, when it returns one. */
export type SettingsActionResult = { ok: true; id?: string } | { ok: false; message: string };

const Id = z.string().min(1);
const BrandingInput = z.object({ workspaceId: Id, branding: BrandingSchema.nullable() });
const AccountSettingsInput = z.object({
  sellerAccountId: Id,
  guardrails: GuardrailsSchema.nullable().optional(),
  autonomyLevel: AutonomyLevelSchema.optional(),
  autonomyByAction: AutonomyByActionSchema.nullable().optional(),
});
const ConnectInput = z.object({ workspaceId: Id, name: z.string().trim().min(1, "Name the account.").max(80), marketplace: MarketplaceSchema });
const MemberFields = { role: MemberRoleSchema, sellerAccountIds: z.array(Id).max(50) };
const InviteInput = z.object({
  workspaceId: Id,
  name: z.string().trim().min(1, "Enter their name.").max(80),
  email: z.email("Enter a valid email."),
  ...MemberFields,
});
const UpdateMemberInput = z.object({ workspaceId: Id, targetMemberId: Id, ...MemberFields });
const RemoveMemberInput = z.object({ workspaceId: Id, targetMemberId: Id });
const PauseInput = z.object({ workspaceId: Id, paused: z.boolean() });

/** Saves a workspace's report branding; null goes back to the default. */
export async function updateBranding(input: z.input<typeof BrandingInput>): Promise<SettingsActionResult> {
  return settingsWrite(BrandingInput, input, (data) => data.workspaceId, (source, memberId, { workspaceId, branding }) =>
    source.updateWorkspaceBranding({ workspaceId, memberId, branding }),
  );
}

/** Saves an account's guardrails and autonomy. */
export async function updateAccountSettings(input: z.input<typeof AccountSettingsInput>): Promise<SettingsActionResult> {
  const dataSource = await getDataSource();
  const parsed = AccountSettingsInput.safeParse(input);
  const account = parsed.success ? await dataSource.getSellerAccount(parsed.data.sellerAccountId) : undefined;
  return settingsWrite(AccountSettingsInput, input, () => account?.workspaceId ?? "", (source, memberId, data) =>
    source.updateSellerAccountSettings({ ...data, memberId }),
  );
}

/** The mock "Connect Amazon" flow: nothing is sent to Amazon in Phase 1. */
export async function connectAmazonAccount(input: z.input<typeof ConnectInput>): Promise<SettingsActionResult> {
  return settingsWrite(ConnectInput, input, (data) => data.workspaceId, (source, memberId, data) =>
    source.connectSellerAccount({ ...data, memberId }),
  );
}

export async function inviteMember(input: z.input<typeof InviteInput>): Promise<SettingsActionResult> {
  return settingsWrite(InviteInput, input, (data) => data.workspaceId, (source, memberId, data) => source.inviteMember({ ...data, memberId }));
}

export async function updateMember(input: z.input<typeof UpdateMemberInput>): Promise<SettingsActionResult> {
  return settingsWrite(UpdateMemberInput, input, (data) => data.workspaceId, (source, memberId, { targetMemberId, role, sellerAccountIds }) =>
    source.updateMember({ memberId, targetMemberId, role, sellerAccountIds }),
  );
}

export async function removeMember(input: z.input<typeof RemoveMemberInput>): Promise<SettingsActionResult> {
  return settingsWrite(RemoveMemberInput, input, (data) => data.workspaceId, (source, memberId, { targetMemberId }) =>
    source.removeMember({ memberId, targetMemberId }),
  );
}

/** The kill switch. */
export async function setAgentsPaused(input: z.input<typeof PauseInput>): Promise<SettingsActionResult> {
  return settingsWrite(PauseInput, input, (data) => data.workspaceId, (source, memberId, { workspaceId, paused }) =>
    source.setAgentsPaused({ workspaceId, memberId, paused }),
  );
}

/**
 * Validates `input`, then writes as the acting member of the workspace. Refusals come back as
 * messages; on success the whole app re-renders, since the shell reads these settings too.
 */
async function settingsWrite<T>(
  schema: z.ZodType<T>,
  input: unknown,
  workspaceOf: (data: T) => string,
  write: (dataSource: DataSource, memberId: string, data: T) => Promise<unknown>,
): Promise<SettingsActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid settings." };
  const dataSource = await getDataSource();
  const member = await dataSource.getActingMember(workspaceOf(parsed.data));
  if (!member) return { ok: false, message: "You aren't a member of that workspace." };
  let written: unknown;
  try {
    written = await write(dataSource, member.id, parsed.data);
  } catch (error) {
    if (error instanceof SettingsWriteError) return { ok: false, message: error.message };
    throw error;
  }
  refresh();
  const id = written && typeof written === "object" && "id" in written && typeof written.id === "string" ? written.id : undefined;
  return { ok: true, ...(id ? { id } : {}) };
}
