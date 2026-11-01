"use client";

import { breakEvenAcos, maxCostPerClick, type Currency } from "@app/core";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, formatPercent } from "@/lib/format";

type Field = "price" | "unitCost" | "fulfillmentFee" | "referralFeePercent";

const FIELDS: { key: Field; label: string; step: string; suffix?: string }[] = [
  { key: "price", label: "Selling price", step: "0.01" },
  { key: "unitCost", label: "Product cost", step: "0.01" },
  { key: "fulfillmentFee", label: "Fulfillment fee", step: "0.01" },
  { key: "referralFeePercent", label: "Referral fee", step: "0.5", suffix: "%" },
];

/**
 * Breakeven ACoS from unit economics, against the account's target and the campaign's actual ACoS.
 * The inputs start from the advertised products' average price and rough fees; nothing is saved.
 */
export function BreakevenCalculator({
  currency,
  averagePrice,
  targetAcos,
  campaignAcos,
  averageCpc,
  conversionRate,
}: {
  currency: Currency;
  averagePrice: number;
  targetAcos: number;
  /** 30-day ACoS of the campaign; undefined without sales. */
  campaignAcos: number | undefined;
  /** 30-day spend per click; undefined without clicks. */
  averageCpc: number | undefined;
  /** 30-day orders per click; undefined without clicks. */
  conversionRate: number | undefined;
}) {
  const price = round2(averagePrice);
  const [values, setValues] = useState<Record<Field, string>>({
    price: String(price),
    unitCost: String(round2(price * 0.3)),
    fulfillmentFee: String(round2(Math.min(price * 0.15, 8))),
    referralFeePercent: "15",
  });
  const number = (key: Field) => Number.parseFloat(values[key]) || 0;
  const breakeven = breakEvenAcos({
    price: number("price"),
    unitCost: number("unitCost"),
    fulfillmentFee: number("fulfillmentFee"),
    referralFeeRate: number("referralFeePercent") / 100,
  });
  const money = (amount: number) => formatMoney(amount, currency);
  const maxCpc = breakeven !== undefined && conversionRate !== undefined ? maxCostPerClick(breakeven, number("price"), conversionRate) : undefined;

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-4" aria-labelledby="breakeven-heading">
      <div className="flex flex-col gap-1">
        <h2 id="breakeven-heading" className="text-sm font-semibold">
          Breakeven ACoS
        </h2>
        <p className="text-xs text-muted-foreground">Starting values are estimates. Enter your own; nothing here is saved.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map(({ key, label, step, suffix }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`breakeven-${key}`} className="text-xs font-normal text-muted-foreground">
              {label}
              {suffix && ` (${suffix})`}
            </Label>
            <Input
              id={`breakeven-${key}`}
              type="number"
              inputMode="decimal"
              min="0"
              step={step}
              className="tabular-nums"
              value={values[key]}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="flex items-baseline gap-2 border-t pt-3" aria-live="polite">
        <span className="text-3xl font-semibold tabular-nums" data-testid="breakeven-acos">
          {breakeven === undefined ? "–" : formatPercent(breakeven)}
        </span>
        <span className="text-sm text-muted-foreground">
          {breakeven === undefined ? "Enter a price" : breakeven <= 0 ? "No ad spend is profitable at this margin" : "margin before ad spend"}
        </span>
      </div>

      {breakeven !== undefined && breakeven > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          <Comparison label="Target ACoS" acos={targetAcos} breakeven={breakeven} />
          {campaignAcos !== undefined && <Comparison label="This campaign, 30 days" acos={campaignAcos} breakeven={breakeven} />}
          {maxCpc !== undefined && (
            <li className="flex flex-wrap items-baseline justify-between gap-x-3 text-muted-foreground">
              <span>Max cost per click at breakeven</span>
              <span className="text-foreground tabular-nums">
                {money(maxCpc)}
                {averageCpc !== undefined && <span className="text-muted-foreground"> · paying {money(averageCpc)}</span>}
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function Comparison({ label, acos, breakeven }: { label: string; acos: number; breakeven: number }) {
  const profitable = acos <= breakeven;
  const Icon = profitable ? CircleCheck : TriangleAlert;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <Icon
          className={profitable ? "size-4 text-emerald-600 dark:text-emerald-400" : "size-4 text-amber-600 dark:text-amber-400"}
          aria-hidden
        />
        {formatPercent(acos)}
        <span className="text-xs text-muted-foreground">
          {profitable
            ? `${points(breakeven - acos)} under breakeven`
            : `${points(acos - breakeven)} over: ad orders lose money`}
        </span>
      </span>
    </li>
  );
}

/** A difference of two percentages, in percentage points: 0.052 → "5.2 pts". */
function points(fraction: number): string {
  return `${(fraction * 100).toFixed(1)} pts`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
