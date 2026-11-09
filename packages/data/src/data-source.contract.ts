import {
  AgentRunSchema,
  ProductTypeSchema,
  ProductTypeSummarySchema,
  parseNewCampaignPlan,
  parseNewListing,
  type AgentRun,
  type CampaignBrief,
  type ImportedListing,
  type NewListingBrief,
} from "@app/core";
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

      it("returns each account's target ACoS", async () => {
        const accounts = await reader().listSellerAccounts();
        expect(accounts.map((account) => account.targetAcos)).toEqual(dataset().sellerAccounts.map((account) => account.targetAcos));
        expect(await reader().getSellerAccount(merchantAccount().id)).toEqual(merchantAccount());
      });

      it("returns the newest review of each live listing", async () => {
        const { products, listingVersions, reviews } = dataset();
        const accountProducts = new Set(products.filter((p) => p.sellerAccountId === merchantAccount().id).map((p) => p.id));
        const expected = listingVersions
          .filter((version) => version.status === "live" && accountProducts.has(version.productId))
          .flatMap((version) => {
            const [review] = reviews
              .filter((candidate) => candidate.listingVersionId === version.id)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
            return review ? [{ productId: version.productId, review }] : [];
          })
          .sort((a, b) => a.productId.localeCompare(b.productId));

        expect(expected.length).toBeGreaterThan(0);
        expect(await reader().listLiveListingReviews(merchantAccount().id)).toEqual(expected);
        expect(await reader().listLiveListingReviews("nope")).toEqual([]);
      });

      it("reports the days an account has metrics for", async () => {
        const dates = dataset()
          .metricsDaily.filter((row) => row.sellerAccountId === merchantAccount().id)
          .map((row) => row.date)
          .sort();
        expect(await reader().getMetricsDateRange(merchantAccount().id)).toEqual({ from: dates[0], to: dates.at(-1) });
        expect(await reader().getMetricsDateRange("nope")).toBeUndefined();
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
          code: "invalid_transition",
          message: "Only pending proposals can be rejected. This one is already approved.",
        });
      });
    });

    describe("publishing", () => {
      it("refuses to publish a proposal nobody approved, writing nothing", async () => {
        const { source } = await setup();
        const { proposal, owner } = pendingOf("bid_change");
        const before = await latestEvents(source, proposal.workspaceId, 1);

        await expect(source.publishProposal({ proposalId: proposal.id, memberId: owner.id })).rejects.toMatchObject({
          code: "invalid_transition",
          message: "Only approved proposals can be published. This one is still pending approval.",
        });
        expect(await source.getProposal(proposal.id)).toEqual(proposal);
        expect(await latestEvents(source, proposal.workspaceId, 1)).toEqual(before);

        await source.rejectProposal({ proposalId: proposal.id, memberId: owner.id, reason: "Too aggressive." });
        await expect(source.publishProposal({ proposalId: proposal.id, memberId: owner.id })).rejects.toMatchObject({
          code: "invalid_transition",
          message: "Only approved proposals can be published. This one was rejected.",
        });
      });

      it("publishes an approved proposal once and audits it", async () => {
        const { source, advanceHours } = await setup();
        const { proposal, owner } = pendingOf("bid_change");
        const approved = await source.approveProposal({ proposalId: proposal.id, memberId: owner.id });
        advanceHours(1);

        const published = await source.publishProposal({ proposalId: proposal.id, memberId: owner.id });
        expect(published).toEqual({ ...approved, status: "applied", appliedAt: "2026-10-31T10:00:00.000Z" });
        expect(await source.getProposal(proposal.id)).toEqual(published);
        const [event] = await latestEvents(source, proposal.workspaceId, 1);
        expect(event).toMatchObject({
          action: "proposal.applied",
          at: "2026-10-31T10:00:00.000Z",
          actor: { type: "member", memberId: owner.id },
          entity: { type: "proposal", id: proposal.id },
          metadata: { type: "bid_change" },
        });

        await expect(source.publishProposal({ proposalId: proposal.id, memberId: owner.id })).rejects.toMatchObject({
          code: "invalid_transition",
          message: "Only approved proposals can be published. This one was already published to Amazon.",
        });
      });

      it("refuses viewers and unknown proposals", async () => {
        const { source } = await setup();
        const { proposal, owner } = pendingOf("bid_change");
        await source.approveProposal({ proposalId: proposal.id, memberId: owner.id });
        const viewer = memberOf(proposal.workspaceId, "viewer");
        await expect(source.publishProposal({ proposalId: proposal.id, memberId: viewer.id })).rejects.toMatchObject({ code: "forbidden" });
        await expect(source.publishProposal({ proposalId: "nope", memberId: owner.id })).rejects.toMatchObject({ code: "not_found" });
        expect((await source.getProposal(proposal.id))?.status).toBe("approved");
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

    describe("report branding", () => {
      const branding = { displayName: "Acme Growth", primaryColor: "#123456", accentColor: "#abcdef", logo: "data:image/png;base64,iVBORw0KGgo=" };

      it("reads each workspace's branding as seeded", async () => {
        const { merchant, agency } = workspaces();
        expect(agency.branding).toBeDefined();
        expect(await reader().getWorkspace(agency.id)).toEqual(agency);
        expect(await reader().getWorkspace(merchant.id)).toEqual(merchant);
      });

      it("lets an owner set and clear it, logging the change without the logo", async () => {
        const { source } = await setup();
        const { merchant } = workspaces();
        const owner = memberOf(merchant.id, "owner");

        const updated = await source.updateWorkspaceBranding({ workspaceId: merchant.id, memberId: owner.id, branding });
        expect(updated).toEqual({ ...merchant, branding });
        expect(await source.getWorkspace(merchant.id)).toEqual(updated);
        const [event] = await latestEvents(source, merchant.id, 1);
        expect(event).toMatchObject({
          action: "settings.updated",
          actor: { type: "member", memberId: owner.id },
          entity: { type: "workspace", id: merchant.id },
          metadata: { setting: "report_branding", branding: { displayName: "Acme Growth", logo: true } },
        });

        await source.updateWorkspaceBranding({ workspaceId: merchant.id, memberId: owner.id, branding: null });
        expect(await source.getWorkspace(merchant.id)).toEqual(merchant);
      });

      it("refuses non-owners, other workspaces and invalid branding", async () => {
        const { source } = await setup();
        const { merchant, agency } = workspaces();
        const owner = memberOf(merchant.id, "owner");
        const write = (memberId: string, workspaceId = merchant.id, value: typeof branding | null = branding) =>
          source.updateWorkspaceBranding({ workspaceId, memberId, branding: value });

        await expect(write(memberOf(merchant.id, "specialist").id)).rejects.toMatchObject({ code: "forbidden" });
        await expect(write(owner.id, agency.id)).rejects.toMatchObject({ code: "forbidden" });
        await expect(write(owner.id, "nope")).rejects.toMatchObject({ code: "not_found" });
        await expect(write(owner.id, merchant.id, { ...branding, primaryColor: "blue" })).rejects.toMatchObject({ code: "invalid_input" });
        expect(await source.getWorkspace(merchant.id)).toEqual(merchant);
      });
    });

    describe("settings", () => {
      const merchantCampaign = () =>
        dataset().campaigns.find(
          (candidate) =>
            candidate.sellerAccountId === merchantAccount().id &&
            candidate.state === "enabled" &&
            candidate.type === "sponsored_products" &&
            candidate.targetingType === "manual",
        )!;

      it("saves guardrails and autonomy for owners only, and approvals follow the caps", async () => {
        const { source } = await setup();
        const account = merchantAccount();
        const owner = memberOf(account.workspaceId, "owner");
        const guardrails = { maxBid: 0.3, maxBidStep: 0.25, maxDailyBudget: 500, maxBudgetStep: 0.5 };

        await expect(
          source.updateSellerAccountSettings({ sellerAccountId: account.id, memberId: memberOf(account.workspaceId, "specialist").id, guardrails }),
        ).rejects.toMatchObject({ code: "forbidden" });
        await expect(
          source.updateSellerAccountSettings({ sellerAccountId: account.id, memberId: owner.id, guardrails: { ...guardrails, maxBid: -1 } }),
        ).rejects.toMatchObject({ code: "invalid_input" });

        const updated = await source.updateSellerAccountSettings({
          sellerAccountId: account.id,
          memberId: owner.id,
          guardrails,
          autonomyByAction: { bid_change: "L2" },
        });
        expect(updated).toEqual({ ...account, guardrails, autonomyByAction: { bid_change: "L2" } });
        expect(await source.getSellerAccount(account.id)).toEqual(updated);
        const [event] = await latestEvents(source, account.workspaceId, 1);
        expect(event).toMatchObject({ action: "settings.updated", entity: { type: "seller_account", id: account.id }, metadata: { setting: "agents" } });

        // A pending bid above the new cap can't be approved any more.
        const bid = dataset().proposals.find(
          (proposal) =>
            proposal.sellerAccountId === account.id &&
            proposal.status === "pending_approval" &&
            proposal.type === "bid_change" &&
            Number(proposal.diff[0]?.after) > guardrails.maxBid,
        )!;
        await expect(source.approveProposal({ proposalId: bid.id, memberId: owner.id })).rejects.toMatchObject({ code: "compliance_failed" });

        await source.updateSellerAccountSettings({ sellerAccountId: account.id, memberId: owner.id, guardrails: null, autonomyByAction: null });
        expect(await source.getSellerAccount(account.id)).toEqual(account);
      });

      it("files nothing at L0, auto-approves at L3, and keeps plans under the bid cap", async () => {
        const { source } = await setup();
        const account = merchantAccount();
        const owner = memberOf(account.workspaceId, "owner");
        const campaign = merchantCampaign();
        const plan = async () => source.completeAgentRun((await source.startCampaignOptimizer({ campaignId: campaign.id, memberId: owner.id })).id);

        await source.updateSellerAccountSettings({ sellerAccountId: account.id, memberId: owner.id, autonomyByAction: { campaign_plan: "L0" } });
        const suggested = await plan();
        expect(suggested.proposal).toBeUndefined();
        expect(suggested.run).toMatchObject({ status: "succeeded", proposalIds: [] });
        expect(suggested.run.steps?.at(-1)?.title).toBe("Suggestions only");

        await source.updateSellerAccountSettings({
          sellerAccountId: account.id,
          memberId: owner.id,
          autonomyByAction: { campaign_plan: "L3" },
          guardrails: { maxBid: 1, maxBidStep: 0.5, maxDailyBudget: 10_000, maxBudgetStep: 1 },
        });
        const { run, proposal } = await plan();
        expect(proposal).toMatchObject({ status: "approved", decidedBy: { type: "system" } });
        expect(run.steps?.at(-1)).toMatchObject({ title: "Auto-approved", proposalId: proposal!.id });
        const bids = proposal!.diff.flatMap((entry) =>
          typeof entry.after === "number" ? [entry.after] : entry.after && typeof entry.after === "object" && "bid" in entry.after ? [Number(entry.after.bid)] : [],
        );
        expect(bids.length).toBeGreaterThan(0);
        expect(bids.every((bid) => bid <= 1)).toBe(true);
        const events = await latestEvents(source, account.workspaceId, 3);
        expect(events.map((event) => event.action)).toEqual(["proposal.approved", "proposal.created", "agent_run.finished"]);
        expect(events[0]).toMatchObject({ actor: { type: "system" } });
      });

      it("the kill switch cancels runs in flight and stops agents until an owner resumes", async () => {
        const { source } = await setup();
        const { merchant } = workspaces();
        const owner = memberOf(merchant.id, "owner");
        const specialist = memberOf(merchant.id, "specialist");
        const running = dataset().agentRuns.filter((run) => run.workspaceId === merchant.id && run.status === "running");
        expect(running.length).toBeGreaterThan(0);

        await expect(source.setAgentsPaused({ workspaceId: merchant.id, memberId: memberOf(merchant.id, "viewer").id, paused: true })).rejects.toMatchObject({
          code: "forbidden",
        });
        const paused = await source.setAgentsPaused({ workspaceId: merchant.id, memberId: specialist.id, paused: true });
        expect(paused).toMatchObject({ agentsPausedBy: specialist.id, agentsPausedAt: "2026-10-31T09:00:00.000Z" });
        expect(await source.getWorkspace(merchant.id)).toEqual(paused);
        for (const run of running) expect(await source.getAgentRun(run.id)).toMatchObject({ status: "cancelled" });
        const [event] = await latestEvents(source, merchant.id, 1 + running.length).then((events) => events.filter((e) => e.action === "agents.paused"));
        expect(event).toMatchObject({ actor: { type: "member", memberId: specialist.id }, metadata: { cancelledRuns: running.map((run) => run.id) } });

        await expect(source.startCampaignOptimizer({ campaignId: merchantCampaign().id, memberId: owner.id })).rejects.toMatchObject({ code: "conflict" });
        await expect(source.setAgentsPaused({ workspaceId: merchant.id, memberId: specialist.id, paused: false })).rejects.toMatchObject({ code: "forbidden" });

        const resumed = await source.setAgentsPaused({ workspaceId: merchant.id, memberId: owner.id, paused: false });
        expect(resumed).toEqual(merchant);
        expect((await source.startCampaignOptimizer({ campaignId: merchantCampaign().id, memberId: owner.id })).status).toBe("running");
      });

      it("connects a new seller account for owners", async () => {
        const { source } = await setup();
        const { agency } = workspaces();
        const owner = memberOf(agency.id, "owner");
        await expect(
          source.connectSellerAccount({ workspaceId: agency.id, memberId: memberOf(agency.id, "specialist").id, name: "Nope", marketplace: "US" }),
        ).rejects.toMatchObject({ code: "forbidden" });

        const account = await source.connectSellerAccount({ workspaceId: agency.id, memberId: owner.id, name: " Fjordline FR ", marketplace: "FR" });
        expect(account).toMatchObject({ workspaceId: agency.id, name: "Fjordline FR", marketplace: "FR", currency: "EUR", autonomyLevel: "L1" });
        expect(account.sellerId).toMatch(/^A[0-9A-Z]{13}$/);
        expect(await source.getSellerAccount(account.id)).toEqual(account);
        expect((await source.listSellerAccounts(agency.id)).map((candidate) => candidate.id)).toContain(account.id);
        const [event] = await latestEvents(source, agency.id, 1);
        expect(event).toMatchObject({ action: "seller_account.connected", entity: { id: account.id }, metadata: { marketplace: "FR" } });
      });

      it("lets owners invite, change and remove members, but not themselves", async () => {
        const { source } = await setup();
        const { agency } = workspaces();
        const owner = memberOf(agency.id, "owner");
        const accountId = dataset().sellerAccounts.find((account) => account.workspaceId === agency.id)!.id;

        await expect(
          source.inviteMember({ workspaceId: agency.id, memberId: owner.id, name: "Ida Berg", email: "ida@client.example.com", role: "client_approver", sellerAccountIds: [] }),
        ).rejects.toMatchObject({ code: "invalid_input" });
        const invited = await source.inviteMember({
          workspaceId: agency.id,
          memberId: owner.id,
          name: "Ida Berg",
          email: "Ida@Client.example.com",
          role: "client_approver",
          sellerAccountIds: [accountId],
        });
        expect(invited).toMatchObject({ email: "ida@client.example.com", role: "client_approver", sellerAccountIds: [accountId] });
        expect(await source.listMembers(agency.id)).toContainEqual(invited);
        await expect(
          source.inviteMember({ workspaceId: agency.id, memberId: owner.id, name: "Ida", email: "ida@client.example.com", role: "viewer", sellerAccountIds: [] }),
        ).rejects.toMatchObject({ code: "conflict" });

        const promoted = await source.updateMember({ memberId: owner.id, targetMemberId: invited.id, role: "specialist", sellerAccountIds: [] });
        expect(promoted).toMatchObject({ role: "specialist", sellerAccountIds: [] });
        await expect(source.updateMember({ memberId: owner.id, targetMemberId: owner.id, role: "viewer", sellerAccountIds: [] })).rejects.toMatchObject({
          code: "conflict",
        });
        await expect(source.removeMember({ memberId: invited.id, targetMemberId: owner.id })).rejects.toMatchObject({ code: "forbidden" });

        await source.removeMember({ memberId: owner.id, targetMemberId: invited.id });
        expect((await source.listMembers(agency.id)).map((member) => member.id)).not.toContain(invited.id);
        const actions = (await latestEvents(source, agency.id, 3)).map((event) => event.action);
        expect(actions).toEqual(["member.removed", "member.updated", "member.invited"]);
      });
    });

    describe("campaign optimizer runs", () => {
      const subject = () => {
        const { merchant } = workspaces();
        // The merchant's first enabled manual Sponsored Products campaign: it gets bids and keywords.
        const campaign = dataset().campaigns.find(
          (candidate) =>
            candidate.sellerAccountId === merchantAccount().id &&
            candidate.state === "enabled" &&
            candidate.type === "sponsored_products" &&
            candidate.targetingType === "manual",
        )!;
        const paused = dataset().campaigns.find((candidate) => candidate.state === "paused")!;
        return { merchant, campaign, paused, owner: memberOf(merchant.id, "owner"), viewer: memberOf(merchant.id, "viewer") };
      };

      it("starts a running run on a campaign and audits it", async () => {
        const { source } = await setup();
        const { merchant, campaign, owner } = subject();
        const run = await source.startCampaignOptimizer({ campaignId: campaign.id, memberId: owner.id });

        expect(AgentRunSchema.safeParse(run).success).toBe(true);
        expect(run).toMatchObject({ agent: "campaign_optimizer", status: "running", subject: { type: "campaign", id: campaign.id } });
        expect(run.steps?.some((step) => step.kind === "plan" && step.changes.length > 0)).toBe(true);
        expect(await source.listAgentRuns({ workspaceId: merchant.id, subjectId: campaign.id })).toEqual([run]);
        const [event] = await source.listAuditEvents({ workspaceId: merchant.id, limit: 1 });
        expect(event).toMatchObject({ action: "agent_run.started", entity: { id: run.id }, metadata: { requestedBy: owner.id } });
      });

      it("files a pending campaign plan that is approved like any proposal, lines skipped", async () => {
        const { source } = await setup();
        const { merchant, campaign, owner } = subject();
        const run = await source.startCampaignOptimizer({ campaignId: campaign.id, memberId: owner.id });
        const { run: finished, proposal } = await source.completeAgentRun(run.id);

        expect(finished).toMatchObject({ status: "succeeded", proposalIds: [proposal!.id] });
        expect(finished.steps?.at(-1)).toMatchObject({ kind: "awaiting_approval", proposalId: proposal!.id });
        expect(proposal).toMatchObject({
          type: "campaign_plan",
          status: "pending_approval",
          target: { type: "campaign", id: campaign.id },
          createdBy: { type: "agent", agent: "campaign_optimizer", agentRunId: run.id },
        });
        expect(proposal!.diff).toEqual(run.steps!.flatMap((step) => (step.kind === "plan" ? step.changes : [])));
        expect((await source.listProposals({ workspaceId: merchant.id, status: "pending_approval" }))[0]?.id).toBe(proposal!.id);
        expect(await source.completeAgentRun(run.id)).toEqual({ run: finished, proposal });

        // Skip the first line by setting it back to what it was.
        const [skipped, ...kept] = proposal!.diff;
        const approved = await source.approveProposal({
          proposalId: proposal!.id,
          memberId: owner.id,
          edits: [{ path: skipped!.path, after: skipped!.before }],
        });
        expect(approved).toMatchObject({ status: "approved", diff: kept, originalDiff: proposal!.diff });
        const [approvedEvent, editedEvent] = await latestEvents(source, merchant.id, 2);
        expect(approvedEvent).toMatchObject({ action: "proposal.approved", metadata: { edited: true } });
        expect(editedEvent).toMatchObject({
          action: "proposal.edited",
          metadata: { changes: [{ path: skipped!.path, agent: skipped!.after, final: skipped!.before }] },
        });

        // Approving records the decision; Amazon and the live campaign are untouched until it is applied.
        const bidLine = kept.find((entry) => entry.path.startsWith("targets."));
        const targetId = bidLine?.path.split(".")[1];
        if (targetId) expect((await source.getTarget(targetId))?.bid).toBe(bidLine!.before);
      });

      it("refuses viewers, paused campaigns, a second run in flight and a second plan", async () => {
        const { source } = await setup();
        const { campaign, paused, owner, viewer } = subject();
        const pausedOwner = memberOf(dataset().sellerAccounts.find((account) => account.id === paused.sellerAccountId)!.workspaceId, "owner");
        await expect(source.startCampaignOptimizer({ campaignId: campaign.id, memberId: viewer.id })).rejects.toMatchObject({ code: "forbidden" });
        await expect(source.startCampaignOptimizer({ campaignId: paused.id, memberId: pausedOwner.id })).rejects.toMatchObject({ code: "conflict" });
        await expect(source.startCampaignOptimizer({ campaignId: "nope", memberId: owner.id })).rejects.toMatchObject({ code: "not_found" });

        const run = await source.startCampaignOptimizer({ campaignId: campaign.id, memberId: owner.id });
        await expect(source.startCampaignOptimizer({ campaignId: campaign.id, memberId: owner.id })).rejects.toMatchObject({ code: "conflict" });
        await source.completeAgentRun(run.id);
        await expect(source.startCampaignOptimizer({ campaignId: campaign.id, memberId: owner.id })).rejects.toMatchObject({ code: "conflict" });
      });
    });

    describe("campaign strategist runs", () => {
      const subject = () => {
        const { merchant } = workspaces();
        const account = merchantAccount();
        const withKeywords = new Set(dataset().productFacts.filter((facts) => facts.targetKeywords.length > 0).map((facts) => facts.productId));
        const active = dataset().products.filter((product) => product.sellerAccountId === account.id && product.status === "active");
        const products = active.filter((product) => withKeywords.has(product.id)).slice(0, 2);
        const brief: CampaignBrief = { goal: "launch", productIds: products.map((product) => product.id), dailyBudget: 60, targetAcos: 0.4, breakEvenAcos: 0.32 };
        return { merchant, account, brief, owner: memberOf(merchant.id, "owner"), viewer: memberOf(merchant.id, "viewer") };
      };

      it("plans the wizard's brief as a running run on the seller account and audits it", async () => {
        const { source } = await setup();
        const { merchant, account, brief, owner } = subject();
        const run = await source.startCampaignStrategist({ sellerAccountId: account.id, memberId: owner.id, brief });

        expect(AgentRunSchema.safeParse(run).success).toBe(true);
        expect(run).toMatchObject({ agent: "campaign_strategist", status: "running", subject: { type: "seller_account", id: account.id } });
        const planned = parseNewCampaignPlan(run.steps!.flatMap((step) => (step.kind === "plan" ? step.changes : [])));
        expect(planned.brief).toEqual(brief);
        expect(planned.campaigns.map((campaign) => campaign.role)).toContain("performance");
        expect(await source.getAgentRun(run.id)).toEqual(run);
        const [event] = await source.listAuditEvents({ workspaceId: merchant.id, limit: 1 });
        expect(event).toMatchObject({ action: "agent_run.started", entity: { id: run.id }, metadata: { requestedBy: owner.id, goal: "launch" } });
      });

      it("files a pending new_campaign proposal in the inbox, without creating any campaign", async () => {
        const { source } = await setup();
        const { merchant, account, brief, owner } = subject();
        const campaignsBefore = await source.listCampaigns(account.id);
        const run = await source.startCampaignStrategist({ sellerAccountId: account.id, memberId: owner.id, brief });
        const { run: finished, proposal } = await source.completeAgentRun(run.id);

        expect(finished).toMatchObject({ status: "succeeded", proposalIds: [proposal!.id] });
        expect(finished.steps?.at(-1)).toMatchObject({ kind: "awaiting_approval", proposalId: proposal!.id });
        expect(proposal).toMatchObject({
          type: "new_campaign",
          status: "pending_approval",
          // Above breakeven on purpose: a launch.
          risk: "high",
          target: { type: "seller_account", id: account.id },
          createdBy: { type: "agent", agent: "campaign_strategist", agentRunId: run.id },
        });
        expect(proposal!.diff).toEqual(run.steps!.flatMap((step) => (step.kind === "plan" ? step.changes : [])));
        const inbox = await source.listProposals({ workspaceId: merchant.id, status: "pending_approval", type: "new_campaign" });
        expect(inbox.map((candidate) => candidate.id)).toEqual([proposal!.id]);
        expect(await source.completeAgentRun(run.id)).toEqual({ run: finished, proposal });
        expect(await source.listCampaigns(account.id)).toEqual(campaignsBefore);

        // New campaign plans aren't edited line by line: approve or reject them whole.
        await expect(
          source.approveProposal({ proposalId: proposal!.id, memberId: owner.id, edits: [{ path: "brief", after: null }] }),
        ).rejects.toMatchObject({ code: "invalid_input" });
        expect(await source.approveProposal({ proposalId: proposal!.id, memberId: owner.id })).toMatchObject({ status: "approved" });
      });

      it("refuses viewers, other accounts' or unknown products, a budget too small to split and a second run in flight", async () => {
        const { source } = await setup();
        const { account, brief, owner, viewer } = subject();
        const start = (overrides: Partial<CampaignBrief>, memberId = owner.id) =>
          source.startCampaignStrategist({ sellerAccountId: account.id, memberId, brief: { ...brief, ...overrides } });
        const elsewhere = dataset().products.find((product) => product.sellerAccountId !== account.id)!;

        await expect(start({}, viewer.id)).rejects.toMatchObject({ code: "forbidden" });
        await expect(start({ productIds: [elsewhere.id] })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(start({ productIds: ["nope"] })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(start({ dailyBudget: 2 })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(source.startCampaignStrategist({ sellerAccountId: "nope", memberId: owner.id, brief })).rejects.toMatchObject({ code: "not_found" });

        const run = await start({});
        await expect(start({})).rejects.toMatchObject({ code: "conflict" });
        await source.completeAgentRun(run.id);
        // Several plans can wait at once; only runs are one at a time.
        await expect(start({ goal: "profit", targetAcos: 0.22 })).resolves.toMatchObject({ status: "running" });
      });
    });

    describe("product types", () => {
      it("searches product types and serves their attribute schemas", async () => {
        const found = await reader().searchProductTypes({ marketplace: "US", keywords: "insulated water bottle" });
        expect(found[0]).toMatchObject({ name: "BOTTLE", displayName: "Water Bottle" });
        expect(found.every((summary) => ProductTypeSummarySchema.safeParse(summary).success)).toBe(true);
        const all = await reader().searchProductTypes({ marketplace: "US" });
        expect(all.length).toBeGreaterThan(10);
        expect(all.map((summary) => summary.name)).toContain("BOTTLE");
        expect(await reader().searchProductTypes({ marketplace: "US", keywords: "zeppelin" })).toEqual([]);

        const bottle = await reader().getProductType({ marketplace: "US", productType: "BOTTLE" });
        expect(ProductTypeSchema.safeParse(bottle).success).toBe(true);
        const names = (requirement: string) => bottle!.attributes.filter((attribute) => attribute.requirement === requirement).map((attribute) => attribute.name);
        expect(names("required")).toEqual(expect.arrayContaining(["item_name", "brand", "bullet_point", "main_product_image_locator", "capacity"]));
        expect(names("recommended")).toEqual(expect.arrayContaining(["product_description", "generic_keyword", "color"]));
        expect(await reader().getProductType({ marketplace: "US", productType: "NOPE" })).toBeUndefined();
      });
    });

    describe("catalog sync", () => {
      const listing = (sku: string, overrides: Partial<ImportedListing> = {}): ImportedListing => ({
        asin: `B0SYNC${sku.slice(-4)}`,
        sku,
        title: `Canvas Tote ${sku}`,
        brand: "Fieldmade",
        category: "Bags",
        price: 24.99,
        status: "active",
        createdAt: "2026-03-01T12:00:00.000Z",
        copy: { title: `Canvas Tote ${sku}`, bullets: ["Holds 20 lb", "Machine washable"], description: "A tote for errands.", backendKeywords: "bag shopper" },
        ...overrides,
      });
      const withoutCopy = (sku: string) => listing(sku, { copy: undefined });
      const noChanges = { created: 0, updated: 0, unchanged: 0, newVersions: 0 };
      // A fresh account with Amazon's merchant token, as the connect script makes it.
      const connected = async (source: DataSource) => {
        const { merchant } = workspaces();
        const owner = memberOf(merchant.id, "owner");
        return source.connectSellerAccount({ workspaceId: merchant.id, memberId: owner.id, name: "Test seller", marketplace: "US", sellerId: "A2TESTSELLER01" });
      };

      it("imports listings as products, each with a live version written by the system", async () => {
        const { source } = await setup();
        const account = await connected(source);
        expect(account.sellerId).toBe("A2TESTSELLER01");
        const syncedAt = "2026-10-31T03:00:00.000Z";

        const counts = await source.importCatalogListings({ sellerAccountId: account.id, syncedAt, listings: [listing("SYNC-0001"), withoutCopy("SYNC-0002")] });
        expect(counts).toEqual({ ...noChanges, created: 2, newVersions: 1 });

        const products = await source.listProducts({ sellerAccountId: account.id });
        expect(products.map((product) => product.sku).sort()).toEqual(["SYNC-0001", "SYNC-0002"]);
        const tote = products.find((product) => product.sku === "SYNC-0001")!;
        expect(tote).toMatchObject({ asin: "B0SYNC0001", title: "Canvas Tote SYNC-0001", status: "active", price: 24.99, createdAt: "2026-03-01T12:00:00.000Z", syncedAt });
        expect(await source.getProduct(tote.id)).toEqual(tote);
        expect(await source.listListingVersions(tote.id)).toEqual([
          expect.objectContaining({ version: 1, status: "live", bullets: ["Holds 20 lb", "Machine washable"], createdBy: { type: "system" }, createdAt: syncedAt }),
        ]);
        const copyless = products.find((product) => product.sku === "SYNC-0002")!;
        expect(await source.listListingVersions(copyless.id)).toEqual([]);
      });

      it("versions changed copy, keeps unchanged listings and deactivates what Amazon no longer lists", async () => {
        const { source } = await setup();
        const account = await connected(source);
        const first = "2026-10-30T03:00:00.000Z";
        const second = "2026-10-31T03:00:00.000Z";
        const firstCounts = await source.importCatalogListings({
          sellerAccountId: account.id,
          syncedAt: first,
          listings: [listing("SYNC-0001"), listing("SYNC-0002"), listing("SYNC-0003")],
        });
        await source.finishCatalogSync({ sellerAccountId: account.id, syncedAt: first, counts: firstCounts, skipped: {} });

        const reworded = listing("SYNC-0002", { price: 19.99, copy: { ...listing("SYNC-0002").copy!, bullets: ["Holds 25 lb", "Machine washable"] } });
        const counts = await source.importCatalogListings({ sellerAccountId: account.id, syncedAt: second, listings: [listing("SYNC-0001"), reworded] });
        expect(counts).toEqual({ ...noChanges, updated: 1, unchanged: 1, newVersions: 1 });
        expect(await source.finishCatalogSync({ sellerAccountId: account.id, syncedAt: second, counts, skipped: { "No ASIN yet": 1 } })).toEqual({ deactivated: 1 });

        const bySku = new Map((await source.listProducts({ sellerAccountId: account.id })).map((product) => [product.sku, product]));
        expect(bySku.get("SYNC-0001")).toMatchObject({ status: "active", syncedAt: second });
        expect(bySku.get("SYNC-0002")).toMatchObject({ status: "active", price: 19.99, syncedAt: second });
        expect(bySku.get("SYNC-0003")).toMatchObject({ status: "inactive", syncedAt: first });
        const versions = await source.listListingVersions(bySku.get("SYNC-0002")!.id);
        expect(versions.map((version) => [version.version, version.status])).toEqual([
          [2, "live"],
          [1, "superseded"],
        ]);
        expect(versions[0]!.bullets).toEqual(["Holds 25 lb", "Machine washable"]);
        expect((await source.listListingVersions(bySku.get("SYNC-0001")!.id)).map((version) => version.version)).toEqual([1]);

        const [event] = await latestEvents(source, account.workspaceId, 1);
        expect(event).toMatchObject({
          sellerAccountId: account.id,
          actor: { type: "system" },
          action: "catalog.synced",
          entity: { type: "seller_account", id: account.id },
          metadata: { syncedAt: second, ...counts, deactivated: 1, skipped: { "No ASIN yet": 1 } },
        });
      });

      it("refuses unknown accounts and listings the catalog can't hold, writing nothing", async () => {
        const { source } = await setup();
        const syncedAt = "2026-10-31T03:00:00.000Z";
        await expect(source.importCatalogListings({ sellerAccountId: "nope", syncedAt, listings: [listing("SYNC-0001")] })).rejects.toMatchObject({
          code: "not_found",
        });
        await expect(source.finishCatalogSync({ sellerAccountId: "nope", syncedAt, counts: noChanges, skipped: {} })).rejects.toMatchObject({
          code: "not_found",
        });
        const account = await connected(source);
        await expect(
          source.importCatalogListings({ sellerAccountId: account.id, syncedAt, listings: [listing("SYNC-0001"), listing("SYNC-0002", { asin: "0316769487" })] }),
        ).rejects.toMatchObject({ code: "invalid_input" });
        expect(await source.listProducts({ sellerAccountId: account.id })).toEqual([]);
      });
    });

    describe("listing creator runs", () => {
      const subject = () => {
        const { merchant } = workspaces();
        const brief: NewListingBrief = {
          productType: "BOTTLE",
          facts: {
            brand: "Trailcraft",
            productName: "Insulated Water Bottle",
            materials: ["18/8 Stainless Steel", "Silicone"],
            dimensions: { lengthCm: 7.5, widthCm: 7.5, heightCm: 26 },
            certifications: ["BPA free"],
            photos: ["https://images.example.com/bottle-main.jpg", "https://images.example.com/bottle-side.jpg"],
          },
          attributes: { country_of_origin: "Vietnam", capacity: "750 ml", color: "Sage Green" },
        };
        return { merchant, account: merchantAccount(), brief, owner: memberOf(merchant.id, "owner"), viewer: memberOf(merchant.id, "viewer") };
      };
      const planned = (run: AgentRun) => run.steps!.flatMap((step) => (step.kind === "plan" ? step.changes : []));

      it("drafts the wizard's brief as a running run on the seller account and audits it", async () => {
        const { source } = await setup();
        const { merchant, account, brief, owner } = subject();
        const run = await source.startListingCreator({ sellerAccountId: account.id, memberId: owner.id, brief });

        expect(AgentRunSchema.safeParse(run).success).toBe(true);
        expect(run).toMatchObject({ agent: "listing_creator", status: "running", sellerAccountId: account.id });
        // The product doesn't exist yet.
        expect(run.subject).toBeUndefined();
        const { brief: filed, attributes } = parseNewListing(planned(run));
        expect(filed).toEqual(brief);
        expect(attributes.get("brand")).toEqual({ value: "Trailcraft", source: "facts" });
        expect(attributes.get("capacity")).toEqual({ value: "750 ml", source: "seller" });
        expect(attributes.get("item_name")).toMatchObject({ source: "agent", value: expect.stringContaining("Trailcraft Insulated Water Bottle") });
        expect(attributes.get("bullet_point")?.value).toEqual(expect.arrayContaining([expect.stringContaining("BPA free")]));
        expect(run.steps!.map((step) => step.kind)).toEqual(["plan", "draft", "plan", "compliance_check", "review", "awaiting_approval"]);
        expect(await source.getAgentRun(run.id)).toEqual(run);
        const [event] = await source.listAuditEvents({ workspaceId: merchant.id, limit: 1 });
        expect(event).toMatchObject({ action: "agent_run.started", entity: { id: run.id }, metadata: { requestedBy: owner.id, productType: "BOTTLE" } });
      });

      it("files a pending new_listing proposal in the inbox, without adding a product", async () => {
        const { source } = await setup();
        const { merchant, account, brief, owner } = subject();
        const productsBefore = await source.listProducts({ sellerAccountId: account.id });
        const run = await source.startListingCreator({ sellerAccountId: account.id, memberId: owner.id, brief });
        const { run: finished, proposal } = await source.completeAgentRun(run.id);

        expect(finished).toMatchObject({ status: "succeeded", proposalIds: [proposal!.id] });
        expect(finished.steps?.at(-1)).toMatchObject({ kind: "awaiting_approval", proposalId: proposal!.id });
        expect(proposal).toMatchObject({
          type: "new_listing",
          status: "pending_approval",
          risk: "medium",
          title: "New listing: Trailcraft Insulated Water Bottle",
          target: { type: "seller_account", id: account.id },
          createdBy: { type: "agent", agent: "listing_creator", agentRunId: run.id },
        });
        expect(proposal!.scores.rubric).toBe(run.steps!.find((step) => step.kind === "review")!.overall);
        expect(proposal!.diff).toEqual(planned(run));
        const inbox = await source.listProposals({ workspaceId: merchant.id, status: "pending_approval", type: "new_listing" });
        expect(inbox.map((candidate) => candidate.id)).toEqual([proposal!.id]);
        expect(await source.completeAgentRun(run.id)).toEqual({ run: finished, proposal });
        expect(await source.listProducts({ sellerAccountId: account.id })).toEqual(productsBefore);

        // New listings aren't edited line by line: approve or reject them whole.
        await expect(
          source.approveProposal({ proposalId: proposal!.id, memberId: owner.id, edits: [{ path: "brief", after: null }] }),
        ).rejects.toMatchObject({ code: "invalid_input" });
        expect(await source.approveProposal({ proposalId: proposal!.id, memberId: owner.id })).toMatchObject({ status: "approved" });
      });

      it("refuses viewers, unknown product types and briefs that don't fit the product type", async () => {
        const { source } = await setup();
        const { account, brief, owner, viewer } = subject();
        const start = (overrides: Partial<NewListingBrief>, memberId = owner.id) =>
          source.startListingCreator({ sellerAccountId: account.id, memberId, brief: { ...brief, ...overrides } });

        await expect(start({}, viewer.id)).rejects.toMatchObject({ code: "forbidden" });
        await expect(start({ productType: "NOPE" })).rejects.toMatchObject({ code: "invalid_input" });
        // Capacity is required and only the seller knows it.
        await expect(start({ attributes: { country_of_origin: "Vietnam" } })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(start({ attributes: { ...brief.attributes, country_of_origin: "Atlantis" } })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(start({ attributes: { ...brief.attributes, flavor: "Mint" } })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(start({ facts: { ...brief.facts, photos: ["http://images.example.com/bottle.jpg"] } })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(start({ facts: { ...brief.facts, materials: [] } })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(source.startListingCreator({ sellerAccountId: "nope", memberId: owner.id, brief })).rejects.toMatchObject({ code: "not_found" });
      });

      it("drafts several listings at once, alongside the campaign strategist on the same account", async () => {
        const { source } = await setup();
        const { account, brief, owner } = subject();
        const first = await source.startListingCreator({ sellerAccountId: account.id, memberId: owner.id, brief });
        const second = await source.startListingCreator({
          sellerAccountId: account.id,
          memberId: owner.id,
          brief: { ...brief, facts: { ...brief.facts, productName: "Kids Water Bottle" } },
        });
        const products = dataset().products.filter((product) => product.sellerAccountId === account.id && product.status === "active");
        const strategist = await source.startCampaignStrategist({
          sellerAccountId: account.id,
          memberId: owner.id,
          brief: { goal: "grow", productIds: [products[0]!.id], dailyBudget: 40, targetAcos: 0.3 },
        });

        expect([first.status, second.status, strategist.status]).toEqual(["running", "running", "running"]);
        const filed = await Promise.all([first, second].map((run) => source.completeAgentRun(run.id)));
        expect(filed.map(({ proposal }) => proposal?.title)).toEqual(["New listing: Trailcraft Insulated Water Bottle", "New listing: Trailcraft Kids Water Bottle"]);
      });
    });
  });
}
