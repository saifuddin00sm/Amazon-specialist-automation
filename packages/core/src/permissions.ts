import type { Proposal } from "./proposal";
import type { Member } from "./workspace";

type AccountScope = { workspaceId: string; sellerAccountId: string };

/**
 * Every member sees their workspace; one scoped to some accounts (a client approver) sees only
 * those. Mirrors the row-level security policies in supabase/migrations.
 */
export function canSeeAccount(member: Member, { workspaceId, sellerAccountId }: AccountScope): boolean {
  if (member.workspaceId !== workspaceId) return false;
  return member.sellerAccountIds.length === 0 || member.sellerAccountIds.includes(sellerAccountId);
}

/** Workspace-wide records (members, settings events) are for members who see every account. */
export function seesWholeWorkspace(member: Member, workspaceId: string): boolean {
  return member.workspaceId === workspaceId && member.sellerAccountIds.length === 0;
}

/** Owners, specialists and client approvers act on accounts they can see. Viewers never do. */
export function canActOnAccount(member: Member, scope: AccountScope): boolean {
  return member.role !== "viewer" && canSeeAccount(member, scope);
}

/** Only owners change workspace settings, such as report branding. */
export function canManageWorkspace(member: Member, workspaceId: string): boolean {
  return member.workspaceId === workspaceId && member.role === "owner";
}

export function canDecideProposal(member: Member, proposal: Pick<Proposal, "workspaceId" | "sellerAccountId">): boolean {
  return canActOnAccount(member, proposal);
}
