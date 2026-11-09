import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { describeDataSourceContract } from "../data-source.contract";
import { createSupabaseAmazonAuthorizationStore } from "./amazon-authorizations";
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

  it("lets only the owner change report branding through row-level security", async () => {
    const owner = memberOf(agency!.id, "owner");
    const specialist = memberOf(agency!.id, "specialist");
    const branding = { primaryColor: "#222222", accentColor: "#ff8800" };

    await expect(
      (await signedIn(specialist.email)).updateWorkspaceBranding({ workspaceId: agency!.id, memberId: specialist.id, branding }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const source = await signedIn(owner.email);
    const updated = await source.updateWorkspaceBranding({ workspaceId: agency!.id, memberId: owner.id, branding });
    expect((await source.getWorkspace(agency!.id))?.branding).toEqual(branding);
    expect(updated.branding).toEqual(branding);
  });

  it("enforces the kill switch and auto-approval in the database for signed-in members", async () => {
    const owner = memberOf(merchant!.id, "owner");
    const specialist = memberOf(merchant!.id, "specialist");
    const account = dataset.sellerAccounts.find((candidate) => candidate.workspaceId === merchant!.id)!;
    const campaign = dataset.campaigns.find(
      (candidate) => candidate.sellerAccountId === account.id && candidate.state === "enabled" && candidate.targetingType === "manual",
    )!;
    const ownerSource = await signedIn(owner.email);

    // A specialist may pause (through set_agents_paused) but not resume.
    const specialistSource = await signedIn(specialist.email);
    await specialistSource.setAgentsPaused({ workspaceId: merchant!.id, memberId: specialist.id, paused: true });
    await expect(specialistSource.setAgentsPaused({ workspaceId: merchant!.id, memberId: specialist.id, paused: false })).rejects.toMatchObject({
      code: "forbidden",
    });
    // Row-level security refuses a new run while paused, even past the app's own check.
    const { error } = await (await signInAs(env!, admin, owner.email)).client.from("agent_runs").insert({
      id: "run_paused",
      workspace_id: merchant!.id,
      seller_account_id: account.id,
      agent: "campaign_optimizer",
      status: "running",
      autonomy_level: "L1",
      trigger: "manual",
      started_at: now().toISOString(),
    });
    expect(error).not.toBeNull();
    await ownerSource.setAgentsPaused({ workspaceId: merchant!.id, memberId: owner.id, paused: false });

    // At L3 the plan is filed already approved by the system, through the auto-approval policy.
    await ownerSource.updateSellerAccountSettings({ sellerAccountId: account.id, memberId: owner.id, autonomyByAction: { campaign_plan: "L3" } });
    const run = await ownerSource.startCampaignOptimizer({ campaignId: campaign.id, memberId: owner.id });
    const { proposal } = await ownerSource.completeAgentRun(run.id);
    expect(proposal).toMatchObject({ status: "approved", decidedBy: { type: "system" } });
    expect(await ownerSource.getProposal(proposal!.id)).toEqual(proposal);
  });

  it("keeps the catalog sync and Amazon authorizations to the secret key", async () => {
    const owner = memberOf(merchant!.id, "owner");
    const account = dataset.sellerAccounts.find((candidate) => candidate.workspaceId === merchant!.id)!;
    const source = await signedIn(owner.email);
    await expect(source.importCatalogListings({ sellerAccountId: account.id, syncedAt: now().toISOString(), listings: [] })).rejects.toMatchObject({
      code: "forbidden",
    });

    // Past the app's own check, the database refuses too.
    const { client } = await signInAs(env!, admin, owner.email);
    const saved = await client.rpc("save_catalog_sync", { p_products: [], p_superseded_ids: [], p_listing_versions: [], p_events: [] });
    expect(saved.error).not.toBeNull();
    const store = createSupabaseAmazonAuthorizationStore(admin);
    await store.set("A2TESTSELLER01", "v1.iv.tag.ciphertext");
    try {
      expect(await store.sellerIds()).toContain("A2TESTSELLER01");
      const { data } = await client.from("amazon_authorizations").select();
      expect(data ?? []).toEqual([]);
    } finally {
      await admin.from("amazon_authorizations").delete().eq("seller_id", "A2TESTSELLER01");
    }
  });

  it("lets a client approver plan a campaign on their own account and approve the plan through row-level security", async () => {
    const approver = dataset.members.find((member) => member.role === "client_approver")!;
    const campaign = dataset.campaigns.find(
      (candidate) => candidate.sellerAccountId === approver.sellerAccountIds[0] && candidate.state === "enabled",
    )!;
    const source = await signedIn(approver.email);

    const run = await source.startCampaignOptimizer({ campaignId: campaign.id, memberId: approver.id });
    const { proposal } = await source.completeAgentRun(run.id);
    expect(proposal).toMatchObject({ type: "campaign_plan", status: "pending_approval", target: { id: campaign.id } });
    const approved = await source.approveProposal({ proposalId: proposal!.id, memberId: approver.id });
    expect(await source.getProposal(proposal!.id)).toEqual(approved);
  });
});
