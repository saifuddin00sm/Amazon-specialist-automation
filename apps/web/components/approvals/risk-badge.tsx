import { missedRubricTarget, type ProposalRisk, type ProposalScores } from "@app/core";
import { cn } from "cn";
import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RISK_LABELS } from "@/lib/format";

const RISK_TONE: Record<ProposalRisk, string> = {
  low: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  medium: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  high: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

/** On a proposal whose draft the reviewer never scored up to its target. Nothing otherwise. */
export function MissedTargetBadge({ scores }: { scores: ProposalScores }) {
  if (!missedRubricTarget(scores)) return null;
  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 text-amber-700 dark:text-amber-300"
      title={`The reviewer scored the last draft ${scores.rubric ?? 0}, short of the ${scores.rubricTarget} it aims for.`}
      data-testid="missed-target"
    >
      <Target aria-hidden />
      Did not reach target
    </Badge>
  );
}

export function RiskBadge({ risk, className }: { risk: ProposalRisk; className?: string }) {
  return (
    <Badge variant="outline" className={cn(RISK_TONE[risk], className)}>
      {RISK_LABELS[risk]}
    </Badge>
  );
}
