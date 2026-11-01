import {
  AgentRunSchema,
  AutonomyByActionSchema,
  AutonomyLevelSchema,
  BrandingSchema,
  GuardrailsSchema,
  MARKETPLACE_CURRENCY,
  MemberSchema,
  SellerAccountSchema,
  WorkspaceSchema,
  canManageWorkspace,
  type AgentRun,
  type AuditEvent,
  type AutonomyByAction,
  type AutonomyLevel,
  type Branding,
  type Guardrails,
  type Marketplace,
  type Member,
  type MemberRole,
  type SellerAccount,
  type Workspace,
} from "@app/core";

export type SettingsWriteErrorCode = "not_found" | "forbidden" | "invalid_input" | "conflict";

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

const OWNERS_ONLY = "Only workspace owners can change this.";

/**
 * Sets (or with null, clears) a workspace's report branding, shared by every DataSource. Pure:
 * returns the updated workspace and its settings.updated event, or throws SettingsWriteError.
 * The other writes below follow the same shape.
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

export type AccountSettingsChange = {
  /** null goes back to DEFAULT_GUARDRAILS. */
  guardrails?: Guardrails | null;
  autonomyLevel?: AutonomyLevel;
  /** Per action type; null clears every override. */
  autonomyByAction?: AutonomyByAction | null;
};

/** Changes an account's guardrails and autonomy. Owners only; logs before and after. */
export function accountSettingsWrite(
  { account, member, at }: { account: SellerAccount | undefined; member: Member | undefined; at: string },
  change: AccountSettingsChange,
): { account: SellerAccount; events: AuditEventDraft[] } {
  if (!account) throw new SettingsWriteError("not_found", "That seller account no longer exists.");
  if (!member || !canManageWorkspace(member, account.workspaceId)) throw new SettingsWriteError("forbidden", OWNERS_ONLY);

  const updated: SellerAccount = { ...account };
  if (change.guardrails !== undefined) {
    delete updated.guardrails;
    if (change.guardrails) updated.guardrails = parseOr(GuardrailsSchema, change.guardrails);
  }
  if (change.autonomyLevel !== undefined) updated.autonomyLevel = parseOr(AutonomyLevelSchema, change.autonomyLevel);
  if (change.autonomyByAction !== undefined) {
    delete updated.autonomyByAction;
    const overrides = change.autonomyByAction ? parseOr(AutonomyByActionSchema, change.autonomyByAction) : {};
    if (Object.keys(overrides).length > 0) updated.autonomyByAction = overrides;
  }

  const picked = (record: SellerAccount) => ({
    guardrails: record.guardrails ?? null,
    autonomyLevel: record.autonomyLevel,
    autonomyByAction: record.autonomyByAction ?? null,
  });
  return {
    account: SellerAccountSchema.parse(updated),
    events: [
      {
        workspaceId: account.workspaceId,
        sellerAccountId: account.id,
        at,
        actor: { type: "member", memberId: member.id },
        action: "settings.updated",
        entity: { type: "seller_account", id: account.id },
        metadata: { setting: "agents", before: picked(account), after: picked(updated) },
      },
    ],
  };
}

/** Connects a new seller account (the Phase 1 mock of Amazon's authorization). Owners only. */
export function connectAccountWrite(
  { workspace, member, at, id, sellerId }: { workspace: Workspace | undefined; member: Member | undefined; at: string; id: string; sellerId: string },
  { name, marketplace }: { name: string; marketplace: Marketplace },
): { account: SellerAccount; events: AuditEventDraft[] } {
  if (!workspace) throw new SettingsWriteError("not_found", "That workspace no longer exists.");
  if (!member || !canManageWorkspace(member, workspace.id)) throw new SettingsWriteError("forbidden", "Only workspace owners can connect accounts.");
  const trimmed = name.trim();
  if (!trimmed) throw new SettingsWriteError("invalid_input", "Name the account.");

  const account = parseOr(SellerAccountSchema, {
    id,
    workspaceId: workspace.id,
    name: trimmed,
    sellerId,
    marketplace,
    currency: MARKETPLACE_CURRENCY[marketplace],
    // New accounts start where every agent drafts and a member decides.
    autonomyLevel: "L1",
    targetAcos: 0.3,
    connectedAt: at,
  });
  return {
    account,
    events: [
      {
        workspaceId: workspace.id,
        sellerAccountId: account.id,
        at,
        actor: { type: "member", memberId: member.id },
        action: "seller_account.connected",
        entity: { type: "seller_account", id: account.id },
        metadata: { marketplace, sellerId },
      },
    ],
  };
}

export type MemberChange = { role: MemberRole; sellerAccountIds: string[] };

type TeamContext = {
  workspace: Workspace | undefined;
  /** The member making the change. */
  member: Member | undefined;
  /** Everyone in the workspace now. */
  members: readonly Member[];
  /** Account ids in the workspace, for scoping. */
  accountIds: readonly string[];
  at: string;
};

/** Adds a member to the workspace. They sign in with a magic link to their email. Owners only. */
export function inviteMemberWrite(
  ctx: TeamContext & { id: string },
  { name, email, ...change }: MemberChange & { name: string; email: string },
): { member: Member; events: AuditEventDraft[] } {
  const { workspace, member: actor } = assertTeamOwner(ctx);
  const normalized = email.trim().toLowerCase();
  if (ctx.members.some((existing) => existing.email.toLowerCase() === normalized)) {
    throw new SettingsWriteError("conflict", `${normalized} is already in this workspace.`);
  }
  const invited = parseOr(MemberSchema, {
    id: ctx.id,
    workspaceId: workspace.id,
    name: name.trim(),
    email: normalized,
    ...scoped(change, ctx.accountIds),
    createdAt: ctx.at,
  });
  return {
    member: invited,
    events: [teamEvent(workspace, actor, ctx.at, "member.invited", invited, { role: invited.role, email: invited.email })],
  };
}

/** Changes a member's role and account scope. Owners only, never their own, never the last owner. */
export function updateMemberWrite(ctx: TeamContext & { target: Member | undefined }, change: MemberChange): { member: Member; events: AuditEventDraft[] } {
  const { workspace, member: actor } = assertTeamOwner(ctx);
  const target = assertOtherMember(ctx.target, actor, workspace, "change your own role");
  const updated = parseOr(MemberSchema, { ...target, ...scoped(change, ctx.accountIds) });
  if (target.role === "owner" && updated.role !== "owner") assertAnotherOwner(ctx.members, target);
  return {
    member: updated,
    events: [
      teamEvent(workspace, actor, ctx.at, "member.updated", updated, {
        before: { role: target.role, sellerAccountIds: target.sellerAccountIds },
        after: { role: updated.role, sellerAccountIds: updated.sellerAccountIds },
      }),
    ],
  };
}

/** Removes a member. Owners only, never themselves, never the last owner. */
export function removeMemberWrite(ctx: TeamContext & { target: Member | undefined }): { member: Member; events: AuditEventDraft[] } {
  const { workspace, member: actor } = assertTeamOwner(ctx);
  const target = assertOtherMember(ctx.target, actor, workspace, "remove yourself");
  if (target.role === "owner") assertAnotherOwner(ctx.members, target);
  return {
    member: target,
    events: [teamEvent(workspace, actor, ctx.at, "member.removed", target, { role: target.role, email: target.email })],
  };
}

/**
 * The kill switch. Pausing stops every agent in the workspace: runs in flight are cancelled, and no
 * run starts, files or auto-approves anything until an owner resumes. Owners and specialists may
 * pause; only owners resume.
 */
export function agentsPausedWrite(
  { workspace, member, runningRuns, at }: { workspace: Workspace | undefined; member: Member | undefined; runningRuns: readonly AgentRun[]; at: string },
  paused: boolean,
): { workspace: Workspace; cancelledRuns: AgentRun[]; events: AuditEventDraft[] } {
  if (!workspace) throw new SettingsWriteError("not_found", "That workspace no longer exists.");
  const allowed = paused
    ? member?.workspaceId === workspace.id && (member.role === "owner" || member.role === "specialist")
    : member !== undefined && canManageWorkspace(member, workspace.id);
  if (!member || !allowed) {
    throw new SettingsWriteError("forbidden", paused ? "Only owners and specialists can pause agents." : "Only workspace owners can resume agents.");
  }
  if ((workspace.agentsPausedAt !== undefined) === paused) {
    throw new SettingsWriteError("conflict", paused ? "Agents are already paused." : "Agents are already running.");
  }

  const updated: Workspace = { ...workspace };
  delete updated.agentsPausedAt;
  delete updated.agentsPausedBy;
  if (paused) Object.assign(updated, { agentsPausedAt: at, agentsPausedBy: member.id });

  const cancelledRuns = paused
    ? runningRuns
        .filter((run) => run.workspaceId === workspace.id && (run.status === "running" || run.status === "queued"))
        .map((run) => AgentRunSchema.parse({ ...run, status: "cancelled", finishedAt: at, summary: "Cancelled: agents were paused." }))
    : [];
  const actor = { type: "member" as const, memberId: member.id };
  return {
    workspace: WorkspaceSchema.parse(updated),
    cancelledRuns,
    events: [
      {
        workspaceId: workspace.id,
        at,
        actor,
        action: paused ? "agents.paused" : "agents.resumed",
        entity: { type: "workspace", id: workspace.id },
        metadata: paused ? { cancelledRuns: cancelledRuns.map((run) => run.id) } : {},
      },
      ...cancelledRuns.map(
        (run): AuditEventDraft => ({
          workspaceId: run.workspaceId,
          sellerAccountId: run.sellerAccountId,
          at,
          actor,
          action: "agent_run.finished",
          entity: { type: "agent_run", id: run.id },
          metadata: { status: "cancelled", proposals: 0 },
        }),
      ),
    ],
  };
}

function assertTeamOwner(ctx: TeamContext): { workspace: Workspace; member: Member } {
  if (!ctx.workspace) throw new SettingsWriteError("not_found", "That workspace no longer exists.");
  if (!ctx.member || !canManageWorkspace(ctx.member, ctx.workspace.id)) throw new SettingsWriteError("forbidden", "Only workspace owners can manage the team.");
  return { workspace: ctx.workspace, member: ctx.member };
}

function assertOtherMember(target: Member | undefined, actor: Member, workspace: Workspace, what: string): Member {
  if (!target || target.workspaceId !== workspace.id) throw new SettingsWriteError("not_found", "That member is no longer in this workspace.");
  if (target.id === actor.id) throw new SettingsWriteError("conflict", `You can't ${what}. Ask another owner.`);
  return target;
}

function assertAnotherOwner(members: readonly Member[], leaving: Member) {
  if (!members.some((member) => member.role === "owner" && member.id !== leaving.id)) {
    throw new SettingsWriteError("conflict", "A workspace needs at least one owner.");
  }
}

/** Account scope only means something for client approvers, who need at least one account. */
function scoped({ role, sellerAccountIds }: MemberChange, accountIds: readonly string[]): MemberChange {
  if (sellerAccountIds.some((id) => !accountIds.includes(id))) throw new SettingsWriteError("invalid_input", "Pick accounts from this workspace.");
  if (role === "client_approver" && sellerAccountIds.length === 0) {
    throw new SettingsWriteError("invalid_input", "A client approver needs at least one account.");
  }
  return { role, sellerAccountIds: role === "client_approver" ? [...new Set(sellerAccountIds)] : [] };
}

function teamEvent(
  workspace: Workspace,
  actor: Member,
  at: string,
  action: AuditEvent["action"],
  member: Member,
  metadata: AuditEvent["metadata"],
): AuditEventDraft {
  return { workspaceId: workspace.id, at, actor: { type: "member", memberId: actor.id }, action, entity: { type: "member", id: member.id }, metadata };
}

function parseOr<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SettingsWriteError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid settings.");
  return parsed.data;
}
