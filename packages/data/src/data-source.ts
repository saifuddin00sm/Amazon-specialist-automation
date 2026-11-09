import type {
  AdGroup,
  AgentRun,
  AuditEvent,
  Branding,
  Campaign,
  CampaignBrief,
  DiffEdit,
  ImportedListing,
  ListingVersion,
  Marketplace,
  Member,
  MemberRole,
  MetricsDaily,
  MetricsEntityType,
  NewListingBrief,
  Product,
  ProductFacts,
  ProductStatus,
  ProductType,
  ProductTypeSummary,
  Proposal,
  ProposalStatus,
  ProposalType,
  Review,
  SellerAccount,
  Target,
  Workspace,
} from "@app/core";
import type { CatalogImportCounts } from "./catalog-sync";
import type { AccountSettingsChange } from "./settings-writes";

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

export type PublishProposalInput = ProposalWrite;

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

/** The New campaign wizard's brief for one seller account's products. */
export type StartCampaignStrategistInput = { sellerAccountId: string; memberId: string; brief: CampaignBrief };

/** The New listing wizard's brief for a product that isn't on Amazon yet. */
export type StartListingCreatorInput = { sellerAccountId: string; memberId: string; brief: NewListingBrief };

/** Amazon product types in one marketplace; no keywords lists them all. */
export type ProductTypeQuery = { marketplace: Marketplace; keywords?: string };

/** Report branding for a workspace; null goes back to the default. */
export type UpdateWorkspaceBrandingInput = { workspaceId: string; memberId: string; branding: Branding | null };

/** Guardrails and autonomy for one account. Fields left out stay as they are. */
export type UpdateSellerAccountSettingsInput = { sellerAccountId: string; memberId: string } & AccountSettingsChange;

export type ConnectSellerAccountInput = {
  workspaceId: string;
  memberId: string;
  name: string;
  marketplace: Marketplace;
  /** Amazon's merchant token, for an account Amazon authorized. Left out, Phase 1 makes one up. */
  sellerId?: string;
};

/** One page of a catalog sync: listings as Amazon has them now. `syncedAt` names the sync. */
export type ImportCatalogListingsInput = { sellerAccountId: string; syncedAt: string; listings: ImportedListing[] };

/** Ends a catalog sync that saw every listing, with what it did for the audit log. */
export type FinishCatalogSyncInput = {
  sellerAccountId: string;
  syncedAt: string;
  counts: CatalogImportCounts;
  /** Why listings, or their copy, were left out, with how many. */
  skipped: Record<string, number>;
};

/** `memberId` makes the change; the team writes act on someone else. */
export type InviteMemberInput = { workspaceId: string; memberId: string; name: string; email: string; role: MemberRole; sellerAccountIds: string[] };
export type UpdateMemberInput = { memberId: string; targetMemberId: string; role: MemberRole; sellerAccountIds: string[] };
export type RemoveMemberInput = { memberId: string; targetMemberId: string };

export type SetAgentsPausedInput = { workspaceId: string; memberId: string; paused: boolean };

export type AgentRunErrorCode = "not_found" | "forbidden" | "conflict" | "invalid_input";

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
  /** Sets an account's guardrails and autonomy as its workspace's owner. Writes settings.updated. */
  updateSellerAccountSettings(input: UpdateSellerAccountSettingsInput): Promise<SellerAccount>;
  /**
   * Connects a new seller account as the workspace's owner. Nothing is sent to Amazon: its
   * authorization is stored apart (packages/workflows), and the account starts without data until the
   * catalog sync runs. Writes seller_account.connected.
   */
  connectSellerAccount(input: ConnectSellerAccountInput): Promise<SellerAccount>;
  /** Owners manage the team. Each write records member.invited, member.updated or member.removed. */
  inviteMember(input: InviteMemberInput): Promise<Member>;
  updateMember(input: UpdateMemberInput): Promise<Member>;
  removeMember(input: RemoveMemberInput): Promise<void>;
  /**
   * The kill switch. Pausing cancels the workspace's runs in flight; until an owner resumes, no
   * agent starts, files or auto-approves anything. Writes agents.paused or agents.resumed.
   * Settings writes throw SettingsWriteError when refused.
   */
  setAgentsPaused(input: SetAgentsPausedInput): Promise<Workspace>;

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
  /**
   * Product types matching the keywords, best match first, for the New listing wizard. They come from
   * Amazon's Product Type Definitions API; Phase 1 serves a mock catalog.
   */
  searchProductTypes(query: ProductTypeQuery): Promise<ProductTypeSummary[]>;
  /** One product type's attribute schema in a marketplace: what a new listing must and should have. */
  getProductType(query: { marketplace: Marketplace; productType: string }): Promise<ProductType | undefined>;
  /**
   * The catalog sync's import of one page of listings. Backend only (the secret key): members are
   * refused with CatalogSyncError. Products are matched by SKU: new ones are added and the rest
   * brought up to date; a listing whose copy changed gets a new live ListingVersion written by the
   * system, superseding the old one. Changes nothing on Amazon.
   */
  importCatalogListings(input: ImportCatalogListingsInput): Promise<CatalogImportCounts>;
  /**
   * Ends a catalog sync that saw every listing. Backend only. Products the sync didn't see are no
   * longer on Amazon and become inactive. Writes catalog.synced.
   */
  finishCatalogSync(input: FinishCatalogSyncInput): Promise<{ deactivated: number }>;

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
  /**
   * Publishes an approved proposal, which becomes applied. Anything not approved is refused with
   * code invalid_transition. Phase 1 mocks Amazon: nothing is sent. Writes proposal.applied.
   */
  publishProposal(input: PublishProposalInput): Promise<Proposal>;

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
   * Starts the campaign strategist on a brief from the New campaign wizard as `memberId`. Returns the
   * running AgentRun, whose plan steps hold the campaigns it will propose. Throws AgentRunError for
   * products outside the account or inactive, a budget too small to split, or a run already in flight.
   */
  startCampaignStrategist(input: StartCampaignStrategistInput): Promise<AgentRun>;
  /**
   * Starts the listing creator on a brief from the New listing wizard as `memberId`. Returns the
   * running AgentRun, whose plan steps hold every attribute it will propose. Throws AgentRunError for
   * an unknown product type or a brief missing a required attribute. Several can run at once.
   */
  startListingCreator(input: StartListingCreatorInput): Promise<AgentRun>;
  /**
   * Finishes a running agent run and files its output: for the listing optimizer, a proposed
   * ListingVersion, its Review and a pending Proposal; for the campaign optimizer, a pending
   * campaign_plan Proposal, unless it found nothing to change; for the campaign strategist, a pending
   * new_campaign Proposal; for the listing creator, a pending new_listing Proposal. Calling it on a
   * finished run returns it as is.
   */
  completeAgentRun(runId: string): Promise<{ run: AgentRun; proposal?: Proposal }>;
  /** Newest first. */
  listAuditEvents(query: ActivityQuery): Promise<AuditEvent[]>;
}
