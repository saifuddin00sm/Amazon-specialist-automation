import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { DashboardOpportunity } from "@/app/(app)/dashboard/load-dashboard";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { RiskBadge } from "@/components/approvals/risk-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROPOSAL_TYPE_LABELS } from "@/lib/format";

/** Pending proposals with the most expected value, each a link into the approval queue. */
export function TopOpportunities({ opportunities }: { opportunities: DashboardOpportunity[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top opportunities</CardTitle>
        <CardDescription>Pending proposals ranked by impact × confidence</CardDescription>
      </CardHeader>
      <CardContent>
        {opportunities.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing is waiting for a decision.</p>
        ) : (
          <ol className="flex flex-col divide-y" data-testid="top-opportunities">
            {opportunities.map((item) => (
              <li key={item.proposalId}>
                <Link
                  href={`/approvals?proposal=${item.proposalId}`}
                  className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
                >
                  <div
                    className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md bg-muted tabular-nums"
                    title="Impact × confidence, 0–100"
                  >
                    <span className="text-sm font-semibold leading-none">{item.opportunityScore}</span>
                    <span className="sr-only">opportunity score</span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm font-medium">{item.title}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{PROPOSAL_TYPE_LABELS[item.type]}</Badge>
                      <RiskBadge risk={item.risk} />
                      <AIGeneratedBadge actor={item.createdBy} compact />
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
