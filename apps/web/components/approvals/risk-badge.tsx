import type { ProposalRisk } from "@app/core";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { RISK_LABELS } from "@/lib/format";

const RISK_TONE: Record<ProposalRisk, string> = {
  low: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  medium: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  high: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

export function RiskBadge({ risk, className }: { risk: ProposalRisk; className?: string }) {
  return (
    <Badge variant="outline" className={cn(RISK_TONE[risk], className)}>
      {RISK_LABELS[risk]}
    </Badge>
  );
}
