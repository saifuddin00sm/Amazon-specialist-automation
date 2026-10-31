import { describe, expect, it } from "vitest";
import { generateMockDataset } from "./generate";
import { createMockDataSource } from "./mock-data-source";

const dataset = generateMockDataset();
const dataSource = createMockDataSource(dataset);
const [merchant, agency] = dataset.workspaces;
const merchantAccount = dataset.sellerAccounts.find((account) => account.workspaceId === merchant?.id);

describe("mockDataSource", () => {
  it("lists workspaces and their seller accounts", async () => {
    expect(await dataSource.listWorkspaces()).toHaveLength(2);
    expect(await dataSource.listSellerAccounts(agency?.id)).toHaveLength(5);
    expect(await dataSource.listSellerAccounts()).toHaveLength(6);
  });

  it("returns undefined for unknown ids", async () => {
    expect(await dataSource.getWorkspace("nope")).toBeUndefined();
    expect(await dataSource.getProduct("nope")).toBeUndefined();
    expect(await dataSource.getProposal("nope")).toBeUndefined();
  });

  it("filters products by account, category and status", async () => {
    const all = await dataSource.listProducts({ sellerAccountId: merchantAccount!.id });
    const category = all[0]!.category;
    const inCategory = await dataSource.listProducts({ sellerAccountId: merchantAccount!.id, category, status: "active" });
    expect(inCategory.length).toBeGreaterThan(0);
    expect(inCategory.every((product) => product.category === category && product.status === "active")).toBe(true);
  });

  it("returns listing versions newest first", async () => {
    const product = dataset.products.find((candidate) =>
      dataset.listingVersions.filter((version) => version.productId === candidate.id).length > 1,
    );
    const versions = await dataSource.listListingVersions(product!.id);
    expect(versions.map((version) => version.version)).toEqual(
      versions.map((version) => version.version).sort((a, b) => b - a),
    );
  });

  it("filters proposals by status", async () => {
    const pending = await dataSource.listProposals({ workspaceId: agency!.id, status: "pending_approval" });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((proposal) => proposal.status === "pending_approval" && proposal.workspaceId === agency!.id)).toBe(
      true,
    );
  });

  it("returns typed metrics for a date range, oldest first", async () => {
    const rows = await dataSource.listMetricsDaily({
      sellerAccountId: merchantAccount!.id,
      entityType: "campaign",
      range: { from: "2026-10-01", to: "2026-10-07" },
    });
    const campaigns = await dataSource.listCampaigns(merchantAccount!.id);
    expect(rows).toHaveLength(campaigns.length * 7);
    expect(rows[0]!.date).toBe("2026-10-01");
    expect(rows.at(-1)!.date).toBe("2026-10-07");
    expect(rows.every((row) => row.entityType === "campaign" && row.spend >= 0)).toBe(true);
  });

  it("limits activity feeds", async () => {
    expect(await dataSource.listAuditEvents({ workspaceId: merchant!.id, limit: 10 })).toHaveLength(10);
    expect(await dataSource.listAgentRuns({ workspaceId: merchant!.id, limit: 3 })).toHaveLength(3);
  });

  it("does not let callers mutate the underlying data", async () => {
    const [workspace] = await dataSource.listWorkspaces();
    expect(() => {
      (workspace as { name: string }).name = "Changed";
    }).toThrow(TypeError);
  });
});

describe("mockDataSource writes", () => {
  const memberOf = (workspaceId: string, role: string) =>
    dataset.members.find((member) => member.workspaceId === workspaceId && member.role === role)!;
  const pendingOf = (type: string) => {
    const proposal = dataset.proposals.find((candidate) => candidate.status === "pending_approval" && candidate.type === type)!;
    return { proposal, owner: memberOf(proposal.workspaceId, "owner") };
  };

  // Writes are copy-on-write, so every test gets a fresh source over the same frozen dataset.
  const setup = (start = "2026-10-31T09:00:00.000Z") => {
    let clock = Date.parse(start);
    const source = createMockDataSource(dataset, { now: () => new Date(clock) });
    return { source, advanceHours: (hours: number) => (clock += hours * 60 * 60 * 1000) };
  };
  const latestEvents = (source: ReturnType<typeof setup>["source"], workspaceId: string, count: number) =>
    source.listAuditEvents({ workspaceId, limit: count });

  it("names the workspace owner as the acting member", async () => {
    expect(await dataSource.getActingMember(merchant!.id)).toEqual(memberOf(merchant!.id, "owner"));
  });

  it("approves a pending proposal and writes an AuditEvent", async () => {
    const { source } = setup();
    const { proposal, owner } = pendingOf("bid_change");
    const approved = await source.approveProposal({ proposalId: proposal.id, memberId: owner.id, note: "  Looks right. " });

    expect(approved).toMatchObject({
      status: "approved",
      decidedBy: { type: "member", memberId: owner.id },
      decidedAt: "2026-10-31T09:00:00.000Z",
      decisionNote: "Looks right.",
    });
    expect(await source.getProposal(proposal.id)).toEqual(approved);
    const pending = await source.listProposals({ workspaceId: proposal.workspaceId, status: "pending_approval" });
    expect(pending.some((candidate) => candidate.id === proposal.id)).toBe(false);

    const [event] = await latestEvents(source, proposal.workspaceId, 1);
    expect(event).toMatchObject({
      action: "proposal.approved",
      actor: { type: "member", memberId: owner.id },
      entity: { type: "proposal", id: proposal.id },
      metadata: { note: "Looks right.", edited: false },
    });
    expect(dataset.auditEvents.some((existing) => existing.id === event!.id)).toBe(false);
    // The shared dataset is untouched.
    expect(await dataSource.getProposal(proposal.id)).toEqual(proposal);
  });

  it("approves with edits, keeping the agent's diff and logging the edit", async () => {
    const { source } = setup();
    const { proposal, owner } = pendingOf("bid_change");
    const approved = await source.approveProposal({ proposalId: proposal.id, memberId: owner.id, edits: [{ path: "bid", after: 0.77 }] });

    expect(approved.diff).toEqual([{ ...proposal.diff[0], after: 0.77 }]);
    expect(approved.originalDiff).toEqual(proposal.diff);
    const [approvedEvent, editedEvent] = await latestEvents(source, proposal.workspaceId, 2);
    expect(approvedEvent).toMatchObject({ action: "proposal.approved", metadata: { edited: true } });
    expect(editedEvent).toMatchObject({
      action: "proposal.edited",
      metadata: { changes: [{ path: "bid", agent: proposal.diff[0]!.after, final: 0.77 }] },
    });
  });

  it("refuses approvals that fail compliance", async () => {
    const { source } = setup();
    const { proposal, owner } = pendingOf("listing_update");
    expect(proposal.diff.map((entry) => entry.path)).toContain("title");
    await expect(
      source.approveProposal({ proposalId: proposal.id, memberId: owner.id, edits: [{ path: "title", after: "#1 Best Seller Bottle" }] }),
    ).rejects.toMatchObject({ code: "compliance_failed" });
    expect((await source.getProposal(proposal.id))?.status).toBe("pending_approval");
    expect(await latestEvents(source, proposal.workspaceId, 1)).toEqual(await latestEvents(dataSource, proposal.workspaceId, 1));
  });

  it("approves a blocked listing once the prohibited claim is edited out", async () => {
    const { source } = setup();
    const blocked = dataset.proposals.find((candidate) => {
      const review = dataset.reviews.find((r) => r.id === candidate.reviewId);
      return candidate.status === "pending_approval" && review?.report.findings.some((finding) => finding.severity === "error");
    })!;
    const owner = memberOf(blocked.workspaceId, "owner");
    const claims = dataset.productFacts.find((facts) => facts.productId === blocked.target.id)!.prohibitedClaims;
    await expect(source.approveProposal({ proposalId: blocked.id, memberId: owner.id })).rejects.toMatchObject({ code: "compliance_failed" });

    const bullets = blocked.diff.find((entry) => entry.path === "bullets")!.after as string[];
    const cleaned = bullets.map((bullet) => claims.reduce((text, claim) => text.replace(new RegExp(claim, "i"), "Built for daily use"), bullet));
    const approved = await source.approveProposal({ proposalId: blocked.id, memberId: owner.id, edits: [{ path: "bullets", after: cleaned }] });
    expect(approved.status).toBe("approved");
  });

  it("rejects only with a reason and retires the agent's listing draft", async () => {
    const { source } = setup();
    const { proposal, owner } = pendingOf("listing_update");
    await expect(source.rejectProposal({ proposalId: proposal.id, memberId: owner.id, reason: "   " })).rejects.toMatchObject({
      code: "invalid_input",
    });

    const rejected = await source.rejectProposal({ proposalId: proposal.id, memberId: owner.id, reason: "Off brand." });
    expect(rejected).toMatchObject({ status: "rejected", decisionNote: "Off brand." });
    const [event] = await latestEvents(source, proposal.workspaceId, 1);
    expect(event).toMatchObject({ action: "proposal.rejected", metadata: { reason: "Off brand." } });

    const review = await source.getReview(proposal.reviewId!);
    const product = proposal.target.id;
    const draft = (await source.listListingVersions(product)).find((version) => version.id === review?.listingVersionId);
    expect(draft?.status).toBe("rejected");
  });

  it("snoozes out of the queue until the time passes", async () => {
    const { source, advanceHours } = setup();
    const { proposal, owner } = pendingOf("bid_change");
    const inQueue = async () =>
      (await source.listProposals({ workspaceId: proposal.workspaceId, status: "pending_approval", snoozed: false })).some(
        (candidate) => candidate.id === proposal.id,
      );

    await expect(
      source.snoozeProposal({ proposalId: proposal.id, memberId: owner.id, until: "2026-10-30T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await source.snoozeProposal({ proposalId: proposal.id, memberId: owner.id, until: "2026-11-01T09:00:00.000Z" });
    expect(await inQueue()).toBe(false);
    expect((await source.listProposals({ workspaceId: proposal.workspaceId, snoozed: true })).map((p) => p.id)).toContain(proposal.id);
    const [event] = await latestEvents(source, proposal.workspaceId, 1);
    expect(event).toMatchObject({ action: "proposal.snoozed", metadata: { until: "2026-11-01T09:00:00.000Z" } });

    advanceHours(25);
    expect(await inQueue()).toBe(true);
  });

  it("refuses viewers, other workspaces and decided proposals", async () => {
    const { source } = setup();
    const { proposal, owner } = pendingOf("bid_change");
    const viewer = memberOf(proposal.workspaceId, "viewer");
    const otherOwner = dataset.members.find((member) => member.workspaceId !== proposal.workspaceId && member.role === "owner")!;

    await expect(source.approveProposal({ proposalId: proposal.id, memberId: viewer.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(source.approveProposal({ proposalId: proposal.id, memberId: otherOwner.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(source.approveProposal({ proposalId: "nope", memberId: owner.id })).rejects.toMatchObject({ code: "not_found" });

    await source.approveProposal({ proposalId: proposal.id, memberId: owner.id });
    await expect(source.rejectProposal({ proposalId: proposal.id, memberId: owner.id, reason: "Changed my mind" })).rejects.toMatchObject({
      code: "not_pending",
    });
  });
});
