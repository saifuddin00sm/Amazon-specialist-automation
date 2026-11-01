import { checkProposalCompliance, type AuditEvent, type MetricsDaily, type Proposal } from "@app/core";
import { AgentRunError, type DataSource } from "../data-source";
import {
  approveProposalWrite,
  rejectProposalWrite,
  snoozeProposalWrite,
  type ProposalWriteContext,
  type ProposalWriteResult,
} from "../proposal-writes";
import { completeListingOptimizerRun, startListingOptimizerRun } from "../agents/agent-runs";
import { generateMockDataset, type MockDataset } from "./generate";

export type MockDataSourceOptions = {
  /** Clock for writes and for deciding what is still snoozed. Defaults to the real time. */
  now?: () => Date;
};

/**
 * Serves a generated dataset from memory. Records are frozen so callers can't mutate them; writes
 * replace records copy-on-write and append AuditEvents, like a real backend would.
 */
export function createMockDataSource(dataset: MockDataset, { now = () => new Date() }: MockDataSourceOptions = {}): DataSource {
  deepFreeze(dataset);
  const proposals = [...dataset.proposals];
  const listingVersions = [...dataset.listingVersions];
  const auditEvents = [...dataset.auditEvents];
  const agentRuns = [...dataset.agentRuns];
  const reviews = [...dataset.reviews];
  const nextAuditId = idSequence("aud", auditEvents);
  const nextId = {
    run: idSequence("run", agentRuns),
    listingVersion: idSequence("lv", listingVersions),
    review: idSequence("rev", reviews),
    proposal: idSequence("prop", proposals),
  };

  const byId = <T extends { id: string }>(items: readonly T[], id: string) => items.find((item) => item.id === id);
  const limited = <T>(items: T[], limit?: number) => (limit === undefined ? items : items.slice(0, limit));
  const isSnoozed = (proposal: Proposal, at: string) => proposal.snoozedUntil !== undefined && proposal.snoozedUntil > at;
  const actingMember = (workspaceId: string) =>
    dataset.members.find((member) => member.workspaceId === workspaceId && member.role === "owner");

  const liveListing = (productId: string) =>
    listingVersions.find((version) => version.productId === productId && version.status === "live");

  const writeContext = (proposalId: string, memberId: string): ProposalWriteContext => {
    const proposal = byId(proposals, proposalId);
    const productId = proposal?.target.type === "product" ? proposal.target.id : undefined;
    return {
      proposal,
      member: byId(dataset.members, memberId),
      at: now().toISOString(),
      checkCompliance: (diff) =>
        checkProposalCompliance({
          type: proposal?.type ?? "listing_update",
          diff,
          liveListing: productId ? liveListing(productId) : undefined,
          facts: productId ? dataset.productFacts.find((facts) => facts.productId === productId) : undefined,
        }),
    };
  };

  const appendAudit = (events: Omit<AuditEvent, "id">[]) => {
    // Newest first, like the generated feed.
    for (const draft of events) auditEvents.unshift(deepFreeze<AuditEvent>({ id: nextAuditId(), ...draft }));
  };

  const commit = ({ proposal, events }: ProposalWriteResult): Proposal => {
    const index = proposals.findIndex((candidate) => candidate.id === proposal.id);
    proposals[index] = deepFreeze(proposal);
    appendAudit(events);
    return proposal;
  };

  /** What the agent-run writes read from and append to. */
  const runStore = () => ({
    members: dataset.members,
    sellerAccounts: dataset.sellerAccounts,
    products: dataset.products,
    productFacts: dataset.productFacts,
    listingVersions,
    proposals,
    agentRuns,
    liveListing,
    nextId,
  });

  return {
    async listWorkspaces() {
      return [...dataset.workspaces];
    },
    async getWorkspace(id) {
      return byId(dataset.workspaces, id);
    },
    async listMembers(workspaceId) {
      return dataset.members.filter((member) => member.workspaceId === workspaceId);
    },
    async getActingMember(workspaceId) {
      return actingMember(workspaceId);
    },
    async listSellerAccounts(workspaceId) {
      return workspaceId
        ? dataset.sellerAccounts.filter((account) => account.workspaceId === workspaceId)
        : [...dataset.sellerAccounts];
    },
    async getSellerAccount(id) {
      return byId(dataset.sellerAccounts, id);
    },

    async listProducts({ sellerAccountId, category, status }) {
      return dataset.products.filter(
        (product) =>
          product.sellerAccountId === sellerAccountId &&
          (category === undefined || product.category === category) &&
          (status === undefined || product.status === status),
      );
    },
    async getProduct(id) {
      return byId(dataset.products, id);
    },
    async getProductFacts(productId) {
      return dataset.productFacts.find((facts) => facts.productId === productId);
    },
    async listListingVersions(productId) {
      return listingVersions
        .filter((version) => version.productId === productId)
        .sort((a, b) => b.version - a.version);
    },
    async listReviews(listingVersionId) {
      return reviews.filter((review) => review.listingVersionId === listingVersionId);
    },
    async getReview(id) {
      return byId(reviews, id);
    },

    async listProposals({ workspaceId, sellerAccountId, status, type, snoozed }) {
      const at = now().toISOString();
      return proposals.filter(
        (proposal) =>
          proposal.workspaceId === workspaceId &&
          (sellerAccountId === undefined || proposal.sellerAccountId === sellerAccountId) &&
          (status === undefined || proposal.status === status) &&
          (type === undefined || proposal.type === type) &&
          (snoozed === undefined || isSnoozed(proposal, at) === snoozed),
      );
    },
    async getProposal(id) {
      return byId(proposals, id);
    },
    async approveProposal({ proposalId, memberId, note, edits }) {
      return commit(approveProposalWrite(writeContext(proposalId, memberId), { note, edits }));
    },
    async rejectProposal({ proposalId, memberId, reason }) {
      const result = rejectProposalWrite(writeContext(proposalId, memberId), { reason });
      // The agent's draft behind a rejected listing update will never go live.
      const review = result.proposal.reviewId ? byId(reviews, result.proposal.reviewId) : undefined;
      const draftIndex = listingVersions.findIndex((version) => version.id === review?.listingVersionId);
      const draft = listingVersions[draftIndex];
      if (draft?.status === "proposed") listingVersions[draftIndex] = deepFreeze({ ...draft, status: "rejected" });
      return commit(result);
    },
    async snoozeProposal({ proposalId, memberId, until }) {
      return commit(snoozeProposalWrite(writeContext(proposalId, memberId), { until }));
    },

    async listCampaigns(sellerAccountId) {
      return dataset.campaigns.filter((campaign) => campaign.sellerAccountId === sellerAccountId);
    },
    async getCampaign(id) {
      return byId(dataset.campaigns, id);
    },
    async listAdGroups(campaignId) {
      return dataset.adGroups.filter((adGroup) => adGroup.campaignId === campaignId);
    },
    async getAdGroup(id) {
      return byId(dataset.adGroups, id);
    },
    async listTargets(adGroupId) {
      return dataset.targets.filter((target) => target.adGroupId === adGroupId);
    },
    async getTarget(id) {
      return byId(dataset.targets, id);
    },
    async listMetricsDaily<T extends MetricsDaily["entityType"]>({
      sellerAccountId,
      entityType,
      entityIds,
      range,
    }: {
      sellerAccountId: string;
      entityType: T;
      entityIds?: string[];
      range?: { from: string; to: string };
    }) {
      const ids = entityIds && new Set(entityIds);
      return dataset.metricsDaily
        .filter(
          (row): row is Extract<MetricsDaily, { entityType: T }> =>
            row.sellerAccountId === sellerAccountId &&
            row.entityType === entityType &&
            (ids === undefined || ids.has(row.entityId)) &&
            (range === undefined || (row.date >= range.from && row.date <= range.to)),
        )
        .sort((a, b) => a.date.localeCompare(b.date));
    },

    async listAgentRuns({ workspaceId, sellerAccountId, subjectId, limit }) {
      return limited(
        agentRuns.filter(
          (run) =>
            run.workspaceId === workspaceId &&
            (sellerAccountId === undefined || run.sellerAccountId === sellerAccountId) &&
            (subjectId === undefined || run.subject?.id === subjectId),
        ),
        limit,
      );
    },
    async getAgentRun(id) {
      return byId(agentRuns, id);
    },
    async startListingOptimizer({ productId, memberId }) {
      const { run, events } = startListingOptimizerRun(runStore(), { productId, memberId, at: now() });
      agentRuns.unshift(deepFreeze(run));
      appendAudit(events);
      return run;
    },
    async completeAgentRun(runId) {
      const run = byId(agentRuns, runId);
      if (!run) throw new AgentRunError("not_found", "That agent run doesn't exist.");
      if (run.status !== "running") {
        const proposalId = run.proposalIds[0];
        return { run, proposal: proposalId ? byId(proposals, proposalId) : undefined };
      }

      const result = completeListingOptimizerRun(runStore(), run, now().toISOString());
      listingVersions.push(deepFreeze(result.version));
      reviews.unshift(deepFreeze(result.review));
      proposals.unshift(deepFreeze(result.proposal));
      agentRuns[agentRuns.findIndex((candidate) => candidate.id === run.id)] = deepFreeze(result.run);
      appendAudit(result.events);
      return { run: result.run, proposal: result.proposal };
    },
    async listAuditEvents({ workspaceId, sellerAccountId, limit }) {
      return limited(
        auditEvents.filter(
          (event) =>
            event.workspaceId === workspaceId &&
            (sellerAccountId === undefined || event.sellerAccountId === sellerAccountId),
        ),
        limit,
      );
    },
  };
}

// Kept on globalThis so dev-server reloads of other modules don't throw away writes made so far.
// Tagged with the factory that built it: when this module itself reloads (its code changed), the
// factory is new and the source is rebuilt, so the dev server never serves an outdated implementation.
const globalStore = globalThis as typeof globalThis & {
  __mockDataSource?: { source: DataSource; factory: typeof createMockDataSource };
};

/** Phase 1 data source over the default seeded dataset, generated on first use. */
export function getMockDataSource(): DataSource {
  if (globalStore.__mockDataSource?.factory !== createMockDataSource) {
    globalStore.__mockDataSource = { source: createMockDataSource(generateMockDataset()), factory: createMockDataSource };
  }
  return globalStore.__mockDataSource.source;
}

/** Continues `prefix_0001`-style ids after the highest one already used. */
function idSequence(prefix: string, existing: readonly { id: string }[]): () => string {
  let last = Math.max(0, ...existing.map((item) => Number(item.id.slice(prefix.length + 1)) || 0));
  return () => `${prefix}_${String(++last).padStart(4, "0")}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
