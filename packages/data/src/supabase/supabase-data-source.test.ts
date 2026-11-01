import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { describeDataSourceContract } from "../data-source.contract";
import { generateMockDataset } from "../mock/generate";
import { createSupabaseDataSource, type AppSupabaseClient } from "./supabase-data-source";
import { adminClient, prepareDatabase, signInAs, testSupabaseEnv as env } from "./test-support";

const dataset = generateMockDataset();
const skip = !env;

// The same suite as the mock, against a database seeded with the same dataset and the secret key.
describeDataSourceContract(
  "supabase",
  async () => {
    const admin = adminClient(env!);
    await prepareDatabase(admin, dataset);
    return {
      dataset,
      reader: () => createSupabaseDataSource(admin),
      writer: async (now) => {
        await prepareDatabase(admin, dataset);
        return createSupabaseDataSource(admin, { now });
      },
    };
  },
  { skip },
);

describe.skipIf(skip)("supabase DataSource as a signed-in member", () => {
  const [merchant, agency] = dataset.workspaces;
  const memberOf = (workspaceId: string, role: string) =>
    dataset.members.find((member) => member.workspaceId === workspaceId && member.role === role)!;
  const now = () => new Date("2026-10-31T09:00:00.000Z");
  let admin: AppSupabaseClient;

  beforeAll(() => {
    admin = adminClient(env!);
  });
  beforeEach(async () => {
    await prepareDatabase(admin, dataset);
  }, 120_000);

  const signedIn = async (email: string) => {
    const { client, userId } = await signInAs(env!, admin, email);
    return createSupabaseDataSource(client, { userId, now });
  };

  it("acts as the signed-in member, only in their workspaces", async () => {
    const specialist = memberOf(merchant!.id, "specialist");
    const source = await signedIn(specialist.email);
    expect(await source.getActingMember(merchant!.id)).toEqual(specialist);
    expect(await source.getActingMember(agency!.id)).toBeUndefined();
    expect((await source.listWorkspaces()).map((workspace) => workspace.id)).toEqual([merchant!.id]);
  });

  it("decides proposals as themselves, never as someone else", async () => {
    const specialist = memberOf(merchant!.id, "specialist");
    const owner = memberOf(merchant!.id, "owner");
    const proposal = dataset.proposals.find(
      (candidate) => candidate.workspaceId === merchant!.id && candidate.status === "pending_approval" && candidate.type === "bid_change",
    )!;
    const source = await signedIn(specialist.email);

    await expect(source.approveProposal({ proposalId: proposal.id, memberId: owner.id })).rejects.toMatchObject({ code: "forbidden" });
    const approved = await source.approveProposal({ proposalId: proposal.id, memberId: specialist.id, note: "Ship it" });
    expect(approved).toMatchObject({ status: "approved", decidedBy: { type: "member", memberId: specialist.id } });
    expect(await source.getProposal(proposal.id)).toEqual(approved);
    const [event] = await source.listAuditEvents({ workspaceId: merchant!.id, limit: 1 });
    expect(event).toMatchObject({ action: "proposal.approved", actor: { type: "member", memberId: specialist.id } });
  });

  it("lets a client approver run the optimizer on their own account through row-level security", async () => {
    const approver = dataset.members.find((member) => member.role === "client_approver")!;
    const accountId = approver.sellerAccountIds[0]!;
    const waiting = new Set(dataset.proposals.filter((p) => p.status === "pending_approval").map((p) => p.target.id));
    const product = dataset.products.find(
      (candidate) =>
        candidate.sellerAccountId === accountId &&
        !waiting.has(candidate.id) &&
        dataset.listingVersions.some((version) => version.productId === candidate.id && version.status === "live"),
    )!;
    const source = await signedIn(approver.email);

    const run = await source.startListingOptimizer({ productId: product.id, memberId: approver.id });
    const { run: finished, proposal } = await source.completeAgentRun(run.id);
    expect(finished.status).toBe("succeeded");
    expect(proposal).toMatchObject({ status: "pending_approval", sellerAccountId: accountId });
    expect(await source.getProposal(proposal!.id)).toEqual(proposal);
  });
});
