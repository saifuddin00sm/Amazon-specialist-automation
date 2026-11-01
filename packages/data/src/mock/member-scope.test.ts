import { describe, expect, it } from "vitest";
import { generateMockDataset } from "./generate";
import { createMockDataSource } from "./mock-data-source";

const dataset = generateMockDataset();
const [merchant, agency] = dataset.workspaces;
const memberOf = (workspaceId: string, role: string) => dataset.members.find((member) => member.workspaceId === workspaceId && member.role === role)!;
const approver = dataset.members.find((member) => member.role === "client_approver")!;
const ownAccountId = approver.sellerAccountIds[0]!;
const otherAccountId = dataset.sellerAccounts.find((account) => account.workspaceId === agency!.id && account.id !== ownAccountId)!.id;
const source = () => createMockDataSource(dataset, { now: () => new Date("2026-10-31T09:00:00.000Z") });

describe("mock member views", () => {
  it("shows a specialist their whole workspace and nothing else", async () => {
    const specialist = memberOf(agency!.id, "specialist");
    const view = source().asMember(specialist.id)!;
    expect((await view.listWorkspaces()).map((workspace) => workspace.id)).toEqual([agency!.id]);
    expect(await view.listSellerAccounts()).toHaveLength(5);
    expect(await view.listMembers(agency!.id)).toEqual(dataset.members.filter((member) => member.workspaceId === agency!.id));
    expect(await view.getActingMember(agency!.id)).toEqual(specialist);
    expect(await view.getActingMember(merchant!.id)).toBeUndefined();
    expect(await view.listProducts({ sellerAccountId: dataset.sellerAccounts.find((a) => a.workspaceId === merchant!.id)!.id })).toEqual([]);
  });

  it("limits a client approver to their own account", async () => {
    const view = source().asMember(approver.id)!;
    expect((await view.listSellerAccounts()).map((account) => account.id)).toEqual([ownAccountId]);
    expect(await view.getSellerAccount(otherAccountId)).toBeUndefined();

    const pending = await view.listProposals({ workspaceId: agency!.id, status: "pending_approval" });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((proposal) => proposal.sellerAccountId === ownAccountId)).toBe(true);

    const otherProduct = dataset.products.find((product) => product.sellerAccountId === otherAccountId)!;
    expect(await view.getProduct(otherProduct.id)).toBeUndefined();
    expect(await view.listListingVersions(otherProduct.id)).toEqual([]);
    const otherCampaign = dataset.campaigns.find((campaign) => campaign.sellerAccountId === otherAccountId)!;
    expect(await view.getCampaign(otherCampaign.id)).toBeUndefined();
    expect(await view.listMetricsDaily({ sellerAccountId: otherAccountId, entityType: "campaign" })).toEqual([]);

    // Other clients' approvers stay hidden; workspace-wide events too.
    const members = await view.listMembers(agency!.id);
    expect(members.filter((member) => member.role === "client_approver").map((member) => member.id)).toEqual([approver.id]);
    const events = await view.listAuditEvents({ workspaceId: agency!.id, limit: 200 });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.sellerAccountId === ownAccountId)).toBe(true);
  });

  it("acts only as that member, and only on what they see", async () => {
    const mock = source();
    const view = mock.asMember(approver.id)!;
    const own = dataset.proposals.find((proposal) => proposal.sellerAccountId === ownAccountId && proposal.status === "pending_approval")!;
    const other = dataset.proposals.find((proposal) => proposal.sellerAccountId === otherAccountId && proposal.status === "pending_approval")!;
    const owner = memberOf(agency!.id, "owner");

    await expect(view.approveProposal({ proposalId: own.id, memberId: owner.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(view.approveProposal({ proposalId: other.id, memberId: approver.id })).rejects.toMatchObject({ code: "forbidden" });
    const approved = await view.approveProposal({ proposalId: own.id, memberId: approver.id });
    expect(approved.decidedBy).toEqual({ type: "member", memberId: approver.id });
    // Views share the mock's state.
    expect(await mock.getProposal(own.id)).toEqual(approved);
  });

  it("returns nothing for an unknown member", () => {
    expect(source().asMember("nope")).toBeUndefined();
  });
});
