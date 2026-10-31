import type { Proposal } from "./proposal";
import type { Member } from "./workspace";

/** Owners, specialists and client approvers decide proposals on accounts they can see. Viewers never do. */
export function canDecideProposal(member: Member, proposal: Pick<Proposal, "workspaceId" | "sellerAccountId">): boolean {
  if (member.workspaceId !== proposal.workspaceId || member.role === "viewer") return false;
  return member.sellerAccountIds.length === 0 || member.sellerAccountIds.includes(proposal.sellerAccountId);
}
