import { beforeAll, describe, expect, it } from "vitest";
import { generateMockDataset } from "../mock/generate";
import { auditEventToRow } from "./rows";
import type { AppSupabaseClient } from "./supabase-data-source";
import { adminClient, anonymousClient, prepareDatabase, signInAs, testSupabaseEnv as env } from "./test-support";

/** Row-level security, checked straight against the tables with each role's session. */
describe.skipIf(!env)("row-level security", () => {
  const dataset = generateMockDataset();
  const [merchant, agency] = dataset.workspaces;
  const memberOf = (workspaceId: string, role: string) =>
    dataset.members.find((member) => member.workspaceId === workspaceId && member.role === role)!;
  const approver = dataset.members.find((member) => member.role === "client_approver")!;
  const approverAccount = approver.sellerAccountIds[0]!;
  const pendingIn = (sellerAccountId: string) =>
    dataset.proposals.find((proposal) => proposal.sellerAccountId === sellerAccountId && proposal.status === "pending_approval")!;
  const merchantAccount = dataset.sellerAccounts.find((account) => account.workspaceId === merchant!.id)!;

  let admin: AppSupabaseClient;
  const as: Record<"owner" | "specialist" | "viewer" | "approver", AppSupabaseClient> = {} as never;

  beforeAll(async () => {
    admin = adminClient(env!);
    await prepareDatabase(admin, dataset);
    for (const [key, member] of [
      ["owner", memberOf(merchant!.id, "owner")],
      ["specialist", memberOf(merchant!.id, "specialist")],
      ["viewer", memberOf(merchant!.id, "viewer")],
      ["approver", approver],
    ] as const) {
      as[key] = (await signInAs(env!, admin, member.email)).client;
    }
  }, 120_000);

  const ids = async (query: PromiseLike<{ data: { id: string }[] | null; error: unknown }>) => {
    const { data, error } = await query;
    expect(error).toBeNull();
    return (data ?? []).map((row) => row.id);
  };

  it("refuses visitors who haven't signed in", async () => {
    const anonymous = anonymousClient(env!);
    for (const table of ["workspaces", "products", "proposals", "audit_events"] as const) {
      expect((await anonymous.from(table).select("id").limit(1)).error?.code).toBe("42501");
    }
  });

  it("keeps each workspace to its own members", async () => {
    expect(await ids(as.owner.from("workspaces").select("id"))).toEqual([merchant!.id]);
    expect(await ids(as.owner.from("seller_accounts").select("id"))).toEqual([merchantAccount.id]);
    expect(await ids(as.owner.from("proposals").select("id").eq("workspace_id", agency!.id))).toEqual([]);
    const { count } = await as.owner.from("metrics_daily").select("*", { count: "exact", head: true }).eq("workspace_id", agency!.id);
    expect(count).toBe(0);
  });

  it("limits a client approver to their own accounts and contacts", async () => {
    expect(await ids(as.approver.from("seller_accounts").select("id"))).toEqual([approverAccount]);
    const productAccounts = await as.approver.from("products").select("seller_account_id");
    expect(new Set(productAccounts.data?.map((row) => row.seller_account_id))).toEqual(new Set([approverAccount]));

    const visibleMembers = await ids(as.approver.from("members").select("id"));
    const otherApprovers = dataset.members.filter((member) => member.role === "client_approver" && member.id !== approver.id);
    expect(visibleMembers).toContain(approver.id);
    expect(visibleMembers).toContain(memberOf(agency!.id, "owner").id);
    expect(visibleMembers.some((id) => otherApprovers.some((member) => member.id === id))).toBe(false);

    // Workspace-level events (no seller account) are for agency staff only.
    const events = await as.approver.from("audit_events").select("seller_account_id");
    expect(events.data?.every((row) => row.seller_account_id === approverAccount)).toBe(true);
  });

  it("lets viewers read but not decide or record anything", async () => {
    const proposal = pendingIn(merchantAccount.id);
    expect(await ids(as.viewer.from("proposals").select("id").eq("id", proposal.id))).toEqual([proposal.id]);

    const decided = await as.viewer.from("proposals").update({ status: "approved" }).eq("id", proposal.id).select("id");
    expect(decided.data).toEqual([]);

    const viewer = memberOf(merchant!.id, "viewer");
    const inserted = await as.viewer.from("audit_events").insert(
      auditEventToRow({
        id: "aud_viewer_test",
        workspaceId: merchant!.id,
        sellerAccountId: merchantAccount.id,
        at: "2026-10-31T09:00:00.000Z",
        actor: { type: "member", memberId: viewer.id },
        action: "proposal.approved",
        entity: { type: "proposal", id: proposal.id },
        metadata: {},
      }),
    );
    expect(inserted.error?.code).toBe("42501");
  });

  it("never lets the app change live catalog or advertising data", async () => {
    const product = dataset.products.find((candidate) => candidate.sellerAccountId === merchantAccount.id)!;
    const priced = await as.owner.from("products").update({ price: 1 }).eq("id", product.id);
    expect(priced.error?.code).toBe("42501");
    const bid = await as.specialist.from("targets").update({ bid: 9 }).eq("seller_account_id", merchantAccount.id);
    expect(bid.error?.code).toBe("42501");
  });

  it("keeps audit events append-only and unforgeable", async () => {
    const [event] = dataset.auditEvents.filter((candidate) => candidate.sellerAccountId === merchantAccount.id);
    expect((await as.owner.from("audit_events").delete().eq("id", event!.id)).error?.code).toBe("42501");
    expect((await as.owner.from("audit_events").update({ metadata: {} }).eq("id", event!.id)).error?.code).toBe("42501");

    // A specialist can't record an event as the owner.
    const forged = await as.specialist.from("audit_events").insert(
      auditEventToRow({
        id: "aud_forged_test",
        workspaceId: merchant!.id,
        sellerAccountId: merchantAccount.id,
        at: "2026-10-31T09:00:00.000Z",
        actor: { type: "member", memberId: memberOf(merchant!.id, "owner").id },
        action: "settings.updated",
        entity: { type: "seller_account", id: merchantAccount.id },
        metadata: {},
      }),
    );
    expect(forged.error?.code).toBe("42501");
  });

  it("lets only owners change account settings", async () => {
    const byOwner = await as.owner.from("seller_accounts").update({ autonomy_level: "L2" }).eq("id", merchantAccount.id).select("id");
    expect(byOwner.data).toEqual([{ id: merchantAccount.id }]);
    const bySpecialist = await as.specialist.from("seller_accounts").update({ autonomy_level: "L3" }).eq("id", merchantAccount.id).select("id");
    expect(bySpecialist.data).toEqual([]);

    await admin.from("seller_accounts").update({ autonomy_level: merchantAccount.autonomyLevel }).eq("id", merchantAccount.id);
  });

  it("won't let members decide a proposal as someone else", async () => {
    const proposal = pendingIn(merchantAccount.id);
    const owner = memberOf(merchant!.id, "owner");
    const forged = await as.specialist
      .from("proposals")
      .update({
        status: "approved",
        decided_by: { type: "member", memberId: owner.id },
        decided_at: "2026-10-31T09:00:00.000Z",
      })
      .eq("id", proposal.id);
    expect(forged.error?.code).toBe("42501");
  });

  it("won't let members skip a step or change a decided proposal", async () => {
    const owner = memberOf(merchant!.id, "owner");
    const pending = pendingIn(merchantAccount.id);
    const published = await as.owner
      .from("proposals")
      .update({ status: "applied", applied_at: "2026-10-31T09:00:00.000Z", decided_by: { type: "member", memberId: owner.id }, decided_at: "2026-10-31T09:00:00.000Z" })
      .eq("id", pending.id);
    expect(published.error?.code).toBe("23514");

    const approved = dataset.proposals.find((proposal) => proposal.sellerAccountId === merchantAccount.id && proposal.status === "approved");
    if (approved) {
      const edited = await as.owner.from("proposals").update({ diff: [{ path: "bid", before: 1, after: 9 }] }).eq("id", approved.id);
      expect(edited.error?.code).toBe("23514");
      const rejected = await as.owner.from("proposals").update({ status: "rejected", decision_note: "No" }).eq("id", approved.id);
      expect(rejected.error?.code).toBe("23514");
    }
  });
});
