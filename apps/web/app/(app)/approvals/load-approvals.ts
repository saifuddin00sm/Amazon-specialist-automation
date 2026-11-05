import {
  CAMPAIGN_GOALS,
  checkProposalCompliance,
  guardrailsFor,
  parseNewCampaignPlan,
  type Guardrails,
  type ComplianceCheck,
  type ListingCopy,
  type MemberRole,
  type ProductFacts,
  type Proposal,
  type Review,
  type SellerAccount,
} from "@app/core";
import type { DataSource } from "@app/data";
import { planLabels, type PlanLabels } from "@/lib/campaigns";
import { getDataSource } from "@/lib/data";
import { CAMPAIGN_TYPE_LABELS, targetLabel } from "@/lib/format";

/** Everything the approvals UI needs to show and decide one proposal. */
export type ApprovalItem = {
  proposal: Proposal;
  account: Pick<SellerAccount, "id" | "name" | "marketplace" | "currency" | "autonomyLevel"> & {
    /** The account's caps, which the live compliance check needs too. */
    guardrails: Guardrails;
  };
  /** What the proposal changes, in words: a product, a keyword, a campaign. */
  subject: { label: string; detail?: string };
  review?: Review;
  /** Live listing copy, for listing updates. Compliance checks the full listing, not only the diff. */
  liveListing?: ListingCopy;
  facts?: ProductFacts;
  /** Ad group and target names for the ids in a campaign plan's diff. */
  planLabels?: PlanLabels;
  /** Titles of the products a new campaign plan advertises, by id. */
  productTitles?: Record<string, string>;
  compliance: ComplianceCheck[];
  snoozed: boolean;
};

export type ActingMember = { id: string; name: string; role: MemberRole };

export type ApprovalsData = {
  items: ApprovalItem[];
  /** Who decisions are recorded as, per workspace. */
  actingMembers: Record<string, ActingMember>;
};

/** Pending proposals across every workspace; the client narrows to the selected one. */
export async function loadApprovals(): Promise<ApprovalsData> {
  const dataSource = await getDataSource();
  const [workspaces, accounts] = await Promise.all([dataSource.listWorkspaces(), dataSource.listSellerAccounts()]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const perWorkspace = await Promise.all(
    workspaces.map(async (workspace) => {
      const [queued, snoozed, member] = await Promise.all([
        dataSource.listProposals({ workspaceId: workspace.id, status: "pending_approval", snoozed: false }),
        dataSource.listProposals({ workspaceId: workspace.id, status: "pending_approval", snoozed: true }),
        dataSource.getActingMember(workspace.id),
      ]);
      const items = await Promise.all([
        ...queued.map((proposal) => toItem(dataSource, proposal, accountById, false)),
        ...snoozed.map((proposal) => toItem(dataSource, proposal, accountById, true)),
      ]);
      return { workspaceId: workspace.id, member, items };
    }),
  );

  return {
    items: perWorkspace.flatMap(({ items }) => items.flatMap((item) => (item ? [item] : []))),
    actingMembers: Object.fromEntries(
      perWorkspace.flatMap(({ workspaceId, member }) =>
        member ? [[workspaceId, { id: member.id, name: member.name, role: member.role }]] : [],
      ),
    ),
  };
}

async function toItem(
  dataSource: DataSource,
  proposal: Proposal,
  accountById: Map<string, SellerAccount>,
  snoozed: boolean,
): Promise<ApprovalItem | undefined> {
  const account = accountById.get(proposal.sellerAccountId);
  if (!account) return undefined;

  const context = await loadContext(dataSource, proposal);
  return {
    proposal,
    account: {
      id: account.id,
      name: account.name,
      marketplace: account.marketplace,
      currency: account.currency,
      autonomyLevel: account.autonomyLevel,
      guardrails: guardrailsFor(account),
    },
    ...context,
    compliance: checkProposalCompliance({
      type: proposal.type,
      diff: proposal.diff,
      liveListing: context.liveListing,
      facts: context.facts,
      guardrails: guardrailsFor(account),
    }),
    snoozed,
  };
}

async function loadContext(
  dataSource: DataSource,
  proposal: Proposal,
): Promise<Pick<ApprovalItem, "subject" | "review" | "liveListing" | "facts" | "planLabels" | "productTitles">> {
  const { target } = proposal;
  const review = proposal.reviewId ? await dataSource.getReview(proposal.reviewId) : undefined;

  switch (target.type) {
    case "product": {
      const [product, facts, versions] = await Promise.all([
        dataSource.getProduct(target.id),
        dataSource.getProductFacts(target.id),
        dataSource.listListingVersions(target.id),
      ]);
      const live = versions.find((version) => version.status === "live");
      return {
        subject: { label: product?.title ?? target.id, detail: product ? `ASIN ${product.asin} · SKU ${product.sku}` : undefined },
        review,
        facts,
        liveListing: live && {
          title: live.title,
          bullets: live.bullets,
          description: live.description,
          backendKeywords: live.backendKeywords,
        },
      };
    }
    case "target": {
      const keyword = await dataSource.getTarget(target.id);
      const adGroup = keyword && (await dataSource.getAdGroup(keyword.adGroupId));
      const campaign = adGroup && (await dataSource.getCampaign(adGroup.campaignId));
      return {
        subject: {
          label: keyword ? targetLabel(keyword) : target.id,
          detail: campaign && adGroup ? `${campaign.name} › ${adGroup.name}` : undefined,
        },
        review,
      };
    }
    case "ad_group": {
      const adGroup = await dataSource.getAdGroup(target.id);
      const campaign = adGroup && (await dataSource.getCampaign(adGroup.campaignId));
      return { subject: { label: adGroup?.name ?? target.id, detail: campaign?.name }, review };
    }
    case "campaign": {
      const campaign = await dataSource.getCampaign(target.id);
      if (proposal.type === "campaign_plan") {
        const adGroups = await dataSource.listAdGroups(target.id);
        const targets = (await Promise.all(adGroups.map((adGroup) => dataSource.listTargets(adGroup.id)))).flat();
        return {
          subject: {
            label: campaign?.name ?? target.id,
            detail: campaign ? `${CAMPAIGN_TYPE_LABELS[campaign.type]}, ${campaign.targetingType} targeting` : undefined,
          },
          review,
          planLabels: planLabels(adGroups, targets),
        };
      }
      return {
        subject: {
          label: campaign?.name ?? target.id,
          detail: campaign ? `Daily budget, ${campaign.targetingType} targeting` : undefined,
        },
        review,
      };
    }
    case "seller_account": {
      if (proposal.type !== "new_campaign") break;
      const { brief, campaigns } = parseNewCampaignPlan(proposal.diff);
      const products = (await Promise.all((brief?.productIds ?? []).map((id) => dataSource.getProduct(id)))).flatMap((product) => (product ? [product] : []));
      const [first] = products;
      return {
        subject: {
          label: products.length === 1 && first ? first.title : `${products.length} products`,
          detail: `${campaigns.length} new Sponsored Products campaigns${brief ? `, ${CAMPAIGN_GOALS[brief.goal].label.toLowerCase()} goal` : ""}`,
        },
        review,
        productTitles: Object.fromEntries(products.map((product) => [product.id, product.title])),
      };
    }
  }
  return { subject: { label: `${target.type} ${target.id}` }, review };
}
