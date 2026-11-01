import { cn } from "cn";
import { ArrowDown, ArrowUp } from "lucide-react";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { PROPOSAL_TYPE_LABELS, formatMoney, formatPercent } from "@/lib/format";
import { change, type Comparison, type WeeklyReport } from "@/lib/reports";
import { DailyAdsChart, DailySalesChart } from "./report-charts";
import { ReportHeader } from "./report-header";

const longDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`);

/** "Oct 24 – Oct 30, 2026" */
export function formatWeek({ from, to }: { from: string; to: string }): string {
  return `${shortDay.format(day(from))} – ${longDay.format(day(to))}`;
}

/**
 * The weekly report as a printable page: branded header, plain-language summary, KPIs against the
 * week before, two charts, top campaigns and products, and the changes that went live. Always light
 * (`.paper`), on screen and on paper; sections avoid breaking across printed pages.
 */
export function ReportDocument({ report, className }: { report: WeeklyReport; className?: string }) {
  const { account, kpis } = report;
  const money = (amount: number) => formatMoney(amount, account.currency);
  const vsLabel = report.previous ? "vs week before" : undefined;

  return (
    <article className={cn("paper mx-auto w-full max-w-[210mm] rounded-lg shadow-sm print:max-w-none print:rounded-none print:shadow-none", className)} data-testid="report-document">
      <ReportHeader
        branding={report.branding}
        title="Weekly performance report"
        subtitle={`${account.name} · Amazon ${account.marketplace}`}
        period={formatWeek(report.week)}
      />

      <div className="flex flex-col gap-7 px-6 py-6 text-sm">
        <section className="flex flex-col gap-2 break-inside-avoid" aria-labelledby="summary-heading">
          <Heading id="summary-heading" accent={report.branding.accentColor}>
            Summary
          </Heading>
          {report.summary.map((paragraph, i) => (
            <p key={i} className="leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>

        <section className="grid grid-cols-2 gap-3 break-inside-avoid sm:grid-cols-3 print:grid-cols-3" aria-label="Key numbers">
          <Kpi label="Sales" value={money(kpis.sales.current)} delta={percentDelta(kpis.sales)} vs={vsLabel} />
          <Kpi label="Units ordered" value={kpis.units.current.toLocaleString("en-US")} delta={percentDelta(kpis.units)} vs={vsLabel} />
          <Kpi label="Ad spend" value={money(kpis.adSpend.current)} delta={percentDelta(kpis.adSpend)} vs={vsLabel} />
          <Kpi label="Ad sales" value={money(kpis.adSales.current)} delta={percentDelta(kpis.adSales)} vs={vsLabel} />
          <Kpi
            label={`ACoS · target ${formatPercent(account.targetAcos, 0)}`}
            value={kpis.acos.current === undefined ? "–" : formatPercent(kpis.acos.current)}
            delta={pointsDelta(kpis.acos)}
            vs={vsLabel}
          />
          <Kpi
            label="TACoS · ad spend / all sales"
            value={kpis.tacos.current === undefined ? "–" : formatPercent(kpis.tacos.current)}
            delta={pointsDelta(kpis.tacos)}
            vs={vsLabel}
          />
        </section>

        <section className="flex flex-col gap-6" aria-label="Charts">
          <DailySalesChart daily={report.daily} currency={account.currency} />
          <DailyAdsChart daily={report.daily} currency={account.currency} />
        </section>

        <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
          <section className="flex flex-col gap-2 break-inside-avoid" aria-labelledby="campaigns-heading">
            <Heading id="campaigns-heading" accent={report.branding.accentColor}>
              Top campaigns by spend
            </Heading>
            <Table
              columns={["Campaign", "Spend", "Ad sales", "ACoS"]}
              rows={report.campaigns.map((campaign) => [
                campaign.name,
                money(campaign.spend),
                money(campaign.sales),
                campaign.acos === undefined ? "–" : formatPercent(campaign.acos),
              ])}
              empty="No ad spend this week."
            />
          </section>
          <section className="flex flex-col gap-2 break-inside-avoid" aria-labelledby="products-heading">
            <Heading id="products-heading" accent={report.branding.accentColor}>
              Top products by sales
            </Heading>
            <Table
              columns={["Product", "Units", "Sales", "Change"]}
              rows={report.products.map((product) => {
                const delta = product.previousRevenue === undefined ? undefined : change({ current: product.revenue, previous: product.previousRevenue });
                return [product.title, product.units.toLocaleString("en-US"), money(product.revenue), delta === undefined ? "–" : signed(delta)];
              })}
              empty="No sales this week."
            />
          </section>
        </div>

        <section className="flex flex-col gap-3" aria-labelledby="changes-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2 break-after-avoid">
            <Heading id="changes-heading" accent={report.branding.accentColor}>
              Changes made this week
            </Heading>
            <span className="text-xs text-muted-foreground tabular-nums">
              {report.decisions.approved} approved · {report.decisions.rejected} rejected · {report.decisions.waiting} waiting now
            </span>
          </div>
          {report.changes.length === 0 ? (
            <p className="text-muted-foreground">No changes went live this week.</p>
          ) : (
            <ol className="flex flex-col divide-y rounded-lg border" data-testid="report-changes">
              {report.changes.map((item) => (
                <li key={item.proposalId} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2.5 break-inside-avoid">
                  <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{shortDay.format(day(item.appliedAt))}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium">{item.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {PROPOSAL_TYPE_LABELS[item.type]}
                      {item.detail && ` · ${item.detail}`} · Approved by {item.approvedBy}
                    </span>
                  </span>
                  <AIGeneratedBadge actor={item.createdBy} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="flex flex-wrap justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>Prepared by {report.branding.displayName}</span>
          <span className="tabular-nums">
            Amazon data through {longDay.format(day(report.week.to))} · Generated {longDay.format(new Date(report.generatedAt))}
          </span>
        </footer>
      </div>
    </article>
  );
}

function Heading({ id, accent, children }: { id: string; accent: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
      <span aria-hidden className="h-3.5 w-1 rounded-full" style={{ background: accent }} />
      {children}
    </h2>
  );
}

type Delta = { text: string; direction: "up" | "down" | "flat" };

function Kpi({ label, value, delta, vs }: { label: string; value: string; delta?: Delta; vs?: string }) {
  const Icon = delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : undefined;
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {delta && vs && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          {Icon && <Icon className="size-3" aria-hidden />}
          {delta.text} {vs}
        </span>
      )}
    </div>
  );
}

function percentDelta(comparison: Comparison): Delta | undefined {
  const fraction = change(comparison);
  if (fraction === undefined) return undefined;
  return { text: signed(fraction), direction: Math.abs(fraction) < 0.005 ? "flat" : fraction > 0 ? "up" : "down" };
}

/** ACoS and TACoS move in percentage points. */
function pointsDelta({ current, previous }: { current?: number; previous?: number }): Delta | undefined {
  if (current === undefined || previous === undefined) return undefined;
  const points = (current - previous) * 100;
  return {
    text: `${points >= 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pts`,
    direction: Math.abs(points) < 0.05 ? "flat" : points > 0 ? "up" : "down",
  };
}

function signed(fraction: number): string {
  return `${fraction >= 0 ? "+" : "−"}${Math.abs(Math.round(fraction * 100))}%`;
}

function Table({ columns, rows, empty }: { columns: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <table className="w-full text-xs">
      <thead className="border-b text-left text-muted-foreground">
        <tr>
          {columns.map((column, i) => (
            <th key={column} className={cn("py-1.5 font-medium", i > 0 && "pl-2 text-right")}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, i) => (
              <td key={i} className={cn("py-1.5 align-top", i === 0 ? "pr-2" : "pl-2 text-right whitespace-nowrap tabular-nums")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
