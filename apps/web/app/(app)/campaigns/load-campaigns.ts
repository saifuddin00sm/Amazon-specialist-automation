import type { AdMetricsDaily, Campaign, Currency, SellerAccount } from "@app/core";
import type { DataSource, DateRange } from "@app/data";
import { campaignWindows, dailyAds, summarizeAds, type AdSummary, type DailyAds } from "@/lib/campaigns";
import { getDataSource } from "@/lib/data";

/** One campaign in the list, with its numbers for the last 30 days and the 30 before. */
export type CampaignRow = Pick<Campaign, "id" | "sellerAccountId" | "name" | "type" | "targetingType" | "state" | "dailyBudget"> & {
  currency: Currency;
  targetAcos: number;
  current: AdSummary;
  /** Undefined when the account has no metrics from before the current window. */
  previous?: AdSummary;
  daily: DailyAds[];
  /** A campaign plan for this campaign waiting for approval. */
  pendingPlanId?: string;
};

export type CampaignsData = {
  rows: CampaignRow[];
  /** The days the numbers cover, per seller account. */
  windows: Record<string, DateRange>;
};

/** Every account's campaigns; the table narrows to the account picked in the top bar. */
export async function loadCampaigns(): Promise<CampaignsData> {
  const dataSource = await getDataSource();
  const [workspaces, accounts] = await Promise.all([dataSource.listWorkspaces(), dataSource.listSellerAccounts()]);
  const pending = (
    await Promise.all(
      workspaces.map((workspace) =>
        dataSource.listProposals({ workspaceId: workspace.id, status: "pending_approval", type: "campaign_plan" }),
      ),
    )
  ).flat();
  const planFor = new Map(pending.map((proposal) => [proposal.target.id, proposal.id]));

  const perAccount = await Promise.all(accounts.map((account) => loadAccount(dataSource, account, planFor)));
  return {
    rows: perAccount.flatMap(({ rows }) => rows),
    windows: Object.fromEntries(perAccount.flatMap(({ accountId, window }) => (window ? [[accountId, window]] : []))),
  };
}

async function loadAccount(dataSource: DataSource, account: SellerAccount, planFor: Map<string, string>) {
  const [available, campaigns] = await Promise.all([dataSource.getMetricsDateRange(account.id), dataSource.listCampaigns(account.id)]);
  const windows = campaignWindows(available);
  const metrics: AdMetricsDaily[] = windows
    ? await dataSource.listMetricsDaily({
        sellerAccountId: account.id,
        entityType: "campaign",
        range: { from: windows.previous?.from ?? windows.current.from, to: windows.current.to },
      })
    : [];
  const byCampaign = new Map<string, AdMetricsDaily[]>();
  for (const row of metrics) byCampaign.set(row.entityId, [...(byCampaign.get(row.entityId) ?? []), row]);

  const rows = campaigns.map((campaign): CampaignRow => {
    const own = byCampaign.get(campaign.id) ?? [];
    const empty = { spend: 0, sales: 0, orders: 0, clicks: 0 };
    return {
      id: campaign.id,
      sellerAccountId: campaign.sellerAccountId,
      name: campaign.name,
      type: campaign.type,
      targetingType: campaign.targetingType,
      state: campaign.state,
      dailyBudget: campaign.dailyBudget,
      currency: account.currency,
      targetAcos: account.targetAcos,
      current: windows ? summarizeAds(own, windows.current) : empty,
      previous: windows?.previous && summarizeAds(own, windows.previous),
      daily: windows ? dailyAds(own, windows.current) : [],
      pendingPlanId: planFor.get(campaign.id),
    };
  });
  return { accountId: account.id, window: windows?.current, rows };
}
