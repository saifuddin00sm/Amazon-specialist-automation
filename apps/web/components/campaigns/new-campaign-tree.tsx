import { CAMPAIGN_ROLE_LABELS, type Actor, type Currency, type NewCampaign, type NewTarget } from "@app/core";
import { ChevronRight } from "lucide-react";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";

/**
 * Campaigns a new_campaign plan would create, as a tree: campaign → ad groups → targets, with
 * budgets, bids and negatives. Nothing here exists on Amazon yet, so there are no numbers to show.
 */
export function NewCampaignTree({
  campaigns,
  currency,
  productTitles,
  createdBy,
}: {
  campaigns: readonly NewCampaign[];
  currency: Currency;
  /** Titles of the advertised products, by id. */
  productTitles?: Record<string, string>;
  /** Who drafted the plan; agent plans get the AIGenerated badge. Left out for a preview. */
  createdBy?: Actor;
}) {
  const money = (amount: number) => formatMoney(amount, currency);
  const advertised = [...new Set(campaigns.flatMap((campaign) => campaign.adGroups.flatMap((adGroup) => adGroup.productIds)))];

  return (
    <div className="flex flex-col gap-3" data-testid="new-campaign-tree">
      {productTitles && advertised.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Advertises {advertised.map((id) => productTitles[id] ?? id).join(" · ")}
        </p>
      )}
      {campaigns.map((campaign) => (
        <details key={campaign.role} open className="group/campaign rounded-xl border bg-card" data-testid="new-campaign">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-open/campaign:rotate-90" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">{campaign.name}</span>
              <span className="text-xs text-muted-foreground">{CAMPAIGN_ROLE_LABELS[campaign.role]}</span>
            </span>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
              New
            </Badge>
            <span className="text-muted-foreground capitalize">{campaign.targetingType} targeting</span>
            <span className="text-muted-foreground">
              Daily budget <span className="font-medium text-foreground tabular-nums">{money(campaign.dailyBudget)}</span>
            </span>
            <span className="text-muted-foreground capitalize">{campaign.biddingStrategy.replaceAll("_", " ")} bidding</span>
            {createdBy && (
              <span className="ml-auto">
                <AIGeneratedBadge actor={createdBy} compact />
              </span>
            )}
          </summary>

          <div className="ml-7 flex flex-col gap-2 border-t border-l px-3 py-3">
            {campaign.adGroups.map((adGroup) => (
              <details key={adGroup.name} open className="group/ad-group rounded-lg border" data-testid="new-ad-group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-open/ad-group:rotate-90" aria-hidden />
                  <span className="font-medium">{adGroup.name}</span>
                  <span className="text-muted-foreground">
                    Default bid <span className="text-foreground tabular-nums">{money(adGroup.defaultBid)}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {adGroup.targets.length} {adGroup.targets.length === 1 ? "target" : "targets"} · {adGroup.productIds.length}{" "}
                    {adGroup.productIds.length === 1 ? "product" : "products"}
                  </span>
                </summary>
                <div className="overflow-x-auto border-t">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Target</th>
                        <th className="px-3 py-1.5 font-medium">Match</th>
                        <th className="px-3 py-1.5 text-right font-medium">Bid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {adGroup.targets.map((target) => (
                        <tr key={targetKey(target)} data-target-kind={target.kind}>
                          <td className="px-3 py-1.5">{targetText(target)}</td>
                          <td className="px-3 py-1.5 text-muted-foreground capitalize">{matchText(target)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(target.bid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {adGroup.negativeKeywords.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-sm">
                    <span className="mr-1 text-xs text-muted-foreground">Negative exact</span>
                    {adGroup.negativeKeywords.map((negative) => (
                      <span key={negative.keyword} className="rounded-md border px-2 py-0.5 text-muted-foreground">
                        − {negative.keyword}
                      </span>
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function targetKey(target: NewTarget): string {
  return target.kind === "keyword" ? `${target.keyword}|${target.matchType}` : target.kind === "product" ? target.asin : target.autoType;
}

function targetText(target: NewTarget): string {
  switch (target.kind) {
    case "keyword":
      return `"${target.keyword}"`;
    case "product":
      return `ASIN ${target.asin}`;
    case "auto":
      return target.autoType.replaceAll("_", " ");
  }
}

function matchText(target: NewTarget): string {
  switch (target.kind) {
    case "keyword":
      return target.matchType;
    case "product":
      return "Product";
    case "auto":
      return "Auto";
  }
}
