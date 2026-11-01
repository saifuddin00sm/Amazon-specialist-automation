import { BrandingSchema, WorkspaceSchema, canManageWorkspace, type AuditEvent, type Branding, type Member, type Workspace } from "@app/core";

export type SettingsWriteErrorCode = "not_found" | "forbidden" | "invalid_input";

/** A settings change the data source refused. `message` is safe to show to the member. */
export class SettingsWriteError extends Error {
  constructor(
    readonly code: SettingsWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SettingsWriteError";
  }
}

type AuditEventDraft = Omit<AuditEvent, "id">;

/**
 * Sets (or with null, clears) a workspace's report branding, shared by every DataSource. Pure:
 * returns the updated workspace and its settings.updated event, or throws SettingsWriteError.
 */
export function brandingWrite(
  { workspace, member, at }: { workspace: Workspace | undefined; member: Member | undefined; at: string },
  branding: Branding | null,
): { workspace: Workspace; events: AuditEventDraft[] } {
  if (!workspace) throw new SettingsWriteError("not_found", "That workspace no longer exists.");
  if (!member || !canManageWorkspace(member, workspace.id)) {
    throw new SettingsWriteError("forbidden", "Only workspace owners can change report branding.");
  }

  let next: Branding | undefined;
  if (branding) {
    const parsed = BrandingSchema.safeParse(branding);
    if (!parsed.success) throw new SettingsWriteError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid branding.");
    next = parsed.data;
  }
  const updated = { ...workspace };
  delete updated.branding;
  if (next) updated.branding = next;

  return {
    workspace: WorkspaceSchema.parse(updated),
    events: [
      {
        workspaceId: workspace.id,
        at,
        actor: { type: "member", memberId: member.id },
        action: "settings.updated",
        entity: { type: "workspace", id: workspace.id },
        // The logo itself stays out of the log; it can be ~100 KB.
        metadata: {
          setting: "report_branding",
          branding: next
            ? { displayName: next.displayName ?? null, primaryColor: next.primaryColor, accentColor: next.accentColor, logo: Boolean(next.logo) }
            : null,
        },
      },
    ],
  };
}
