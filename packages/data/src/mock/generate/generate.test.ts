import {
  AdGroupSchema,
  AgentRunSchema,
  AuditEventSchema,
  CampaignSchema,
  ListingVersionSchema,
  MemberSchema,
  MetricsDailySchema,
  ProductFactsSchema,
  ProductSchema,
  ProposalSchema,
  ReviewSchema,
  SellerAccountSchema,
  TargetSchema,
  WorkspaceSchema,
  type AdMetricsDaily,
  type EntityRef,
} from "@app/core";
import type { ZodType } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_ANCHOR_DATE, MOCK_METRIC_DAYS, generateMockDataset, type MockDataset } from ".";

const dataset = generateMockDataset();
const now = Date.parse(`${MOCK_ANCHOR_DATE}T18:00:00.000Z`);

const SCHEMAS: { [K in keyof MockDataset]: ZodType } = {
  workspaces: WorkspaceSchema,
  members: MemberSchema,
  sellerAccounts: SellerAccountSchema,
  products: ProductSchema,
  productFacts: ProductFactsSchema,
  listingVersions: ListingVersionSchema,
  reviews: ReviewSchema,
  proposals: ProposalSchema,
  campaigns: CampaignSchema,
  adGroups: AdGroupSchema,
  targets: TargetSchema,
  metricsDaily: MetricsDailySchema,
  agentRuns: AgentRunSchema,
  auditEvents: AuditEventSchema,
};

const ids = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id));
const merchant = dataset.workspaces.find((workspace) => workspace.kind === "merchant");
const agency = dataset.workspaces.find((workspace) => workspace.kind === "agency");

describe("determinism", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces the same dataset for the same seed", () => {
    expect(generateMockDataset()).toEqual(dataset);
  });

  it("produces a different dataset for a different seed", () => {
    const other = generateMockDataset({ seed: 7 });
    expect(other.products.map((product) => product.asin)).not.toEqual(dataset.products.map((product) => product.asin));
  });

  it("does not read the real clock", () => {
    vi.useFakeTimers({ now: new Date("2031-06-15T09:00:00.000Z") });
    expect(generateMockDataset()).toEqual(dataset);
  });
});

describe("schemas", () => {
  it.each(Object.keys(SCHEMAS) as (keyof MockDataset)[])("every %s row is valid", (key) => {
    const result = SCHEMAS[key].array().safeParse(dataset[key]);
    expect(result.error?.issues.slice(0, 3)).toBeUndefined();
  });

  it.each(Object.keys(SCHEMAS) as (keyof MockDataset)[])("%s ids are unique", (key) => {
    const rows = dataset[key] as { id?: string }[];
    const withIds = rows.flatMap((row) => (row.id === undefined ? [] : [row.id]));
    expect(new Set(withIds).size).toBe(withIds.length);
  });
});

describe("shape", () => {
  it("has one merchant and one agency", () => {
    expect(dataset.workspaces.map((workspace) => workspace.kind).sort()).toEqual(["agency", "merchant"]);
  });

  it("gives the merchant one account with ~120 SKUs in 3 categories", () => {
    const accounts = dataset.sellerAccounts.filter((account) => account.workspaceId === merchant?.id);
    expect(accounts).toHaveLength(1);
    const products = dataset.products.filter((product) => product.sellerAccountId === accounts[0]?.id);
    expect(products.length).toBeGreaterThanOrEqual(110);
    expect(products.length).toBeLessThanOrEqual(130);
    expect(new Set(products.map((product) => product.category)).size).toBe(3);
  });

  it("gives the agency 5 client accounts, each with products and its own client approver", () => {
    const accounts = dataset.sellerAccounts.filter((account) => account.workspaceId === agency?.id);
    expect(accounts).toHaveLength(5);
    for (const account of accounts) {
      expect(dataset.products.some((product) => product.sellerAccountId === account.id)).toBe(true);
      const approvers = dataset.members.filter(
        (member) => member.role === "client_approver" && member.sellerAccountIds.includes(account.id),
      );
      expect(approvers).toHaveLength(1);
    }
  });

  it("uses every member role", () => {
    expect(new Set(dataset.members.map((member) => member.role))).toEqual(
      new Set(["owner", "specialist", "client_approver", "viewer"]),
    );
  });

  it("keeps SKUs and ASINs unique", () => {
    const skus = dataset.products.map((product) => product.sku);
    const asins = dataset.products.map((product) => product.asin);
    expect(new Set(skus).size).toBe(skus.length);
    expect(new Set(asins).size).toBe(asins.length);
  });

  it("produces work for the approvals queue", () => {
    const pending = dataset.proposals.filter((proposal) => proposal.status === "pending_approval");
    expect(pending.length).toBeGreaterThan(5);
    expect(new Set(dataset.proposals.map((proposal) => proposal.type)).size).toBeGreaterThanOrEqual(5);
  });
});

describe("metrics", () => {
  const dates = [...new Set(dataset.metricsDaily.map((row) => row.date))].sort();

  it("covers 90 consecutive days ending on the anchor date", () => {
    expect(dates).toHaveLength(MOCK_METRIC_DAYS);
    expect(dates.at(-1)).toBe(MOCK_ANCHOR_DATE);
    for (let i = 1; i < dates.length; i++) {
      const gap = Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`);
      expect(gap).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("has one row per day for every product and campaign", () => {
    const rowsPerEntity = new Map<string, number>();
    for (const row of dataset.metricsDaily) rowsPerEntity.set(row.entityId, (rowsPerEntity.get(row.entityId) ?? 0) + 1);
    for (const product of dataset.products) expect(rowsPerEntity.get(product.id)).toBe(MOCK_METRIC_DAYS);
    for (const campaign of dataset.campaigns) expect(rowsPerEntity.get(campaign.id)).toBe(MOCK_METRIC_DAYS);
    for (const count of rowsPerEntity.values()) expect(count).toBe(MOCK_METRIC_DAYS);
  });

  it("only reports metrics for entities that exist", () => {
    const known = new Set([...ids(dataset.products), ...ids(dataset.campaigns), ...ids(dataset.targets)]);
    expect(dataset.metricsDaily.every((row) => known.has(row.entityId))).toBe(true);
  });

  it("rolls target rows up into campaign rows", () => {
    const campaignOf = new Map(dataset.adGroups.map((adGroup) => [adGroup.id, adGroup.campaignId]));
    const campaignOfTarget = new Map(dataset.targets.map((target) => [target.id, campaignOf.get(target.adGroupId)]));
    const sums = new Map<string, { impressions: number; clicks: number; spend: number; adOrders: number }>();
    const campaignRows: AdMetricsDaily[] = [];
    for (const row of dataset.metricsDaily) {
      if (row.entityType === "campaign") campaignRows.push(row);
      if (row.entityType !== "target") continue;
      const key = `${campaignOfTarget.get(row.entityId)}|${row.date}`;
      const sum = sums.get(key) ?? { impressions: 0, clicks: 0, spend: 0, adOrders: 0 };
      sum.impressions += row.impressions;
      sum.clicks += row.clicks;
      sum.spend += row.spend;
      sum.adOrders += row.adOrders;
      sums.set(key, sum);
    }
    for (const row of campaignRows) {
      const sum = sums.get(`${row.entityId}|${row.date}`) ?? { impressions: 0, clicks: 0, spend: 0, adOrders: 0 };
      expect(row.impressions).toBe(sum.impressions);
      expect(row.clicks).toBe(sum.clicks);
      expect(row.adOrders).toBe(sum.adOrders);
      expect(row.spend).toBeCloseTo(sum.spend, 2);
    }
  });

  it("moves the window with the anchor date", () => {
    const shifted = generateMockDataset({ anchorDate: "2026-01-31", days: 30 });
    const shiftedDates = [...new Set(shifted.metricsDaily.map((row) => row.date))].sort();
    expect(shiftedDates).toHaveLength(30);
    expect(shiftedDates[0]).toBe("2026-01-02");
    expect(shiftedDates.at(-1)).toBe("2026-01-31");
  });
});

describe("referential integrity", () => {
  const workspaceIds = ids(dataset.workspaces);
  const accountIds = ids(dataset.sellerAccounts);
  const productIds = ids(dataset.products);
  const versionIds = ids(dataset.listingVersions);
  const memberIds = ids(dataset.members);
  const runIds = ids(dataset.agentRuns);
  const entityIds: Record<EntityRef["type"], Set<string>> = {
    workspace: workspaceIds,
    member: memberIds,
    seller_account: accountIds,
    product: productIds,
    listing_version: versionIds,
    review: ids(dataset.reviews),
    proposal: ids(dataset.proposals),
    campaign: ids(dataset.campaigns),
    ad_group: ids(dataset.adGroups),
    target: ids(dataset.targets),
    agent_run: runIds,
  };
  const accountOf = new Map(dataset.sellerAccounts.map((account) => [account.id, account]));

  it("links organizations", () => {
    expect(dataset.members.every((member) => workspaceIds.has(member.workspaceId))).toBe(true);
    expect(dataset.sellerAccounts.every((account) => workspaceIds.has(account.workspaceId))).toBe(true);
    for (const member of dataset.members) {
      for (const id of member.sellerAccountIds) expect(accountOf.get(id)?.workspaceId).toBe(member.workspaceId);
    }
  });

  it("links the catalog", () => {
    expect(dataset.products.every((product) => accountIds.has(product.sellerAccountId))).toBe(true);
    expect(dataset.productFacts.map((facts) => facts.productId).sort()).toEqual([...productIds].sort());
    expect(dataset.listingVersions.every((version) => productIds.has(version.productId))).toBe(true);
    expect(dataset.reviews.every((review) => versionIds.has(review.listingVersionId))).toBe(true);
  });

  it("links advertising within one seller account", () => {
    const campaignAccount = new Map(dataset.campaigns.map((campaign) => [campaign.id, campaign.sellerAccountId]));
    const productAccount = new Map(dataset.products.map((product) => [product.id, product.sellerAccountId]));
    for (const adGroup of dataset.adGroups) {
      const account = campaignAccount.get(adGroup.campaignId);
      expect(account).toBeDefined();
      for (const id of adGroup.productIds) expect(productAccount.get(id)).toBe(account);
    }
    const adGroupIds = ids(dataset.adGroups);
    expect(dataset.targets.every((target) => adGroupIds.has(target.adGroupId))).toBe(true);
  });

  it("links proposals, runs and audit events", () => {
    for (const proposal of dataset.proposals) {
      expect(accountOf.get(proposal.sellerAccountId)?.workspaceId).toBe(proposal.workspaceId);
      expect(entityIds[proposal.target.type].has(proposal.target.id)).toBe(true);
      if (proposal.reviewId) expect(entityIds.review.has(proposal.reviewId)).toBe(true);
      if (proposal.decidedBy?.type === "member") expect(memberIds.has(proposal.decidedBy.memberId)).toBe(true);
    }
    for (const event of dataset.auditEvents) {
      expect(workspaceIds.has(event.workspaceId)).toBe(true);
      expect(entityIds[event.entity.type].has(event.entity.id)).toBe(true);
    }
    for (const actor of [
      ...dataset.listingVersions.map((version) => version.createdBy),
      ...dataset.reviews.map((review) => review.reviewer),
      ...dataset.auditEvents.map((event) => event.actor),
    ]) {
      if (actor.type === "agent") expect(runIds.has(actor.agentRunId)).toBe(true);
      if (actor.type === "member") expect(memberIds.has(actor.memberId)).toBe(true);
    }
  });

  it("keeps run.proposalIds in sync with who created each proposal", () => {
    const createdByRun = new Map<string, string[]>();
    for (const proposal of dataset.proposals) {
      expect(proposal.createdBy.type).toBe("agent");
      if (proposal.createdBy.type !== "agent") continue;
      const list = createdByRun.get(proposal.createdBy.agentRunId) ?? [];
      list.push(proposal.id);
      createdByRun.set(proposal.createdBy.agentRunId, list);
    }
    for (const run of dataset.agentRuns) {
      expect([...run.proposalIds].sort()).toEqual((createdByRun.get(run.id) ?? []).sort());
    }
  });
});

describe("business rules", () => {
  it("has exactly one live listing version per product, matching the product title", () => {
    for (const product of dataset.products) {
      const versions = dataset.listingVersions.filter((version) => version.productId === product.id);
      const live = versions.filter((version) => version.status === "live");
      expect(live).toHaveLength(1);
      expect(product.title).toBe(live[0]?.title);
      expect(versions.map((version) => version.version).sort((a, b) => a - b)).toEqual(
        versions.map((_, i) => i + 1),
      );
    }
  });

  it("reviews every agent-written listing version and proposes it", () => {
    const agentVersions = dataset.listingVersions.filter((version) => version.createdBy.type === "agent");
    expect(agentVersions.length).toBeGreaterThan(0);
    for (const version of agentVersions) {
      const review = dataset.reviews.find((candidate) => candidate.listingVersionId === version.id);
      expect(review?.reviewer.type).toBe("agent");
      const proposal = dataset.proposals.find((candidate) => candidate.reviewId === review?.id);
      expect(proposal?.type).toBe("listing_update");
      expect(proposal?.scores.rubric).toBe(review?.overall);
    }
  });

  it("reflects applied proposals in current state and leaves others untouched", () => {
    const targets = new Map(dataset.targets.map((target) => [target.id, target]));
    const campaigns = new Map(dataset.campaigns.map((campaign) => [campaign.id, campaign]));
    let checked = 0;
    for (const proposal of dataset.proposals) {
      const [change] = proposal.diff;
      const applied = proposal.status === "applied";
      if (proposal.type === "bid_change") {
        expect(targets.get(proposal.target.id)?.bid).toBe(applied ? change?.after : change?.before);
        checked++;
      }
      if (proposal.type === "budget_change") {
        expect(campaigns.get(proposal.target.id)?.dailyBudget).toBe(applied ? change?.after : change?.before);
        checked++;
      }
      if (proposal.type === "target_pause") {
        expect(targets.get(proposal.target.id)?.state).toBe(applied ? "paused" : "enabled");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("auto-applies only low-risk proposals, and only on L2+ accounts", () => {
    const accounts = new Map(dataset.sellerAccounts.map((account) => [account.id, account]));
    const automatic = dataset.proposals.filter((proposal) => proposal.decidedBy?.type === "system");
    expect(automatic.length).toBeGreaterThan(0);
    for (const proposal of automatic) {
      expect(proposal.risk).toBe("low");
      expect(["L2", "L3"]).toContain(accounts.get(proposal.sellerAccountId)?.autonomyLevel);
    }
  });

  it("has agency clients approve their own high-risk changes", () => {
    const members = new Map(dataset.members.map((member) => [member.id, member]));
    const decided = dataset.proposals.filter(
      (proposal) => proposal.workspaceId === agency?.id && proposal.risk === "high" && proposal.decidedBy?.type === "member",
    );
    for (const proposal of decided) {
      const decider = proposal.decidedBy?.type === "member" ? members.get(proposal.decidedBy.memberId) : undefined;
      expect(decider?.role).toBe("client_approver");
      expect(decider?.sellerAccountIds).toContain(proposal.sellerAccountId);
    }
  });

  it("never records anything after 'now'", () => {
    const timestamps = [
      ...dataset.workspaces.map((workspace) => workspace.createdAt),
      ...dataset.members.map((member) => member.createdAt),
      ...dataset.sellerAccounts.map((account) => account.connectedAt),
      ...dataset.listingVersions.map((version) => version.createdAt),
      ...dataset.reviews.map((review) => review.createdAt),
      ...dataset.proposals.flatMap((proposal) => [proposal.createdAt, proposal.decidedAt, proposal.appliedAt]),
      ...dataset.agentRuns.flatMap((run) => [run.startedAt, run.finishedAt]),
      ...dataset.auditEvents.map((event) => event.at),
    ].flatMap((value) => (value === undefined ? [] : [Date.parse(value)]));
    expect(Math.max(...timestamps)).toBeLessThanOrEqual(now);
  });

  it("orders activity newest first and audits every proposal", () => {
    const isNewestFirst = (values: string[]) => values.every((value, i) => i === 0 || values[i - 1]! >= value);
    expect(isNewestFirst(dataset.proposals.map((proposal) => proposal.createdAt))).toBe(true);
    expect(isNewestFirst(dataset.agentRuns.map((run) => run.startedAt))).toBe(true);
    expect(isNewestFirst(dataset.auditEvents.map((event) => event.at))).toBe(true);
    const created = new Set(
      dataset.auditEvents.filter((event) => event.action === "proposal.created").map((event) => event.entity.id),
    );
    expect(dataset.proposals.every((proposal) => created.has(proposal.id))).toBe(true);
  });
});
