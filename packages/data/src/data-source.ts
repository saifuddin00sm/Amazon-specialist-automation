import type {
  AdGroup,
  AgentRun,
  AuditEvent,
  Branding,
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

export type AgentRunQuery = ActivityQuery & {
  /** Only runs that worked on this entity, e.g. one product. */
  subjectId?: string;
};

/** The newest Review of a product's live listing. */
export type LiveListingReview = { productId: string; review: Review };

export type StartListingOptimizerInput = { productId: string; memberId: string };

export type StartCampaignOptimizerInput = { campaignId: string; memberId: string };

/** Report branding for a workspace; null goes back to the default. */
export type UpdateWorkspaceBrandingInput = { workspaceId: string; memberId: string; branding: Branding | null };

export type AgentRunErrorCode = "not_found" | "forbidden" | "conflict";

/** An agent run the data source refused to start or complete. `message` is safe to show. */
export class AgentRunError extends Error {
  constructor(
    readonly code: AgentRunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}

/** The only way the UI reads or writes data. Implementations: mock (Phase 1), Supabase/Amazon (later). */
export interface DataSource {
  listWorkspaces(): Promise<Workspace[]>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  listMembers(workspaceId: string): Promise<Member[]>;
  /** The member acting in this workspace. Phase 1 has no sign-in, so it is the workspace owner. */
  getActingMember(workspaceId: string): Promise<Member | undefined>;
  listSellerAccounts(workspaceId?: string): Promise<SellerAccount[]>;
  getSellerAccount(id: string): Promise<SellerAccount | undefined>;
  /**
   * Sets a workspace's report branding as `memberId`, who must be its owner. Writes settings.updated.
   * Throws SettingsWriteError when refused.
   */
  updateWorkspaceBranding(input: UpdateWorkspaceBrandingInput): Promise<Workspace>;

  listProducts(query: ProductQuery): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  getProductFacts(productId: string): Promise<ProductFacts | undefined>;
  /** Newest version first. */
  listListingVersions(productId: string): Promise<ListingVersion[]>;
  /** Newest first. */
  listReviews(listingVersionId: string): Promise<Review[]>;
  getReview(id: string): Promise<Review | undefined>;
  /** The newest Review of each live listing in the account, by product id. Unreviewed listings are left out. */
  listLiveListingReviews(sellerAccountId: string): Promise<LiveListingReview[]>;

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
  /** First and last day the account has metrics for; undefined when it has none. */
  getMetricsDateRange(sellerAccountId: string): Promise<DateRange | undefined>;

  /** Newest first. */
  listAgentRuns(query: AgentRunQuery): Promise<AgentRun[]>;
  getAgentRun(id: string): Promise<AgentRun | undefined>;
  /**
   * Starts the listing optimizer on a product as `memberId`. Returns the running AgentRun with its
   * planned steps. Throws AgentRunError when the product already has a run in flight or a listing
   * proposal waiting for approval.
   */
  startListingOptimizer(input: StartListingOptimizerInput): Promise<AgentRun>;
  /**
   * Starts the campaign optimizer on an enabled campaign as `memberId`. Returns the running AgentRun
   * with its planned steps. Throws AgentRunError when the campaign already has a run in flight or a
   * campaign plan waiting for approval.
   */
  startCampaignOptimizer(input: StartCampaignOptimizerInput): Promise<AgentRun>;
  /**
   * Finishes a running agent run and files its output: for the listing optimizer, a proposed
   * ListingVersion, its Review and a pending Proposal; for the campaign optimizer, a pending
   * campaign_plan Proposal, unless it found nothing to change. Calling it on a finished run returns it as is.
   */
  completeAgentRun(runId: string): Promise<{ run: AgentRun; proposal?: Proposal }>;
  /** Newest first. */
  listAuditEvents(query: ActivityQuery): Promise<AuditEvent[]>;
}
