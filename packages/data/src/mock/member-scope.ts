import { canSeeAccount, seesWholeWorkspace, type Member, type SellerAccount } from "@app/core";
import { AgentRunError, type DataSource } from "../data-source";
import { ProposalWriteError } from "../proposal-writes";
import { SettingsWriteError } from "../settings-writes";

/** Which seller account a record belongs to, from the mock's own arrays. */
export type AccountLookups = {
  members: () => readonly Member[];
  sellerAccounts: () => readonly SellerAccount[];
  product: (id: string) => string | undefined;
  listingVersion: (id: string) => string | undefined;
  review: (id: string) => string | undefined;
  campaign: (id: string) => string | undefined;
  adGroup: (id: string) => string | undefined;
  target: (id: string) => string | undefined;
};

/**
 * The mock as one member sees it: the mock's stand-in for row-level security, applying the same
 * rules as supabase/migrations (canSeeAccount, seesWholeWorkspace). A client approver sees only their
 * accounts; everyone sees only their workspace. Writes may only be made as that member.
 */
export function scopeToMember(source: DataSource, member: Member, accountOf: AccountLookups): DataSource {
  const account = (id: string | undefined) => accountOf.sellerAccounts().find((candidate) => candidate.id === id);
  const sees = (sellerAccountId: string | undefined) => {
    const found = account(sellerAccountId);
    return found !== undefined && canSeeAccount(member, { workspaceId: found.workspaceId, sellerAccountId: found.id });
  };
  const visible = <T>(record: T | undefined, sellerAccountId: string | undefined) => (record !== undefined && sees(sellerAccountId) ? record : undefined);
  const visibleAccountIds = () => accountOf.sellerAccounts().filter((candidate) => sees(candidate.id)).map((candidate) => candidate.id);
  const limited = <T>(items: T[], limit?: number) => (limit === undefined ? items : items.slice(0, limit));

  const asSelf = <E extends Error>(memberId: string, error: () => E) => {
    if (memberId !== member.id) throw error();
  };
  const notYouProposal = () => new ProposalWriteError("forbidden", "You don't have permission to decide this proposal.");
  const notYouRun = () => new AgentRunError("forbidden", "You don't have permission to run agents on this account.");
  const notYouSettings = () => new SettingsWriteError("forbidden", "You can only make changes as yourself.");

  return {
    async listWorkspaces() {
      return (await source.listWorkspaces()).filter((workspace) => workspace.id === member.workspaceId);
    },
    async getWorkspace(id) {
      return id === member.workspaceId ? source.getWorkspace(id) : undefined;
    },
    async listMembers(workspaceId) {
      if (workspaceId !== member.workspaceId) return [];
      const mine = new Set(visibleAccountIds());
      // Members who see the whole workspace, or share one of your accounts.
      return (await source.listMembers(workspaceId)).filter(
        (other) => other.sellerAccountIds.length === 0 || other.sellerAccountIds.some((id) => mine.has(id)),
      );
    },
    async getActingMember(workspaceId) {
      return workspaceId === member.workspaceId ? member : undefined;
    },
    async listSellerAccounts(workspaceId) {
      return (await source.listSellerAccounts(workspaceId)).filter((candidate) => sees(candidate.id));
    },
    async getSellerAccount(id) {
      return visible(await source.getSellerAccount(id), id);
    },

    async updateWorkspaceBranding(input) {
      asSelf(input.memberId, notYouSettings);
      return source.updateWorkspaceBranding(input);
    },
    async updateSellerAccountSettings(input) {
      asSelf(input.memberId, notYouSettings);
      return source.updateSellerAccountSettings(input);
    },
    async connectSellerAccount(input) {
      asSelf(input.memberId, notYouSettings);
      return source.connectSellerAccount(input);
    },
    async inviteMember(input) {
      asSelf(input.memberId, notYouSettings);
      return source.inviteMember(input);
    },
    async updateMember(input) {
      asSelf(input.memberId, notYouSettings);
      return source.updateMember(input);
    },
    async removeMember(input) {
      asSelf(input.memberId, notYouSettings);
      return source.removeMember(input);
    },
    async setAgentsPaused(input) {
      asSelf(input.memberId, notYouSettings);
      return source.setAgentsPaused(input);
    },

    async listProducts(query) {
      return sees(query.sellerAccountId) ? source.listProducts(query) : [];
    },
    async getProduct(id) {
      return visible(await source.getProduct(id), accountOf.product(id));
    },
    async getProductFacts(productId) {
      return visible(await source.getProductFacts(productId), accountOf.product(productId));
    },
    async listListingVersions(productId) {
      return sees(accountOf.product(productId)) ? source.listListingVersions(productId) : [];
    },
    async listReviews(listingVersionId) {
      return sees(accountOf.listingVersion(listingVersionId)) ? source.listReviews(listingVersionId) : [];
    },
    async getReview(id) {
      return visible(await source.getReview(id), accountOf.review(id));
    },
    async listLiveListingReviews(sellerAccountId) {
      return sees(sellerAccountId) ? source.listLiveListingReviews(sellerAccountId) : [];
    },
    // Amazon's product type schemas, the same for every member.
    async searchProductTypes(query) {
      return source.searchProductTypes(query);
    },
    async getProductType(query) {
      return source.getProductType(query);
    },

    async listProposals(query) {
      return (await source.listProposals(query)).filter((proposal) => sees(proposal.sellerAccountId));
    },
    async getProposal(id) {
      const proposal = await source.getProposal(id);
      return visible(proposal, proposal?.sellerAccountId);
    },
    async approveProposal(input) {
      asSelf(input.memberId, notYouProposal);
      return source.approveProposal(input);
    },
    async rejectProposal(input) {
      asSelf(input.memberId, notYouProposal);
      return source.rejectProposal(input);
    },
    async snoozeProposal(input) {
      asSelf(input.memberId, notYouProposal);
      return source.snoozeProposal(input);
    },
    async publishProposal(input) {
      asSelf(input.memberId, notYouProposal);
      return source.publishProposal(input);
    },

    async listCampaigns(sellerAccountId) {
      return sees(sellerAccountId) ? source.listCampaigns(sellerAccountId) : [];
    },
    async getCampaign(id) {
      return visible(await source.getCampaign(id), accountOf.campaign(id));
    },
    async listAdGroups(campaignId) {
      return sees(accountOf.campaign(campaignId)) ? source.listAdGroups(campaignId) : [];
    },
    async getAdGroup(id) {
      return visible(await source.getAdGroup(id), accountOf.adGroup(id));
    },
    async listTargets(adGroupId) {
      return sees(accountOf.adGroup(adGroupId)) ? source.listTargets(adGroupId) : [];
    },
    async getTarget(id) {
      return visible(await source.getTarget(id), accountOf.target(id));
    },
    async listMetricsDaily(query) {
      return sees(query.sellerAccountId) ? source.listMetricsDaily(query) : [];
    },
    async getMetricsDateRange(sellerAccountId) {
      return sees(sellerAccountId) ? source.getMetricsDateRange(sellerAccountId) : undefined;
    },

    async listAgentRuns({ limit, ...query }) {
      return limited((await source.listAgentRuns(query)).filter((run) => sees(run.sellerAccountId)), limit);
    },
    async getAgentRun(id) {
      const run = await source.getAgentRun(id);
      return visible(run, run?.sellerAccountId);
    },
    async startListingOptimizer(input) {
      asSelf(input.memberId, notYouRun);
      return source.startListingOptimizer(input);
    },
    async startCampaignOptimizer(input) {
      asSelf(input.memberId, notYouRun);
      return source.startCampaignOptimizer(input);
    },
    async startCampaignStrategist(input) {
      asSelf(input.memberId, notYouRun);
      return source.startCampaignStrategist(input);
    },
    async startListingCreator(input) {
      asSelf(input.memberId, notYouRun);
      return source.startListingCreator(input);
    },
    async completeAgentRun(runId) {
      const run = await source.getAgentRun(runId);
      if (!run || !sees(run.sellerAccountId)) throw new AgentRunError("not_found", "That agent run doesn't exist.");
      return source.completeAgentRun(runId);
    },
    async listAuditEvents({ limit, ...query }) {
      const events = await source.listAuditEvents(query);
      return limited(
        events.filter((event) => (event.sellerAccountId ? sees(event.sellerAccountId) : seesWholeWorkspace(member, event.workspaceId))),
        limit,
      );
    },
  };
}
