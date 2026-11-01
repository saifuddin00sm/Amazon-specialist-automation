"use client";

import type { AccountDashboard } from "@/app/(app)/dashboard/load-dashboard";
import { useSellerContext } from "@/components/shell/seller-context";
import { formatDay } from "@/lib/format";
import { ActivityFeed } from "./activity-feed";
import { KpiCards } from "./kpi-cards";
import { SalesSpendChart } from "./sales-spend-chart";
import { TopOpportunities } from "./top-opportunities";

/** The dashboard of the seller account picked in the top bar. */
export function DashboardView({ dashboards }: { dashboards: Record<string, AccountDashboard> }) {
  const { sellerAccount } = useSellerContext();
  const dashboard = sellerAccount && dashboards[sellerAccount.id];

  if (!sellerAccount || !dashboard) {
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Pick a seller account in the top bar to see its dashboard.
      </p>
    );
  }

  const { window } = dashboard;
  return (
    <div className="flex flex-col gap-4" data-testid="dashboard">
      <p className="text-sm text-muted-foreground">
        {sellerAccount.name} ·{" "}
        {window ? `Totals for ${formatDay(window.from)} – ${formatDay(window.to)}, the latest reported days` : "No metrics reported yet"}
      </p>
      <KpiCards dashboard={dashboard} />
      <SalesSpendChart
        daily={dashboard.daily}
        totals={{ sales: dashboard.sales, spend: dashboard.ads.spend }}
        currency={dashboard.currency}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ActivityFeed activity={dashboard.activity} />
        <TopOpportunities opportunities={dashboard.opportunities} />
      </div>
    </div>
  );
}
