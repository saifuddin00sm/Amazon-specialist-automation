"use client";

import { autonomyFor } from "@app/core";
import { useSellerContext } from "@/components/shell/seller-context";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDay } from "@/lib/format";
import { ConnectAmazonDialog, MARKETPLACE_NAMES } from "./connect-amazon-dialog";
import { OwnersOnlyNote, SettingsSection } from "./settings-tabs";

/** The workspace's seller accounts and how current their data is. Owners connect more. */
export function ConnectionsView({ lastData }: { lastData: Record<string, string | undefined> }) {
  const { workspace, sellerAccounts, member } = useSellerContext();
  if (!workspace) return null;
  const canEdit = member?.role === "owner";

  return (
    <SettingsSection
      title="Amazon connections"
      description={`Seller Central accounts connected to ${workspace.name}.`}
      aside={canEdit && <ConnectAmazonDialog />}
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" data-testid="connections">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Marketplace</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Latest data</th>
              <th className="px-3 py-2 font-medium">Autonomy</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sellerAccounts.map((account) => {
              const latest = lastData[account.id];
              return (
                <tr key={account.id}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{account.name}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">Seller ID {account.sellerId}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{MARKETPLACE_NAMES[account.marketplace]}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                      Connected
                    </Badge>
                    <span className="block text-xs text-muted-foreground">since {formatDateTime(account.connectedAt)}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{latest ? formatDay(latest) : "Waiting for first data"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {account.autonomyLevel}
                    {account.autonomyByAction && Object.keys(account.autonomyByAction).length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        plans {autonomyFor(account, "campaign_plan")} · listings {autonomyFor(account, "listing_update")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <OwnersOnlyNote canEdit={canEdit} what="connect accounts" />
    </SettingsSection>
  );
}
