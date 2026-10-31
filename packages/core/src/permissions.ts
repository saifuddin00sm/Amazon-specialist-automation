import type { Proposal } from "./proposal";
import type { Member } from "./workspace";

type AccountScope = { workspaceId: string; sellerAccountId: string };

/** Owners, specialists and client approvers act on accounts they can see. Viewers never do. */
export function canActOnAccount(member: Member, { workspaceId, sellerAccountId }: AccountScope): boolean {
  if (member.workspaceId !== workspaceId || member.role === "viewer") return false;
  return member.sellerAccountIds.length === 0 || member.sellerAccountIds.includes(sellerAccountId);
}

export function canDecideProposal(member: Member, proposal: Pick<Proposal, "workspaceId" | "sellerAccountId">): boolean {
  return canActOnAccount(member, proposal);
}
