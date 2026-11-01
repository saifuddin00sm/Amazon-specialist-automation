import type { SellerAccount } from "@app/core";
import type { DataSource, DateRange } from "@app/data";
import { getDataSource } from "@/lib/data";
import { buildWeeklyReport, reportWeeks, weekBefore, type WeeklyReport } from "@/lib/reports";

export type AccountReport = {
  /** Undefined when the account has no full week of metrics yet. */
  report?: WeeklyReport;
  /** Weeks a report can cover, newest first. */
  weeks: DateRange[];
};

/** One account's report for the week ending `weekEnd` (YYYY-MM-DD), or its latest week. */
export async function loadWeeklyReport(dataSource: DataSource, account: SellerAccount, weekEnd?: string): Promise<AccountReport> {
  const available = await dataSource.getMetricsDateRange(account.id);
  const weeks = reportWeeks(available);
  const week = weeks.find((candidate) => candidate.to === weekEnd) ?? weeks[0];
  if (!available || !week) return { weeks };
  const before = weekBefore(week);
  const previous = before.from >= available.from ? before : undefined;
  const range = { from: previous?.from ?? week.from, to: week.to };

  const [workspace, productRows, campaignRows, products, campaigns, proposals, members] = await Promise.all([
    dataSource.getWorkspace(account.workspaceId),
    dataSource.listMetricsDaily({ sellerAccountId: account.id, entityType: "product", range }),
    dataSource.listMetricsDaily({ sellerAccountId: account.id, entityType: "campaign", range }),
    dataSource.listProducts({ sellerAccountId: account.id }),
    dataSource.listCampaigns(account.id),
    dataSource.listProposals({ workspaceId: account.workspaceId, sellerAccountId: account.id }),
    dataSource.listMembers(account.workspaceId),
  ]);
  if (!workspace) return { weeks };

  return {
    weeks,
    report: buildWeeklyReport({
      account,
      workspace,
      week,
      previous,
      productRows,
      campaignRows,
      products,
      campaigns,
      proposals,
      members,
      generatedAt: new Date().toISOString(),
    }),
  };
}

/** Every account's report for the same week; the page shows the account picked in the top bar. */
export async function loadReports(weekEnd?: string): Promise<Record<string, AccountReport>> {
  const dataSource = await getDataSource();
  const accounts = await dataSource.listSellerAccounts();
  const reports = await Promise.all(accounts.map((account) => loadWeeklyReport(dataSource, account, weekEnd)));
  return Object.fromEntries(accounts.map((account, i) => [account.id, reports[i]!]));
}

/** One account's report, for the print view. Undefined when the account isn't visible. */
export async function loadReportFor(accountId: string, weekEnd?: string): Promise<AccountReport | undefined> {
  const dataSource = await getDataSource();
  const account = await dataSource.getSellerAccount(accountId);
  return account && loadWeeklyReport(dataSource, account, weekEnd);
}
