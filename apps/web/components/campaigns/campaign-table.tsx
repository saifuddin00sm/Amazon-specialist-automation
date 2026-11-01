"use client";

import { cn } from "cn";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { CampaignRow, CampaignsData } from "@/app/(app)/campaigns/load-campaigns";
import { useSellerContext } from "@/components/shell/seller-context";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { relativeChange } from "@/lib/campaigns";
import { CAMPAIGN_TYPE_LABELS, formatDay, formatMoney, formatPercent } from "@/lib/format";
import { AcosValue } from "./acos-value";
import { SPARK_SWATCH, Sparkline } from "./sparkline";

type SortKey = "dailyBudget" | "spend" | "sales" | "acos";
const SORT_VALUE: Record<SortKey, (row: CampaignRow) => number> = {
  dailyBudget: (row) => row.dailyBudget,
  spend: (row) => row.current.spend,
  sales: (row) => row.current.sales,
  // Campaigns without sales sort as the worst ACoS.
  acos: (row) => row.current.acos ?? Infinity,
};

/** Campaigns of the seller account picked in the top bar, with 30-day spend, sales, ACoS and trend. */
export function CampaignTable({ data }: { data: CampaignsData }) {
  const { sellerAccount } = useSellerContext();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "spend", descending: true });
  const needle = query.trim().toLowerCase();
  const range = sellerAccount ? data.windows[sellerAccount.id] : undefined;
  const visible = data.rows
    .filter((row) => row.sellerAccountId === sellerAccount?.id && (needle === "" || row.name.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const order = SORT_VALUE[sort.key](a) - SORT_VALUE[sort.key](b) || a.name.localeCompare(b.name);
      return sort.descending ? -order : order;
    });

  const header = (key: SortKey, label: string) => (
    <th className="px-3 py-2 text-right font-medium" aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((current) => ({ key, descending: current.key === key ? !current.descending : true }))}
      >
        {label}
        {sort.key === key && (sort.descending ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search campaigns"
            aria-label="Search campaigns"
            className="pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {visible.length} {visible.length === 1 ? "campaign" : "campaigns"}
          {range && ` · ${formatDay(range.from)} – ${formatDay(range.to)}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Campaign</th>
              {header("dailyBudget", "Daily budget")}
              {header("spend", "Spend")}
              {header("sales", "Ad sales")}
              {header("acos", "ACoS")}
              <th className="px-3 py-2 font-medium">
                <span className="flex items-center gap-2">
                  Trend
                  <Legend series="sales" label="Sales" />
                  <Legend series="spend" label="Spend" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((row) => {
              const change = row.previous && relativeChange(row.previous.sales, row.current.sales);
              return (
                <tr key={row.id} className="hover:bg-muted/50">
                  <td className="max-w-md px-3 py-2">
                    <Link href={`/campaigns/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {CAMPAIGN_TYPE_LABELS[row.type]} · <span className="capitalize">{row.targetingType}</span>
                      </span>
                      {row.state !== "enabled" && (
                        <Badge variant="outline" className="capitalize">
                          {row.state}
                        </Badge>
                      )}
                      {row.pendingPlanId && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                          Plan waiting
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.dailyBudget, row.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.current.spend, row.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.current.sales, row.currency)}</td>
                  <td className="px-3 py-2 text-right">
                    <AcosValue acos={row.current.acos} target={row.targetAcos} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Sparkline
                        daily={row.daily}
                        summary={`${row.name}: ${formatMoney(row.current.sales, row.currency)} ad sales on ${formatMoney(row.current.spend, row.currency)} spend over ${row.daily.length} days`}
                      />
                      <span className="w-20 text-xs text-muted-foreground tabular-nums" title="Ad sales against the 30 days before">
                        {change === undefined ? "–" : `${change >= 0 ? "+" : "−"}${formatPercent(Math.abs(change), 0)} sales`}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  No campaigns match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Legend({ series, label }: { series: keyof typeof SPARK_SWATCH; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-normal">
      <span aria-hidden className={cn("size-2 rounded-[2px]", SPARK_SWATCH[series])} />
      {label}
    </span>
  );
}
