import type {
  AdGroup,
  AgentRun,
  AuditEvent,
  Campaign,
  ListingVersion,
  Member,
  MetricsDaily,
  MetricsEntityType,
  Product,
  ProductFacts,
  ProductStatus,
  Proposal,
  ProposalStatus,
  ProposalType,
  Review,
  SellerAccount,
  Target,
  Workspace,
} from "@app/core";

/** Inclusive range of calendar days, YYYY-MM-DD. */
export type DateRange = { from: string; to: string };

export type ProductQuery = {
  sellerAccountId: string;
  category?: string;
  status?: ProductStatus;
};

export type ProposalQuery = {
  workspaceId: string;
  sellerAccountId?: string;
  status?: ProposalStatus;
  type?: ProposalType;
};

export type MetricsQuery<T extends MetricsEntityType> = {
  sellerAccountId: string;
  entityType: T;
  entityIds?: string[];
  range?: DateRange;
};

export type ActivityQuery = {
  workspaceId: string;
  sellerAccountId?: string;
  limit?: number;
};

/** The only way the UI reads or writes data. Implementations: mock (Phase 1), Supabase/Amazon (later). */
export interface DataSource {
  listWorkspaces(): Promise<Workspace[]>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  listMembers(workspaceId: string): Promise<Member[]>;
  listSellerAccounts(workspaceId?: string): Promise<SellerAccount[]>;
  getSellerAccount(id: string): Promise<SellerAccount | undefined>;

  listProducts(query: ProductQuery): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  getProductFacts(productId: string): Promise<ProductFacts | undefined>;
  /** Newest version first. */
  listListingVersions(productId: string): Promise<ListingVersion[]>;
  /** Newest first. */
  listReviews(listingVersionId: string): Promise<Review[]>;
  getReview(id: string): Promise<Review | undefined>;

  /** Newest first. */
  listProposals(query: ProposalQuery): Promise<Proposal[]>;
  getProposal(id: string): Promise<Proposal | undefined>;

  listCampaigns(sellerAccountId: string): Promise<Campaign[]>;
  listAdGroups(campaignId: string): Promise<AdGroup[]>;
  listTargets(adGroupId: string): Promise<Target[]>;
  /** Oldest day first. */
  listMetricsDaily<T extends MetricsEntityType>(
    query: MetricsQuery<T>,
  ): Promise<Extract<MetricsDaily, { entityType: T }>[]>;

  /** Newest first. */
  listAgentRuns(query: ActivityQuery): Promise<AgentRun[]>;
  /** Newest first. */
  listAuditEvents(query: ActivityQuery): Promise<AuditEvent[]>;
}
