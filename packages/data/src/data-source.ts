import type {
  AdGroup,
  AgentRun,
  AuditEvent,
  Campaign,
  DiffEdit,
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
  /** true: only proposals snoozed into the future; false: leave those out. Omit for both. */
  snoozed?: boolean;
};

/** Every write names the member making it; the data source checks they may. */
type ProposalWrite = { proposalId: string; memberId: string };

export type ApproveProposalInput = ProposalWrite & {
  note?: string;
  /** Approve with edits: replacement `after` values. The agent's diff is kept as `originalDiff`. */
  edits?: DiffEdit[];
};

export type RejectProposalInput = ProposalWrite & { reason: string };

export type SnoozeProposalInput = ProposalWrite & { until: string };

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
  /** The member acting in this workspace. Phase 1 has no sign-in, so it is the workspace owner. */
  getActingMember(workspaceId: string): Promise<Member | undefined>;
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

  /**
   * Approves a pending proposal (it is applied to Amazon later, never here). Writes proposal.approved,
   * plus proposal.edited first when there are edits. Throws ProposalWriteError when refused.
   */
  approveProposal(input: ApproveProposalInput): Promise<Proposal>;
  /** Rejects a pending proposal with a required reason. Writes proposal.rejected. */
  rejectProposal(input: RejectProposalInput): Promise<Proposal>;
  /** Hides a pending proposal from the queue until `until`. Writes proposal.snoozed. */
  snoozeProposal(input: SnoozeProposalInput): Promise<Proposal>;

  listCampaigns(sellerAccountId: string): Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | undefined>;
  listAdGroups(campaignId: string): Promise<AdGroup[]>;
  getAdGroup(id: string): Promise<AdGroup | undefined>;
  listTargets(adGroupId: string): Promise<Target[]>;
  getTarget(id: string): Promise<Target | undefined>;
  /** Oldest day first. */
  listMetricsDaily<T extends MetricsEntityType>(
    query: MetricsQuery<T>,
  ): Promise<Extract<MetricsDaily, { entityType: T }>[]>;

  /** Newest first. */
  listAgentRuns(query: ActivityQuery): Promise<AgentRun[]>;
  /** Newest first. */
  listAuditEvents(query: ActivityQuery): Promise<AuditEvent[]>;
}
