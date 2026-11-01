import { AgentRunSchema } from "@app/core";
import { beforeAll, describe, expect, it } from "vitest";
import type { DataSource } from "./data-source";
import type { MockDataset } from "./mock/generate";

/** How the contract reaches one DataSource implementation seeded with `dataset`. */
export type ContractHarness = {
  dataset: MockDataset;
  /** A source over the seeded data, for tests that only read. */
  reader: () => DataSource;
  /** A source over freshly seeded data whose clock the test controls, for tests that write. */
  writer: (now: () => Date) => Promise<DataSource>;
};

/**
 * The behaviour every DataSource must have, run against each implementation (mock and Supabase).
 * Writes run with the data source's own clock, acting as members named by id.
 */
export function describeDataSourceContract(
  name: string,
  connect: () => Promise<ContractHarness>,
  { skip = false }: { skip?: boolean } = {},
): void {
  describe.skipIf(skip)(`${name} DataSource contract`, () => {
    let harness: ContractHarness;
    beforeAll(async () => {
      harness = await connect();
    }, 120_000);

    const dataset = () => harness.dataset;
    const reader = () => harness.reader();
    const workspaces = () => {
      const [merchant, agency] = dataset().workspaces;
      return { merchant: merchant!, agency: agency! };
    };
    const merchantAccount = () => dataset().sellerAccounts.find((account) => account.workspaceId === workspaces().merchant.id)!;
    const memberOf = (workspaceId: string, role: string) =>
      dataset().members.find((member) => member.workspaceId === workspaceId && member.role === role)!;
    const pendingOf = (type: string) => {
      const proposal = dataset().proposals.find((candidate) => candidate.status === "pending_approval" && candidate.type === type)!;
      return { proposal, owner: memberOf(proposal.workspaceId, "owner") };
    };

    // Each write test starts from the seeded data, with the clock at `start`.
    const setup = async (start = "2026-10-31T09:00:00.000Z") => {
      let clock = Date.parse(start);
      const source = await harness.writer(() => new Date(clock));
      return { source, advanceHours: (hours: number) => (clock += hours * 60 * 60 * 1000) };
    };
    const latestEvents = (source: DataSource, workspaceId: string, count: number) => source.listAuditEvents({ workspaceId, limit: count });

    describe("reads", () => {
      it("lists workspaces and their seller accounts", async () => {
        expect(await reader().listWorkspaces()).toHaveLength(2);
        expect(await reader().listSellerAccounts(workspaces().agency.id)).toHaveLength(5);
        expect(await reader().listSellerAccounts()).toHaveLength(6);
      });

      it("returns undefined for unknown ids", async () => {
        expect(await reader().getWorkspace("nope")).toBeUndefined();
        expect(await reader().getProduct("nope")).toBeUndefined();
        expect(await reader().getProposal("nope")).toBeUndefined();
      });

      it("returns records exactly as they were seeded", async () => {
        const { proposals, agentRuns, products, productFacts, campaigns, adGroups, targets, reviews } = dataset();
        const decided = proposals.find((proposal) => proposal.decidedBy && proposal.reviewId)!;
        expect(await reader().getProposal(decided.id)).toEqual(decided);
        expect(await reader().getAgentRun(agentRuns[0]!.id)).toEqual(agentRuns[0]);
        expect(await reader().getProduct(products[0]!.id)).toEqual(products[0]);
        expect(await reader().getProductFacts(productFacts[0]!.productId)).toEqual(productFacts[0]);
        expect(await reader().getReview(reviews[0]!.id)).toEqual(reviews[0]);
        expect(await reader().getCampaign(campaigns[0]!.id)).toEqual(campaigns[0]);
        expect(await reader().getAdGroup(adGroups[0]!.id)).toEqual(adGroups[0]);
        for (const kind of ["keyword", "product", "auto"]) {
          const target = targets.find((candidate) => candidate.kind === kind)!;
          expect(await reader().getTarget(target.id)).toEqual(target);
        }
        const { merchant } = workspaces();
        expect(await reader().listMembers(merchant.id)).toEqual(dataset().members.filter((member) => member.workspaceId === merchant.id));
        expect(await reader().listAuditEvents({ workspaceId: merchant.id, limit: 25 })).toEqual(
          dataset().auditEvents.filter((event) => event.workspaceId === merchant.id).slice(0, 25),
        );
      });

      it("filters products by account, category and status", async () => {
        const all = await reader().listProducts({ sellerAccountId: merchantAccount().id });
        const category = all[0]!.category;
        const inCategory = await reader().listProducts({ sellerAccountId: merchantAccount().id, category, status: "active" });
        expect(inCategory.length).toBeGreaterThan(0);
        expect(inCategory.every((product) => product.category === category && product.status === "active")).toBe(true);
      });

      it("returns listing versions newest first", async () => {
        const product = dataset().products.find(
          (candidate) => dataset().listingVersions.filter((version) => version.productId === candidate.id).length > 1,
        );
        const versions = await reader().listListingVersions(product!.id);
        expect(versions.map((version) => version.version)).toEqual(versions.map((version) => version.version).sort((a, b) => b - a));
      });

      it("filters proposals by status, newest first", async () => {
        const { agency } = workspaces();
        const pending = await reader().listProposals({ workspaceId: agency.id, status: "pending_approval" });
        expect(pending.length).toBeGreaterThan(0);
        expect(pending.every((proposal) => proposal.status === "pending_approval" && proposal.workspaceId === agency.id)).toBe(true);
        const created = pending.map((proposal) => proposal.createdAt);
        expect(created).toEqual([...created].sort().reverse());
      });

      it("returns typed metrics for a date range, oldest first", async () => {
        const rows = await reader().listMetricsDaily({
          sellerAccountId: merchantAccount().id,
          entityType: "campaign",
          range: { from: "2026-10-01", to: "2026-10-07" },
        });
        const campaigns = await reader().listCampaigns(merchantAccount().id);
        expect(rows).toHaveLength(campaigns.length * 7);
        expect(rows[0]!.date).toBe("2026-10-01");
        expect(rows.at(-1)!.date).toBe("2026-10-07");
        expect(rows.every((row) => row.entityType === "campaign" && row.spend >= 0)).toBe(true);
      });

      it("returns every metrics row of a long range, past one page", async () => {
        const rows = await reader().listMetricsDaily({ sellerAccountId: merchantAccount().id, entityType: "product" });
        const expected = dataset().metricsDaily.filter(
          (row) => row.sellerAccountId === merchantAccount().id && row.entityType === "product",
        );
        expect(expected.length).toBeGreaterThan(1000);
        expect(rows).toHaveLength(expected.length);
      });

      it("limits activity feeds", async () => {
        const { merchant } = workspaces();
        expect(await reader().listAuditEvents({ workspaceId: merchant.id, limit: 10 })).toHaveLength(10);
        expect(await reader().listAgentRuns({ workspaceId: merchant.id, limit: 3 })).toHaveLength(3);
      });

      it("names the workspace owner as the acting member", async () => {
        const { merchant } = workspaces();
        expect(await reader().getActingMember(merchant.id)).toEqual(memberOf(merchant.id, "owner"));
      });
    });

    describe("proposal decisions", () => {
      it("approves a pending proposal and writes an AuditEvent", async () => {
        const { source } = await setup();
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
        expect(dataset().auditEvents.some((existing) => existing.id === event!.id)).toBe(false);
      });

      it("approves with edits, keeping the agent's diff and logging the edit", async () => {
        const { source } = await setup();
        const { proposal, owner } = pendingOf("bid_change");
        const approved = await source.approveProposal({ proposalId: proposal.id, memberId: owner.id, edits: [{ path: "bid", after: 0.77 }] });

        expect(approved.diff).toEqual([{ ...proposal.diff[0], after: 0.77 }]);
        expect(approved.originalDiff).toEqual(proposal.diff);
        expect(await source.getProposal(proposal.id)).toEqual(approved);
        const [approvedEvent, editedEvent] = await latestEvents(source, proposal.workspaceId, 2);
        expect(approvedEvent).toMatchObject({ action: "proposal.approved", metadata: { edited: true } });
        expect(editedEvent).toMatchObject({
          action: "proposal.edited",
          metadata: { changes: [{ path: "bid", agent: proposal.diff[0]!.after, final: 0.77 }] },
        });
      });

      it("refuses approvals that fail compliance, writing nothing", async () => {
        const { source } = await setup();
        const { proposal, owner } = pendingOf("listing_update");
        expect(proposal.diff.map((entry) => entry.path)).toContain("title");
        const before = await latestEvents(source, proposal.workspaceId, 1);
        await expect(
          source.approveProposal({ proposalId: proposal.id, memberId: owner.id, edits: [{ path: "title", after: "#1 Best Seller Bottle" }] }),
        ).rejects.toMatchObject({ code: "compliance_failed" });
        expect((await source.getProposal(proposal.id))?.status).toBe("pending_approval");
        expect(await latestEvents(source, proposal.workspaceId, 1)).toEqual(before);
      });

      it("approves a blocked listing once the prohibited claim is edited out", async () => {
        const { source } = await setup();
        const blocked = dataset().proposals.find((candidate) => {
          const review = dataset().reviews.find((r) => r.id === candidate.reviewId);
          return candidate.status === "pending_approval" && review?.report.findings.some((finding) => finding.severity === "error");
        })!;
        const owner = memberOf(blocked.workspaceId, "owner");
        const claims = dataset().productFacts.find((facts) => facts.productId === blocked.target.id)!.prohibitedClaims;
        await expect(source.approveProposal({ proposalId: blocked.id, memberId: owner.id })).rejects.toMatchObject({ code: "compliance_failed" });

        const bullets = blocked.diff.find((entry) => entry.path === "bullets")!.after as string[];
        const cleaned = bullets.map((bullet) => claims.reduce((text, claim) => text.replace(new RegExp(claim, "i"), "Built for daily use"), bullet));
        const approved = await source.approveProposal({ proposalId: blocked.id, memberId: owner.id, edits: [{ path: "bullets", after: cleaned }] });
        expect(approved.status).toBe("approved");
      });

      it("rejects only with a reason and retires the agent's listing draft", async () => {
        const { source } = await setup();
        const { proposal, owner } = pendingOf("listing_update");
        await expect(source.rejectProposal({ proposalId: proposal.id, memberId: owner.id, reason: "   " })).rejects.toMatchObject({
          code: "invalid_input",
        });

        const rejected = await source.rejectProposal({ proposalId: proposal.id, memberId: owner.id, reason: "Off brand." });
        expect(rejected).toMatchObject({ status: "rejected", decisionNote: "Off brand." });
        expect(await source.getProposal(proposal.id)).toEqual(rejected);
        const [event] = await latestEvents(source, proposal.workspaceId, 1);
        expect(event).toMatchObject({ action: "proposal.rejected", metadata: { reason: "Off brand." } });

        const review = await source.getReview(proposal.reviewId!);
        const draft = (await source.listListingVersions(proposal.target.id)).find((version) => version.id === review?.listingVersionId);
        expect(draft?.status).toBe("rejected");
      });

      it("snoozes out of the queue until the time passes", async () => {
        const { source, advanceHours } = await setup();
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
        const { source } = await setup();
        const { proposal, owner } = pendingOf("bid_change");
        const viewer = memberOf(proposal.workspaceId, "viewer");
        const otherOwner = dataset().members.find((member) => member.workspaceId !== proposal.workspaceId && member.role === "owner")!;

        await expect(source.approveProposal({ proposalId: proposal.id, memberId: viewer.id })).rejects.toMatchObject({ code: "forbidden" });
        await expect(source.approveProposal({ proposalId: proposal.id, memberId: otherOwner.id })).rejects.toMatchObject({ code: "forbidden" });
        await expect(source.approveProposal({ proposalId: "nope", memberId: owner.id })).rejects.toMatchObject({ code: "not_found" });

        await source.approveProposal({ proposalId: proposal.id, memberId: owner.id });
        await expect(source.rejectProposal({ proposalId: proposal.id, memberId: owner.id, reason: "Changed my mind" })).rejects.toMatchObject({
          code: "not_pending",
        });
      });
    });

    describe("listing optimizer runs", () => {
      const subject = () => {
        const { merchant } = workspaces();
        const busy = new Set(
          dataset()
            .proposals.filter((proposal) => proposal.status === "pending_approval")
            .map((proposal) => proposal.target.id),
        );
        // An active merchant product with a live listing and no listing proposal waiting.
        const product = dataset().products.find(
          (candidate) =>
            candidate.sellerAccountId === merchantAccount().id &&
            candidate.status === "active" &&
            !busy.has(candidate.id) &&
            dataset().listingVersions.some((version) => version.productId === candidate.id && version.status === "live"),
        )!;
        const live = dataset().listingVersions.find((version) => version.productId === product.id && version.status === "live")!;
        return { merchant, product, live, owner: memberOf(merchant.id, "owner"), viewer: memberOf(merchant.id, "viewer") };
      };

      it("starts a running run with a planned timeline and audits it", async () => {
        const { source } = await setup();
        const { merchant, product, owner } = subject();
        const run = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });

        expect(AgentRunSchema.safeParse(run).success).toBe(true);
        expect(run).toMatchObject({ status: "running", trigger: "manual", subject: { type: "product", id: product.id } });
        expect(await source.listAgentRuns({ workspaceId: merchant.id, subjectId: product.id })).toEqual([run]);
        const [event] = await source.listAuditEvents({ workspaceId: merchant.id, limit: 1 });
        expect(event).toMatchObject({ action: "agent_run.started", entity: { id: run.id }, metadata: { requestedBy: owner.id } });
      });

      it("files a pending proposal with a proposed version and review on completion", async () => {
        const { source } = await setup();
        const { merchant, product, live, owner } = subject();
        const run = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });
        const { run: finished, proposal } = await source.completeAgentRun(run.id);

        expect(finished).toMatchObject({ status: "succeeded", proposalIds: [proposal!.id] });
        expect(finished.steps?.at(-1)).toMatchObject({ kind: "awaiting_approval", proposalId: proposal!.id });
        expect(proposal).toMatchObject({
          type: "listing_update",
          status: "pending_approval",
          target: { type: "product", id: product.id },
          createdBy: { type: "agent", agent: "listing_writer", agentRunId: run.id },
          scores: { rubric: 88 },
        });

        const review = await source.getReview(proposal!.reviewId!);
        expect(review).toMatchObject({ overall: 88, reviewer: { agent: "listing_reviewer" } });
        const [newest] = await source.listListingVersions(product.id);
        expect(newest).toMatchObject({ id: review!.listingVersionId, status: "proposed" });
        // The live listing is untouched until someone approves.
        expect((await source.listListingVersions(product.id)).find((version) => version.status === "live")).toEqual(live);

        const pending = await source.listProposals({ workspaceId: merchant.id, status: "pending_approval" });
        expect(pending[0]?.id).toBe(proposal!.id);
        const events = await source.listAuditEvents({ workspaceId: merchant.id, limit: 2 });
        expect(events.map((event) => event.action).sort()).toEqual(["agent_run.finished", "proposal.created"]);

        // Completing again is a no-op that returns the same result.
        expect(await source.completeAgentRun(run.id)).toEqual({ run: finished, proposal });
      });

      it("refuses viewers, a second run in flight, and products with a proposal waiting", async () => {
        const { source } = await setup();
        const { product, owner, viewer } = subject();
        await expect(source.startListingOptimizer({ productId: product.id, memberId: viewer.id })).rejects.toMatchObject({ code: "forbidden" });

        const run = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });
        await expect(source.startListingOptimizer({ productId: product.id, memberId: owner.id })).rejects.toMatchObject({ code: "conflict" });
        await source.completeAgentRun(run.id);
        await expect(source.startListingOptimizer({ productId: product.id, memberId: owner.id })).rejects.toMatchObject({ code: "conflict" });
        await expect(source.completeAgentRun("nope")).rejects.toMatchObject({ code: "not_found" });
      });
    });
  });
}
