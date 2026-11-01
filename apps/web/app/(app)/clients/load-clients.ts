import type { AutonomyLevel, Currency, Marketplace, SellerAccount, Workspace } from "@app/core";
import type { DataSource } from "@app/data";
import { campaignWindows, summarizeAds } from "@/lib/campaigns";
import { clientHealth, type HealthStatus } from "@/lib/clients";
import { averageListingScore } from "@/lib/dashboard";
import { getDataSource } from "@/lib/data";

/** One client account with its numbers for the last 30 days and what is waiting on it. */
export type ClientRow = {
  id: string;
  workspaceId: string;
  name: string;
  marketplace: Marketplace;
  currency: Currency;
  autonomyLevel: AutonomyLevel;
  targetAcos: number;
  sales: { current: number; previous?: number };
  acos?: number;
  listingScore?: number;
  pending: number;
  highRisk: number;
  oldestPendingAt?: string;
  /** Newest day Amazon reported. */
  latestData?: string;
  agentsPaused: boolean;
  health: { status: HealthStatus; issues: string[] };
};

/** Every account the member can see; a client approver gets only their own. */
export async function loadClients(): Promise<ClientRow[]> {
  const dataSource = await getDataSource();
  const [workspaces, accounts] = await Promise.all([dataSource.listWorkspaces(), dataSource.listSellerAccounts()]);
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const now = new Date().toISOString();
  return Promise.all(accounts.map((account) => loadClient(dataSource, account, workspaceById.get(account.workspaceId), now)));
}

async function loadClient(dataSource: DataSource, account: SellerAccount, workspace: Workspace | undefined, now: string): Promise<ClientRow> {
  const [available, reviews, pending] = await Promise.all([
    dataSource.getMetricsDateRange(account.id),
    dataSource.listLiveListingReviews(account.id),
    dataSource.listProposals({ workspaceId: account.workspaceId, sellerAccountId: account.id, status: "pending_approval" }),
  ]);
  const windows = campaignWindows(available);
  const range = windows && { from: windows.previous?.from ?? windows.current.from, to: windows.current.to };
  const [productRows, campaignRows] = range
    ? await Promise.all([
        dataSource.listMetricsDaily({ sellerAccountId: account.id, entityType: "product", range }),
        dataSource.listMetricsDaily({ sellerAccountId: account.id, entityType: "campaign", range }),
      ])
    : [[], []];

  const salesIn = (window: { from: string; to: string }) =>
    Math.round(productRows.filter((row) => row.date >= window.from && row.date <= window.to).reduce((sum, row) => sum + row.orderedRevenue, 0) * 100) / 100;
  const sales = windows ? { current: salesIn(windows.current), ...(windows.previous ? { previous: salesIn(windows.previous) } : {}) } : { current: 0 };
  const ads = windows ? summarizeAds(campaignRows, windows.current) : undefined;
  const listingScore = averageListingScore(reviews);
  const oldestPendingAt = pending.reduce<string | undefined>((oldest, proposal) => (!oldest || proposal.createdAt < oldest ? proposal.createdAt : oldest), undefined);
  const highRisk = pending.filter((proposal) => proposal.risk === "high").length;

  return {
    id: account.id,
    workspaceId: account.workspaceId,
    name: account.name,
    marketplace: account.marketplace,
    currency: account.currency,
    autonomyLevel: account.autonomyLevel,
    targetAcos: account.targetAcos,
    sales,
    acos: ads?.acos,
    listingScore,
    pending: pending.length,
    highRisk,
    oldestPendingAt,
    latestData: available?.to,
    agentsPaused: workspace?.agentsPausedAt !== undefined,
    health: clientHealth({
      sales,
      acos: ads?.acos,
      targetAcos: account.targetAcos,
      listingScore,
      pending: pending.length,
      highRisk,
      oldestPendingAt,
      hasData: available !== undefined,
      now,
    }),
  };
}
