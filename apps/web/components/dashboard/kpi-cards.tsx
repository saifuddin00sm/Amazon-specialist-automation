import { CircleCheck, ClipboardCheck, Megaphone, Star, Target, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { AccountDashboard } from "@/app/(app)/dashboard/load-dashboard";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatPercent } from "@/lib/format";

export function KpiCards({ dashboard }: { dashboard: AccountDashboard }) {
  const { listings, approvals, ads, currency, targetAcos } = dashboard;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title="Average listing score"
        icon={Star}
        value={listings.averageScore === undefined ? "—" : String(listings.averageScore)}
        unit={listings.averageScore === undefined ? undefined : "/ 100"}
        detail={
          listings.reviewed === 0
            ? "No live listing has a review yet"
            : `${listings.reviewed} of ${listings.products} listings reviewed`
        }
      />
      <KpiCard
        title="Pending approvals"
        icon={ClipboardCheck}
        value={String(approvals.pending)}
        detail={
          <>
            {approvals.highRisk > 0 ? `${approvals.highRisk} high risk · ` : null}
            <Link href="/approvals" className="underline underline-offset-4 hover:text-foreground">
              Open queue
            </Link>
          </>
        }
      />
      <KpiCard
        title="Ad spend"
        icon={Megaphone}
        value={formatMoney(ads.spend, currency)}
        detail={`${formatMoney(ads.adSales, currency)} in ad sales`}
      />
      <KpiCard
        title="ACoS"
        icon={Target}
        value={ads.acos === undefined ? "—" : formatPercent(ads.acos)}
        detail={`Target ${formatPercent(targetAcos)}`}
        status={ads.acos === undefined ? undefined : <AcosStatus acos={ads.acos} target={targetAcos} />}
      />
    </div>
  );
}

function KpiCard({
  title,
  icon: Icon,
  value,
  unit,
  detail,
  status,
}: {
  title: string;
  icon: LucideIcon;
  value: string;
  unit?: string;
  detail: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-normal text-muted-foreground">{title}</CardTitle>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="flex items-baseline gap-1 text-2xl font-semibold tabular-nums">
          {value}
          {unit ? <span className="text-sm font-normal text-muted-foreground">{unit}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{detail}</span>
          {status}
        </div>
      </CardContent>
    </Card>
  );
}

/** At or under target is good; over it needs attention. Icon and words, never color alone. */
function AcosStatus({ acos, target }: { acos: number; target: number }) {
  return acos <= target ? (
    <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
      <CircleCheck aria-hidden />
      On target
    </Badge>
  ) : (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      <TriangleAlert aria-hidden />
      {formatPercent(acos - target)} over
    </Badge>
  );
}
