import type { Actor, AdGroup, Campaign, Currency, Target } from "@app/core";
import { cn } from "cn";
import { ArrowRight, ChevronRight } from "lucide-react";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { Badge } from "@/components/ui/badge";
import type { AdSummary, PlanGroup } from "@/lib/campaigns";
import { formatMoney, targetLabel } from "@/lib/format";
import { AcosValue } from "./acos-value";

export type PlanTreeGroup = {
  adGroup: AdGroup;
  summary: AdSummary;
  targets: { target: Target; summary: AdSummary }[];
};

/** The pending campaign plan, laid over the tree. */
export type PlanOverlay = { createdBy: Actor; groups: PlanGroup[] };

/**
 * The campaign as a tree: campaign → ad groups → targets, with budget, bids and 30-day numbers.
 * When a plan is waiting, its suggested bids, new keywords and negatives show in place.
 */
export function PlanTree({
  campaign,
  groups,
  currency,
  targetAcos,
  plan,
}: {
  campaign: Campaign;
  groups: PlanTreeGroup[];
  currency: Currency;
  targetAcos: number;
  plan?: PlanOverlay;
}) {
  const money = (amount: number) => formatMoney(amount, currency);
  const planFor = new Map(plan?.groups.map((group) => [group.adGroupId, group]));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card px-4 py-3 text-sm">
        <span className="font-semibold">{campaign.name}</span>
        <span className="text-muted-foreground">
          Daily budget <span className="font-medium text-foreground tabular-nums">{money(campaign.dailyBudget)}</span>
        </span>
        <span className="text-muted-foreground capitalize">{campaign.biddingStrategy.replaceAll("_", " ")} bidding</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {groups.length} {groups.length === 1 ? "ad group" : "ad groups"}
        </span>
      </div>

      <div className="ml-3 flex flex-col gap-2 border-l pl-3">
        {groups.map(({ adGroup, summary, targets }) => {
          const suggested = planFor.get(adGroup.id);
          const bidFor = new Map(suggested?.bids.map((bid) => [bid.targetId, bid.after]));
          const suggestions = (suggested?.bids.length ?? 0) + (suggested?.keywords.length ?? 0) + (suggested?.negatives.length ?? 0);
          const positives = targets.filter(({ target }) => !target.negative);
          const negatives = targets.filter(({ target }) => target.negative);

          return (
            // With a plan waiting, only ad groups it touches start open.
            <details key={adGroup.id} open={!plan || suggestions > 0} className="group rounded-xl border bg-card" data-testid="ad-group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                <span className="font-medium">{adGroup.name}</span>
                {adGroup.state !== "enabled" && (
                  <Badge variant="outline" className="capitalize">
                    {adGroup.state}
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  Default bid <span className="text-foreground tabular-nums">{money(adGroup.defaultBid)}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {adGroup.productIds.length} {adGroup.productIds.length === 1 ? "product" : "products"}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {money(summary.spend)} spend · {money(summary.sales)} sales
                </span>
                <AcosValue acos={summary.acos} target={targetAcos} />
                {suggestions > 0 && plan && (
                  <span className="ml-auto inline-flex items-center gap-1.5">
                    <Badge variant="outline" className="border-violet-500/30 text-violet-700 tabular-nums dark:text-violet-300">
                      {suggestions} {suggestions === 1 ? "suggestion" : "suggestions"}
                    </Badge>
                    <AIGeneratedBadge actor={plan.createdBy} compact />
                  </span>
                )}
              </summary>

              <div className="overflow-x-auto border-t">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Target</th>
                      <th className="px-3 py-2 font-medium">State</th>
                      <th className="px-3 py-2 text-right font-medium">Bid</th>
                      <th className="px-3 py-2 text-right font-medium">Clicks</th>
                      <th className="px-3 py-2 text-right font-medium">Spend</th>
                      <th className="px-3 py-2 text-right font-medium">Sales</th>
                      <th className="px-4 py-2 text-right font-medium">ACoS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {suggested?.keywords.map(({ entry, value }) => (
                      <tr key={entry.path} className="bg-violet-500/5" data-suggestion="keyword">
                        <td className="px-4 py-2">
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                              New
                            </Badge>
                            &quot;{value.keyword}&quot; ({value.matchType})
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">Proposed</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{money(value.bid)}</td>
                        <td colSpan={4} className="px-4 py-2 text-right text-xs text-muted-foreground">
                          No data yet
                        </td>
                      </tr>
                    ))}
                    {positives.map(({ target, summary: stats }) => {
                      const next = bidFor.get(target.id);
                      return (
                        <tr key={target.id} className={cn(next !== undefined && "bg-violet-500/5")} data-suggestion={next !== undefined ? "bid" : undefined}>
                          <td className="px-4 py-2">{targetLabel(target)}</td>
                          <td className="px-3 py-2 text-muted-foreground capitalize">{target.state}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                            {target.bid === undefined ? (
                              "–"
                            ) : next === undefined ? (
                              money(target.bid)
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <span className="text-muted-foreground line-through">{money(target.bid)}</span>
                                <ArrowRight className="size-3 text-muted-foreground" aria-label="suggested" />
                                <span className="font-medium">{money(next)}</span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{stats.clicks}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(stats.spend)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(stats.sales)}</td>
                          <td className="px-4 py-2 text-right">
                            <AcosValue acos={stats.acos} target={targetAcos} />
                          </td>
                        </tr>
                      );
                    })}
                    {positives.length === 0 && !suggested?.keywords.length && (
                      <tr>
                        <td colSpan={7} className="px-4 py-4 text-center text-muted-foreground">
                          No targets.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {(negatives.length > 0 || (suggested?.negatives.length ?? 0) > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-3 text-sm">
                  <span className="mr-1 text-xs text-muted-foreground">Negative keywords</span>
                  {negatives.map(({ target }) => (
                    <span key={target.id} className="rounded-md border px-2 py-0.5 text-muted-foreground">
                      {target.kind === "keyword" ? target.keyword : targetLabel(target)}
                    </span>
                  ))}
                  {suggested?.negatives.map(({ entry, value }) => (
                    <span
                      key={entry.path}
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-medium"
                      data-suggestion="negative"
                    >
                      + {value.keyword}
                    </span>
                  ))}
                </div>
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}
