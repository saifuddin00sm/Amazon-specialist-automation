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
  type AdGroup,
  type AgentRun,
  type AuditEvent,
  type Campaign,
  type ListingVersion,
  type Member,
  type MetricsDaily,
  type Product,
  type ProductFacts,
  type Proposal,
  type Review,
  type SellerAccount,
  type Target,
  type Workspace,
} from "@app/core";
import type { Json, Tables, TablesInsert } from "./database.types";

/**
 * Maps every domain record to its table row and back. Rows carry workspace_id and seller_account_id
 * for row-level security, so writes take the record's scope. Reads are parsed with the Zod schemas
 * in packages/core, which stay the source of truth.
 */

/** Where an account-scoped record lives. */
export type Scope = { workspaceId: string; sellerAccountId: string };

const scopeColumns = ({ workspaceId, sellerAccountId }: Scope) => ({
  workspace_id: workspaceId,
  seller_account_id: sellerAccountId,
});

/** Postgres returns `2026-10-31T09:00:00+00:00`; records use the `toISOString()` form. */
const iso = (value: string) => new Date(value).toISOString();
const isoOrUndefined = (value: string | null) => (value === null ? undefined : iso(value));
const orUndefined = <T>(value: T | null) => (value === null ? undefined : value);

/** Records are JSON-safe by construction; this only tells the generated types so. */
const json = (value: unknown) => value as NonNullable<Json>;

/** Leaves optional fields out instead of setting them to undefined, like records built in memory. */
function compact<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

// Workspaces and members

export const workspaceToRow = (workspace: Workspace): TablesInsert<"workspaces"> => ({
  id: workspace.id,
  name: workspace.name,
  kind: workspace.kind,
  created_at: workspace.createdAt,
});

export const workspaceFromRow = (row: Tables<"workspaces">): Workspace =>
  WorkspaceSchema.parse({ id: row.id, name: row.name, kind: row.kind, createdAt: iso(row.created_at) });

export const memberToRow = (member: Member): TablesInsert<"members"> => ({
  id: member.id,
  workspace_id: member.workspaceId,
  name: member.name,
  email: member.email,
  role: member.role,
  seller_account_ids: member.sellerAccountIds,
  created_at: member.createdAt,
});

export const memberFromRow = (row: Tables<"members">): Member =>
  MemberSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    email: row.email,
    role: row.role,
    sellerAccountIds: row.seller_account_ids,
    createdAt: iso(row.created_at),
  });

export const sellerAccountToRow = (account: SellerAccount): TablesInsert<"seller_accounts"> => ({
  id: account.id,
  workspace_id: account.workspaceId,
  name: account.name,
  seller_id: account.sellerId,
  marketplace: account.marketplace,
  currency: account.currency,
  autonomy_level: account.autonomyLevel,
  target_acos: account.targetAcos,
  connected_at: account.connectedAt,
});

export const sellerAccountFromRow = (row: Tables<"seller_accounts">): SellerAccount =>
  SellerAccountSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    sellerId: row.seller_id,
    marketplace: row.marketplace,
    currency: row.currency,
    autonomyLevel: row.autonomy_level,
    targetAcos: row.target_acos,
    connectedAt: iso(row.connected_at),
  });

// Catalog

export const productToRow = (product: Product, workspaceId: string): TablesInsert<"products"> => ({
  ...scopeColumns({ workspaceId, sellerAccountId: product.sellerAccountId }),
  id: product.id,
  asin: product.asin,
  sku: product.sku,
  title: product.title,
  brand: product.brand,
  category: product.category,
  price: product.price,
  status: product.status,
  created_at: product.createdAt,
});

export const productFromRow = (row: Tables<"products">): Product =>
  ProductSchema.parse({
    id: row.id,
    sellerAccountId: row.seller_account_id,
    asin: row.asin,
    sku: row.sku,
    title: row.title,
    brand: row.brand,
    category: row.category,
    price: row.price,
    status: row.status,
    createdAt: iso(row.created_at),
  });

export const productFactsToRow = (facts: ProductFacts, scope: Scope): TablesInsert<"product_facts"> => ({
  ...scopeColumns(scope),
  product_id: facts.productId,
  material: facts.material,
  color: facts.color,
  length_cm: facts.dimensions.lengthCm,
  width_cm: facts.dimensions.widthCm,
  height_cm: facts.dimensions.heightCm,
  weight_grams: facts.weightGrams,
  included_components: facts.includedComponents,
  features: facts.features,
  prohibited_claims: facts.prohibitedClaims,
  target_keywords: facts.targetKeywords,
  updated_at: facts.updatedAt,
});

export const productFactsFromRow = (row: Tables<"product_facts">): ProductFacts =>
  ProductFactsSchema.parse({
    productId: row.product_id,
    material: row.material,
    color: row.color,
    dimensions: { lengthCm: row.length_cm, widthCm: row.width_cm, heightCm: row.height_cm },
    weightGrams: row.weight_grams,
    includedComponents: row.included_components,
    features: row.features,
    prohibitedClaims: row.prohibited_claims,
    targetKeywords: row.target_keywords,
    updatedAt: iso(row.updated_at),
  });

export const listingVersionToRow = (version: ListingVersion, scope: Scope): TablesInsert<"listing_versions"> => ({
  ...scopeColumns(scope),
  id: version.id,
  product_id: version.productId,
  version: version.version,
  status: version.status,
  title: version.title,
  bullets: version.bullets,
  description: version.description,
  backend_keywords: version.backendKeywords,
  created_by: json(version.createdBy),
  created_at: version.createdAt,
});

export const listingVersionFromRow = (row: Tables<"listing_versions">): ListingVersion =>
  ListingVersionSchema.parse({
    id: row.id,
    productId: row.product_id,
    version: row.version,
    status: row.status,
    title: row.title,
    bullets: row.bullets,
    description: row.description,
    backendKeywords: row.backend_keywords,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  });

export const reviewToRow = (review: Review, scope: Scope): TablesInsert<"reviews"> => ({
  ...scopeColumns(scope),
  id: review.id,
  listing_version_id: review.listingVersionId,
  scores: json(review.scores),
  overall: review.overall,
  report: json(review.report),
  reviewer: json(review.reviewer),
  created_at: review.createdAt,
});

export const reviewFromRow = (row: Tables<"reviews">): Review =>
  ReviewSchema.parse({
    id: row.id,
    listingVersionId: row.listing_version_id,
    scores: row.scores,
    overall: row.overall,
    report: row.report,
    reviewer: row.reviewer,
    createdAt: iso(row.created_at),
  });

// Advertising

export const campaignToRow = (campaign: Campaign, workspaceId: string): TablesInsert<"campaigns"> => ({
  ...scopeColumns({ workspaceId, sellerAccountId: campaign.sellerAccountId }),
  id: campaign.id,
  name: campaign.name,
  type: campaign.type,
  targeting_type: campaign.targetingType,
  state: campaign.state,
  daily_budget: campaign.dailyBudget,
  bidding_strategy: campaign.biddingStrategy,
  start_date: campaign.startDate,
  end_date: campaign.endDate ?? null,
});

export const campaignFromRow = (row: Tables<"campaigns">): Campaign =>
  CampaignSchema.parse(
    compact({
      id: row.id,
      sellerAccountId: row.seller_account_id,
      name: row.name,
      type: row.type,
      targetingType: row.targeting_type,
      state: row.state,
      dailyBudget: row.daily_budget,
      biddingStrategy: row.bidding_strategy,
      startDate: row.start_date,
      endDate: orUndefined(row.end_date),
    }),
  );

export const adGroupToRow = (adGroup: AdGroup, scope: Scope): TablesInsert<"ad_groups"> => ({
  ...scopeColumns(scope),
  id: adGroup.id,
  campaign_id: adGroup.campaignId,
  name: adGroup.name,
  state: adGroup.state,
  default_bid: adGroup.defaultBid,
  product_ids: adGroup.productIds,
});

export const adGroupFromRow = (row: Tables<"ad_groups">): AdGroup =>
  AdGroupSchema.parse({
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    state: row.state,
    defaultBid: row.default_bid,
    productIds: row.product_ids,
  });

export const targetToRow = (target: Target, scope: Scope): TablesInsert<"targets"> => ({
  ...scopeColumns(scope),
  id: target.id,
  ad_group_id: target.adGroupId,
  state: target.state,
  negative: target.negative,
  bid: target.bid ?? null,
  kind: target.kind,
  keyword: target.kind === "keyword" ? target.keyword : null,
  match_type: target.kind === "keyword" ? target.matchType : null,
  asin: target.kind === "product" ? target.asin : null,
  auto_type: target.kind === "auto" ? target.autoType : null,
});

export const targetFromRow = (row: Tables<"targets">): Target => {
  const base = compact({
    id: row.id,
    adGroupId: row.ad_group_id,
    state: row.state,
    negative: row.negative,
    bid: orUndefined(row.bid),
  });
  switch (row.kind) {
    case "keyword":
      return TargetSchema.parse({ ...base, kind: "keyword", keyword: row.keyword, matchType: row.match_type });
    case "product":
      return TargetSchema.parse({ ...base, kind: "product", asin: row.asin });
    case "auto":
      return TargetSchema.parse({ ...base, kind: "auto", autoType: row.auto_type });
  }
};

export const metricsDailyToRow = (row: MetricsDaily, workspaceId: string): TablesInsert<"metrics_daily"> => {
  const base = {
    ...scopeColumns({ workspaceId, sellerAccountId: row.sellerAccountId }),
    entity_type: row.entityType,
    entity_id: row.entityId,
    date: row.date,
  };
  if (row.entityType === "product") {
    return {
      ...base,
      sessions: row.sessions,
      page_views: row.pageViews,
      units_ordered: row.unitsOrdered,
      ordered_revenue: row.orderedRevenue,
    };
  }
  return {
    ...base,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    ad_sales: row.adSales,
    ad_orders: row.adOrders,
  };
};

export const metricsDailyFromRow = (row: Tables<"metrics_daily">): MetricsDaily => {
  const base = { date: row.date, sellerAccountId: row.seller_account_id, entityId: row.entity_id };
  if (row.entity_type === "product") {
    return MetricsDailySchema.parse({
      ...base,
      entityType: "product",
      sessions: row.sessions,
      pageViews: row.page_views,
      unitsOrdered: row.units_ordered,
      orderedRevenue: row.ordered_revenue,
    });
  }
  return MetricsDailySchema.parse({
    ...base,
    entityType: row.entity_type,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    adSales: row.ad_sales,
    adOrders: row.ad_orders,
  });
};

// Proposals, agent runs and audit

export const proposalToRow = (proposal: Proposal): TablesInsert<"proposals"> => ({
  ...scopeColumns(proposal),
  id: proposal.id,
  type: proposal.type,
  status: proposal.status,
  risk: proposal.risk,
  title: proposal.title,
  rationale: proposal.rationale,
  target_type: proposal.target.type,
  target_id: proposal.target.id,
  diff: json(proposal.diff),
  original_diff: proposal.originalDiff ? json(proposal.originalDiff) : null,
  scores: json(proposal.scores),
  freshness: json(proposal.freshness),
  review_id: proposal.reviewId ?? null,
  created_by: json(proposal.createdBy),
  created_at: proposal.createdAt,
  snoozed_until: proposal.snoozedUntil ?? null,
  decided_by: proposal.decidedBy ? json(proposal.decidedBy) : null,
  decided_at: proposal.decidedAt ?? null,
  decision_note: proposal.decisionNote ?? null,
  applied_at: proposal.appliedAt ?? null,
});

export const proposalFromRow = (row: Tables<"proposals">): Proposal =>
  ProposalSchema.parse(
    compact({
      id: row.id,
      workspaceId: row.workspace_id,
      sellerAccountId: row.seller_account_id,
      type: row.type,
      status: row.status,
      risk: row.risk,
      title: row.title,
      rationale: row.rationale,
      target: { type: row.target_type, id: row.target_id },
      diff: row.diff,
      originalDiff: orUndefined(row.original_diff),
      scores: row.scores,
      freshness: row.freshness,
      reviewId: orUndefined(row.review_id),
      createdBy: row.created_by,
      createdAt: iso(row.created_at),
      snoozedUntil: isoOrUndefined(row.snoozed_until),
      decidedBy: orUndefined(row.decided_by),
      decidedAt: isoOrUndefined(row.decided_at),
      decisionNote: orUndefined(row.decision_note),
      appliedAt: isoOrUndefined(row.applied_at),
    }),
  );

export const agentRunToRow = (run: AgentRun): TablesInsert<"agent_runs"> => ({
  ...scopeColumns(run),
  id: run.id,
  agent: run.agent,
  status: run.status,
  autonomy_level: run.autonomyLevel,
  trigger: run.trigger,
  subject_type: run.subject?.type ?? null,
  subject_id: run.subject?.id ?? null,
  summary: run.summary,
  proposal_ids: run.proposalIds,
  steps: run.steps ? json(run.steps) : null,
  started_at: run.startedAt,
  finished_at: run.finishedAt ?? null,
  error: run.error ?? null,
});

export const agentRunFromRow = (row: Tables<"agent_runs">): AgentRun =>
  AgentRunSchema.parse(
    compact({
      id: row.id,
      workspaceId: row.workspace_id,
      sellerAccountId: row.seller_account_id,
      agent: row.agent,
      status: row.status,
      autonomyLevel: row.autonomy_level,
      trigger: row.trigger,
      subject: row.subject_type && row.subject_id ? { type: row.subject_type, id: row.subject_id } : undefined,
      summary: row.summary,
      proposalIds: row.proposal_ids,
      steps: orUndefined(row.steps),
      startedAt: iso(row.started_at),
      finishedAt: isoOrUndefined(row.finished_at),
      error: orUndefined(row.error),
    }),
  );

export const auditEventToRow = (event: AuditEvent): Omit<TablesInsert<"audit_events">, "seq"> => ({
  id: event.id,
  workspace_id: event.workspaceId,
  seller_account_id: event.sellerAccountId ?? null,
  at: event.at,
  actor: json(event.actor),
  action: event.action,
  entity_type: event.entity.type,
  entity_id: event.entity.id,
  metadata: json(event.metadata),
});

export const auditEventFromRow = (row: Tables<"audit_events">): AuditEvent =>
  AuditEventSchema.parse(
    compact({
      id: row.id,
      workspaceId: row.workspace_id,
      sellerAccountId: orUndefined(row.seller_account_id),
      at: iso(row.at),
      actor: row.actor,
      action: row.action,
      entity: { type: row.entity_type, id: row.entity_id },
      metadata: row.metadata,
    }),
  );
