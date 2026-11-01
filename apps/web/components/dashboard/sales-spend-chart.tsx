"use client";

import type { Currency } from "@app/core";
import { cn } from "cn";
import { CartesianGrid, Line, LineChart, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { DailySalesAndSpend } from "@/lib/dashboard";
import { formatDay, formatMoney, formatMoneyCompact } from "@/lib/format";

type Series = "sales" | "spend";

// Categorical slots 1 and 2, stepped per theme; validated for color-vision deficiency on the card surfaces.
const chartConfig = {
  sales: { label: "Sales", theme: { light: "#2a78d6", dark: "#3987e5" } },
  spend: { label: "Ad spend", theme: { light: "#eb6834", dark: "#d95926" } },
} satisfies ChartConfig;

/** The same colors for swatches outside the chart, where its CSS variables don't reach. */
const SWATCH: Record<Series, string> = {
  sales: "bg-[#2a78d6] dark:bg-[#3987e5]",
  spend: "bg-[#eb6834] dark:bg-[#d95926]",
};

/**
 * Daily ordered revenue and ad spend as two stacked panels on the same days. Spend is often a
 * hundredth of sales, so one shared axis would flatten it; each panel gets its own scale instead.
 */
export function SalesSpendChart({
  daily,
  totals,
  currency,
}: {
  daily: DailySalesAndSpend[];
  totals: Record<Series, number>;
  currency: Currency;
}) {
  const first = daily[0];
  const last = daily.at(-1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales and ad spend</CardTitle>
        <CardDescription>
          {first && last ? `Daily, ${formatDay(first.date)} – ${formatDay(last.date)}` : "No metrics reported yet"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {daily.length === 0 ? (
          <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Sales and spend appear once Amazon reports metrics for this account.
          </p>
        ) : (
          <>
            <Panel series="sales" daily={daily} total={totals.sales} currency={currency} />
            <Panel series="spend" daily={daily} total={totals.spend} currency={currency} showDates />
            <table className="sr-only">
              <caption>Daily sales and ad spend</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Sales</th>
                  <th scope="col">Ad spend</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((day) => (
                  <tr key={day.date}>
                    <th scope="row">{formatDay(day.date)}</th>
                    <td>{formatMoney(day.sales, currency)}</td>
                    <td>{formatMoney(day.spend, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Panel({
  series,
  daily,
  total,
  currency,
  showDates = false,
}: {
  series: Series;
  daily: DailySalesAndSpend[];
  total: number;
  currency: Currency;
  showDates?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* Names the series and its total for the window; identity never rests on color alone. */}
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden className={cn("size-2.5 rounded-[2px]", SWATCH[series])} />
        <span className="text-muted-foreground">{chartConfig[series].label}</span>
        <span className="font-medium tabular-nums">{formatMoney(total, currency)}</span>
      </div>
      <ChartContainer config={chartConfig} className={cn("aspect-auto w-full", showDates ? "h-40" : "h-32")} aria-hidden>
        <LineChart data={daily} syncId="sales-spend" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            hide={!showDates}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDay}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={56}
            tickCount={3}
            tickFormatter={(value: number) => formatMoneyCompact(value, currency)}
          />
          <ChartTooltip cursor content={(props) => <MoneyTooltip {...props} series={series} currency={currency} />} />
          <Line
            dataKey={series}
            type="linear"
            stroke={`var(--color-${series})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function MoneyTooltip({ active, payload, label, series, currency }: TooltipContentProps & { series: Series; currency: Currency }) {
  const value = payload?.[0]?.value;
  if (!active || value === undefined) return null;
  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{typeof label === "string" ? formatDay(label) : null}</div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: `var(--color-${series})` }} />
        <span className="flex-1 text-muted-foreground">{chartConfig[series].label}</span>
        <span className="font-mono font-medium tabular-nums">{formatMoney(Number(value), currency)}</span>
      </div>
    </div>
  );
}
