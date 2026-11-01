import type { Currency, DiffEntry } from "@app/core";
import { ArrowRight } from "lucide-react";
import { groupPlanLines, type PlanGroup, type PlanLabels } from "@/lib/campaigns";
import { formatMoney, formatPercentChange } from "@/lib/format";

/** A campaign plan's changes, by ad group: bid moves, new keywords and new negatives. */
export function CampaignPlanDiff({ diff, labels, currency }: { diff: DiffEntry[]; labels: PlanLabels | undefined; currency: Currency }) {
  const { groups, unreadable } = groupPlanLines(diff, labels);
  const money = (amount: number) => formatMoney(amount, currency);

  return (
    <div className="flex flex-col gap-5" data-testid="campaign-plan-diff">
      <p className="text-xs text-muted-foreground tabular-nums">{planCounts(groups)}</p>
      {groups.map((group) => (
        <div key={group.adGroupId} className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">{group.name}</h4>
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {group.bids.map((bid) => (
              <li key={bid.entry.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="text-xs text-muted-foreground">Bid · </span>
                  {bid.label}
                </span>
                <span className="inline-flex items-center gap-2 tabular-nums">
                  <span className="text-muted-foreground line-through decoration-red-500/60">{money(bid.before)}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="font-semibold">{money(bid.after)}</span>
                  <span className="w-12 text-right text-xs text-muted-foreground">{formatPercentChange(bid.before, bid.after)}</span>
                </span>
              </li>
            ))}
            {group.keywords.map(({ entry, value }) => (
              <li key={entry.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-emerald-500/5 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="text-xs text-muted-foreground">New keyword · </span>
                  <span className="font-medium">+ &quot;{value.keyword}&quot;</span> <span className="capitalize">({value.matchType})</span>
                </span>
                <span className="font-semibold tabular-nums">{money(value.bid)}</span>
              </li>
            ))}
            {group.negatives.map(({ entry, value }) => (
              <li key={entry.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="text-xs text-muted-foreground">Negative · </span>
                  <span className="font-medium">− &quot;{value.keyword}&quot;</span> <span className="capitalize">({value.matchType})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {unreadable.length > 0 && (
        <p className="text-sm text-destructive">
          {unreadable.length} {unreadable.length === 1 ? "change isn't" : "changes aren't"} a bid, keyword or negative and can&apos;t be shown.
        </p>
      )}
    </div>
  );
}

/** "3 bid changes · 2 new keywords · 1 negative". */
export function planCounts(groups: PlanGroup[]): string {
  const sum = (pick: (group: PlanGroup) => unknown[]) => groups.reduce((total, group) => total + pick(group).length, 0);
  const parts = [
    [sum((group) => group.bids), "bid change", "bid changes"],
    [sum((group) => group.keywords), "new keyword", "new keywords"],
    [sum((group) => group.negatives), "negative", "negatives"],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`)
    .join(" · ");
}
