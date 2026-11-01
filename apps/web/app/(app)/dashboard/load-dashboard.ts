import type { Actor, AgentName, AgentRunStatus, Currency, ProposalRisk, ProposalType, SellerAccount } from "@app/core";
import type { DataSource, DateRange } from "@app/data";
import {
  adTotals,
  averageListingScore,
  dailySalesAndSpend,
  dashboardWindow,
  opportunityScore,
  topOpportunities,
  type AdTotals,
  type DailySalesAndSpend,
} from "@/lib/dashboard";
import { getDataSource } from "@/lib/data";

const ACTIVITY_LIMIT = 8;
const OPPORTUNITY_LIMIT = 5;

export type DashboardActivity = {
  runId: string;
  agent: AgentName;
  status: AgentRunStatus;
  summary: string;
  startedAt: string;
  proposalCount: number;
  /** The product the run worked on, when it worked on one. */
  product?: { id: string; title: string };
};

export type DashboardOpportunity = {
  proposalId: string;
  type: ProposalType;
  risk: ProposalRisk;
  title: string;
  createdBy: Actor;
  /** Impact weighted by confidence, 0–100. */
  opportunityScore: number;
};

/** Everything the dashboard shows for one seller account. Every number is read from the DataSource. */
export type AccountDashboard = {
  sellerAccountId: string;
  currency: Currency;
  targetAcos: number;
  /** The days the totals and chart cover; undefined when the account has no metrics yet. */
  window?: DateRange;
  listings: { averageScore?: number; reviewed: number; products: number };
  approvals: { pending: number; highRisk: number };
  ads: AdTotals;
  sales: number;
  daily: DailySalesAndSpend[];
  activity: DashboardActivity[];
  opportunities: DashboardOpportunity[];
};

/** One dashboard per seller account the member can see; the client shows the one picked in the top bar. */
export async function loadDashboards(): Promise<Record<string, AccountDashboard>> {
  const dataSource = await getDataSource();
  const accounts = await dataSource.listSellerAccounts();
  const dashboards = await Promise.all(accounts.map((account) => loadAccount(dataSource, account)));
  return Object.fromEntries(dashboards.map((dashboard) => [dashboard.sellerAccountId, dashboard]));
}

async function loadAccount(dataSource: DataSource, account: SellerAccount): Promise<AccountDashboard> {
  const [available, products, reviews, pending, runs] = await Promise.all([
    dataSource.getMetricsDateRange(account.id),
    dataSource.listProducts({ sellerAccountId: account.id }),
    dataSource.listLiveListingReviews(account.id),
    dataSource.listProposals({
      workspaceId: account.workspaceId,
      sellerAccountId: account.id,
      status: "pending_approval",
      snoozed: false,
    }),
    dataSource.listAgentRuns({ workspaceId: account.workspaceId, sellerAccountId: account.id, limit: ACTIVITY_LIMIT }),
  ]);

  const window = dashboardWindow(available);
  const [productRows, campaignRows] = window
    ? await Promise.all([
        dataSource.listMetricsDaily({ sellerAccountId: account.id, entityType: "product", range: window }),
        dataSource.listMetricsDaily({ sellerAccountId: account.id, entityType: "campaign", range: window }),
      ])
    : [[], []];
  const daily = window ? dailySalesAndSpend(window, productRows, campaignRows) : [];
  const productTitle = new Map(products.map((product) => [product.id, product.title]));

  return {
    sellerAccountId: account.id,
    currency: account.currency,
    targetAcos: account.targetAcos,
    window,
    listings: { averageScore: averageListingScore(reviews), reviewed: reviews.length, products: products.length },
    approvals: { pending: pending.length, highRisk: pending.filter((proposal) => proposal.risk === "high").length },
    ads: adTotals(campaignRows),
    sales: Math.round(daily.reduce((sum, day) => sum + day.sales, 0) * 100) / 100,
    daily,
    activity: runs.map((run) => {
      const title = run.subject?.type === "product" ? productTitle.get(run.subject.id) : undefined;
      return {
        runId: run.id,
        agent: run.agent,
        status: run.status,
        summary: run.summary,
        startedAt: run.startedAt,
        proposalCount: run.proposalIds.length,
        product: run.subject && title ? { id: run.subject.id, title } : undefined,
      };
    }),
    opportunities: topOpportunities(pending, OPPORTUNITY_LIMIT).map((proposal) => ({
      proposalId: proposal.id,
      type: proposal.type,
      risk: proposal.risk,
      title: proposal.title,
      createdBy: proposal.createdBy,
      opportunityScore: opportunityScore(proposal),
    })),
  };
}
