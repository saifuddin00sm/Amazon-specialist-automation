import type { DailyAds } from "@/lib/campaigns";

// The dashboard's sales and spend colors (categorical slots 1 and 2), stepped per theme.
export const SPARK_SWATCH = {
  sales: "bg-[#2a78d6] dark:bg-[#3987e5]",
  spend: "bg-[#eb6834] dark:bg-[#d95926]",
} as const;
const STROKE = {
  sales: "stroke-[#2a78d6] dark:stroke-[#3987e5]",
  spend: "stroke-[#eb6834] dark:stroke-[#d95926]",
} as const;

const WIDTH = 96;
const HEIGHT = 28;

/**
 * Daily ad sales and spend as two lines on one shared money scale, so the gap between them reads as
 * ACoS. `summary` is the hover text and what screen readers get instead of the picture.
 */
export function Sparkline({ daily, summary }: { daily: DailyAds[]; summary: string }) {
  const max = Math.max(0, ...daily.flatMap((day) => [day.sales, day.spend]));
  const points = (series: "sales" | "spend") =>
    daily
      .map((day, i) => {
        const x = daily.length > 1 ? (i / (daily.length - 1)) * WIDTH : WIDTH / 2;
        const y = max > 0 ? HEIGHT - 1 - (day[series] / max) * (HEIGHT - 2) : HEIGHT - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} role="img" aria-label={summary} className="shrink-0 overflow-visible">
      <title>{summary}</title>
      <line x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-border" strokeWidth={1} />
      {daily.length > 0 &&
        (["spend", "sales"] as const).map((series) => (
          <polyline
            key={series}
            points={points(series)}
            fill="none"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className={STROKE[series]}
          />
        ))}
    </svg>
  );
}
