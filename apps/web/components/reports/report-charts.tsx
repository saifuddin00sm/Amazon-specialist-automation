import type { Currency } from "@app/core";
import type { WeeklyReport } from "@/lib/reports";
import { formatMoney, formatMoneyCompact } from "@/lib/format";

// Reports are always light paper, so the light steps of categorical slots 1 and 2.
const SALES = "#2a78d6";
const SPEND = "#eb6834";
const COMPARE = "#52514e";
const GRID = "#e4e4e2";
const INK_MUTED = "#6b6a66";

const WIDTH = 640;
const HEIGHT = 190;
const PLOT = { left: 52, right: 8, top: 18, bottom: 28 };
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });

type Day = WeeklyReport["daily"][number];

/** Sales per day as columns, with a tick for the same weekday the week before. */
export function DailySalesChart({ daily, currency }: { daily: Day[]; currency: Currency }) {
  const hasPrevious = daily.some((day) => day.previousSales !== undefined);
  const max = niceMax(Math.max(0, ...daily.flatMap((day) => [day.sales, day.previousSales ?? 0])));
  const peak = daily.reduce((best, day) => (day.sales > best.sales ? day : best), daily[0]!);
  const { x, y, band } = scales(daily.length, max);
  const width = band * 0.56;

  return (
    <Figure
      title="Sales by day"
      legend={[
        { label: "This week", swatch: <span className="size-2.5 rounded-[2px]" style={{ background: SALES }} /> },
        ...(hasPrevious ? [{ label: "Week before", swatch: <span className="h-0.5 w-3" style={{ background: COMPARE }} /> }] : []),
      ]}
    >
      <Axes daily={daily} max={max} currency={currency} />
      {daily.map((day, i) => {
        const center = x(i) + band / 2;
        return (
          <g key={day.date}>
            <title>{`${weekday.format(new Date(`${day.date}T00:00:00Z`))}: ${formatMoney(day.sales, currency)}${day.previousSales !== undefined ? ` (week before ${formatMoney(day.previousSales, currency)})` : ""}`}</title>
            <path d={bar(center - width / 2, y(day.sales), width, y(0) - y(day.sales))} fill={SALES} />
            {day.previousSales !== undefined && (
              <line x1={center - width / 2 - 3} x2={center + width / 2 + 3} y1={y(day.previousSales)} y2={y(day.previousSales)} stroke={COMPARE} strokeWidth={2} strokeLinecap="round" />
            )}
            {day === peak && day.sales > 0 && (
              <text x={center} y={y(day.sales) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0b0b0b">
                {formatMoneyCompact(day.sales, currency)}
              </text>
            )}
          </g>
        );
      })}
    </Figure>
  );
}

/** Ad sales and ad spend per day, side by side on one money scale. */
export function DailyAdsChart({ daily, currency }: { daily: Day[]; currency: Currency }) {
  const max = niceMax(Math.max(0, ...daily.flatMap((day) => [day.adSales, day.spend])));
  const { x, y, band } = scales(daily.length, max);
  const width = band * 0.3;
  const gap = 2;

  return (
    <Figure
      title="Ad sales and ad spend by day"
      legend={[
        { label: "Ad sales", swatch: <span className="size-2.5 rounded-[2px]" style={{ background: SALES }} /> },
        { label: "Ad spend", swatch: <span className="size-2.5 rounded-[2px]" style={{ background: SPEND }} /> },
      ]}
    >
      <Axes daily={daily} max={max} currency={currency} />
      {daily.map((day, i) => {
        const center = x(i) + band / 2;
        return (
          <g key={day.date}>
            <title>{`${weekday.format(new Date(`${day.date}T00:00:00Z`))}: ad sales ${formatMoney(day.adSales, currency)}, spend ${formatMoney(day.spend, currency)}`}</title>
            <path d={bar(center - width - gap / 2, y(day.adSales), width, y(0) - y(day.adSales))} fill={SALES} />
            <path d={bar(center + gap / 2, y(day.spend), width, y(0) - y(day.spend))} fill={SPEND} />
          </g>
        );
      })}
    </Figure>
  );
}

function Figure({ title, legend, children }: { title: string; legend: { label: string; swatch: React.ReactNode }[]; children: React.ReactNode }) {
  return (
    <figure className="flex flex-col gap-2 break-inside-avoid">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {legend.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-flex items-center">
                {item.swatch}
              </span>
              {item.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={title}>
        {children}
      </svg>
    </figure>
  );
}

function Axes({ daily, max, currency }: { daily: Day[]; max: number; currency: Currency }) {
  const { x, y, band } = scales(daily.length, max);
  return (
    <g>
      {[0, 0.5, 1].map((share) => (
        <g key={share}>
          <line x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y(max * share)} y2={y(max * share)} stroke={GRID} strokeWidth={1} />
          <text x={PLOT.left - 8} y={y(max * share) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
            {formatMoneyCompact(max * share, currency)}
          </text>
        </g>
      ))}
      {daily.map((day, i) => (
        <text key={day.date} x={x(i) + band / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
          {weekday.format(new Date(`${day.date}T00:00:00Z`))}
        </text>
      ))}
    </g>
  );
}

function scales(count: number, max: number) {
  const band = (WIDTH - PLOT.left - PLOT.right) / Math.max(1, count);
  return {
    band,
    x: (i: number) => PLOT.left + i * band,
    y: (value: number) => HEIGHT - PLOT.bottom - (max > 0 ? value / max : 0) * (HEIGHT - PLOT.top - PLOT.bottom),
  };
}

/** A column anchored to the baseline with its top corners rounded. */
function bar(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return "";
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
}

/** A round axis maximum just above `value`: 1, 2 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].map((step) => step * magnitude).find((candidate) => candidate >= value) ?? 10 * magnitude);
}
