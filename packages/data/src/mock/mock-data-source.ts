import type { MetricsDaily } from "@app/core";
import type { DataSource } from "../data-source";
import { generateMockDataset, type MockDataset } from "./generate";

/** Serves a generated dataset. The dataset is frozen so callers can't mutate "live" data. */
export function createMockDataSource(dataset: MockDataset): DataSource {
  deepFreeze(dataset);
  const byId = <T extends { id: string }>(items: T[], id: string) => items.find((item) => item.id === id);
  const limited = <T>(items: T[], limit?: number) => (limit === undefined ? items : items.slice(0, limit));

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
      return dataset.listingVersions
        .filter((version) => version.productId === productId)
        .sort((a, b) => b.version - a.version);
    },
    async listReviews(listingVersionId) {
      return dataset.reviews.filter((review) => review.listingVersionId === listingVersionId);
    },
    async getReview(id) {
      return byId(dataset.reviews, id);
    },

    async listProposals({ workspaceId, sellerAccountId, status, type }) {
      return dataset.proposals.filter(
        (proposal) =>
          proposal.workspaceId === workspaceId &&
          (sellerAccountId === undefined || proposal.sellerAccountId === sellerAccountId) &&
          (status === undefined || proposal.status === status) &&
          (type === undefined || proposal.type === type),
      );
    },
    async getProposal(id) {
      return byId(dataset.proposals, id);
    },

    async listCampaigns(sellerAccountId) {
      return dataset.campaigns.filter((campaign) => campaign.sellerAccountId === sellerAccountId);
    },
    async listAdGroups(campaignId) {
      return dataset.adGroups.filter((adGroup) => adGroup.campaignId === campaignId);
    },
    async listTargets(adGroupId) {
      return dataset.targets.filter((target) => target.adGroupId === adGroupId);
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

    async listAgentRuns({ workspaceId, sellerAccountId, limit }) {
      return limited(
        dataset.agentRuns.filter(
          (run) =>
            run.workspaceId === workspaceId && (sellerAccountId === undefined || run.sellerAccountId === sellerAccountId),
        ),
        limit,
      );
    },
    async listAuditEvents({ workspaceId, sellerAccountId, limit }) {
      return limited(
        dataset.auditEvents.filter(
          (event) =>
            event.workspaceId === workspaceId &&
            (sellerAccountId === undefined || event.sellerAccountId === sellerAccountId),
        ),
        limit,
      );
    },
  };
}

let defaultDataSource: DataSource | undefined;

/** Phase 1 data source over the default seeded dataset, generated on first use. */
export function getMockDataSource(): DataSource {
  defaultDataSource ??= createMockDataSource(generateMockDataset());
  return defaultDataSource;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
