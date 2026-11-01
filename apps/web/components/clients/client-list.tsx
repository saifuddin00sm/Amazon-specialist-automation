"use client";

import { CircleAlert, CircleCheck, OctagonAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClientRow } from "@/app/(app)/clients/load-clients";
import { AcosValue } from "@/components/campaigns/acos-value";
import { useSellerContext } from "@/components/shell/seller-context";
import { Button } from "@/components/ui/button";
import { relativeChange } from "@/lib/campaigns";
import { HEALTH_LABELS, type HealthStatus } from "@/lib/clients";
import { formatDay, formatMoney, formatPercent } from "@/lib/format";

const HEALTH_ICON = { healthy: CircleCheck, attention: CircleAlert, at_risk: OctagonAlert } as const;
const HEALTH_TONE: Record<HealthStatus, string> = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  attention: "text-amber-600 dark:text-amber-400",
  at_risk: "text-red-600 dark:text-red-400",
};
const HEALTH_ORDER: Record<HealthStatus, number> = { at_risk: 0, attention: 1, healthy: 2 };

/**
 * Every client account in the workspace picked in the top bar, worst health first. A client
 * approver only ever gets their own account here: the data source never returns the others.
 */
export function ClientList({ rows }: { rows: ClientRow[] }) {
  const { workspace, selectSellerAccount } = useSellerContext();
  const router = useRouter();
  const visible = rows
    .filter((row) => row.workspaceId === workspace?.id)
    .sort((a, b) => HEALTH_ORDER[a.health.status] - HEALTH_ORDER[b.health.status] || b.pending - a.pending || a.name.localeCompare(b.name));
  const count = (status: HealthStatus) => visible.filter((row) => row.health.status === status).length;
  const waiting = visible.reduce((sum, row) => sum + row.pending, 0);

  const open = (row: ClientRow, href: string) => {
    selectSellerAccount(row.id);
    router.push(href);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label="Summary">
        <span className="font-medium tabular-nums">
          {visible.length} {visible.length === 1 ? "client" : "clients"}
        </span>
        {(["at_risk", "attention", "healthy"] as const).map((status) => {
          const Icon = HEALTH_ICON[status];
          return (
            <span key={status} className="inline-flex items-center gap-1.5 tabular-nums">
              <Icon className={`size-4 ${HEALTH_TONE[status]}`} aria-hidden />
              {count(status)} {HEALTH_LABELS[status].toLowerCase()}
            </span>
          );
        })}
        <span className="text-muted-foreground tabular-nums">
          {waiting} {waiting === 1 ? "proposal" : "proposals"} waiting across clients
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm" data-testid="client-list">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 text-right font-medium">Sales, 30 days</th>
              <th className="px-3 py-2 text-right font-medium">ACoS</th>
              <th className="px-3 py-2 text-right font-medium">Listings</th>
              <th className="px-3 py-2 font-medium">Waiting</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((row) => {
              const Icon = HEALTH_ICON[row.health.status];
              const change = row.sales.previous === undefined ? undefined : relativeChange(row.sales.previous, row.sales.current);
              return (
                <tr key={row.id} className="align-top" data-client={row.name}>
                  <td className="px-3 py-2.5">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => open(row, "/dashboard")}>
                      {row.name}
                    </button>
                    <span className="block text-xs text-muted-foreground">
                      Amazon {row.marketplace} · autonomy {row.autonomyLevel}
                      {row.agentsPaused && " · agents paused"}
                    </span>
                  </td>
                  <td className="max-w-xs px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 font-medium ${HEALTH_TONE[row.health.status]}`}>
                      <Icon className="size-4" aria-hidden />
                      {HEALTH_LABELS[row.health.status]}
                    </span>
                    {row.health.issues.length > 0 && (
                      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {row.health.issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatMoney(row.sales.current, row.currency)}
                    {change !== undefined && (
                      <span className="block text-xs text-muted-foreground">
                        {change >= 0 ? "+" : "−"}
                        {formatPercent(Math.abs(change), 0)} on prior 30 days
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <AcosValue acos={row.acos} target={row.targetAcos} />
                    <span className="block text-xs text-muted-foreground tabular-nums">target {formatPercent(row.targetAcos, 0)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{row.listingScore === undefined ? "–" : `${row.listingScore}/100`}</td>
                  <td className="px-3 py-2.5">
                    {row.pending === 0 ? (
                      <span className="text-muted-foreground">Nothing waiting</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular-nums">
                          {row.pending}
                          {row.highRisk > 0 && <span className="text-xs text-muted-foreground"> · {row.highRisk} high risk</span>}
                        </span>
                        <Button asChild size="xs" variant="outline">
                          <Link href={`/approvals?account=${row.id}`} onClick={() => selectSellerAccount(row.id)}>
                            Review
                          </Link>
                        </Button>
                      </div>
                    )}
                    {row.latestData && <span className="block text-xs text-muted-foreground">Data to {formatDay(row.latestData)}</span>}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  No client accounts in this workspace.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
