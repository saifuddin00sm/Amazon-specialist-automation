import { TriangleAlert } from "lucide-react";
import { acosStatus } from "@/lib/campaigns";
import { formatPercent } from "@/lib/format";

/** ACoS as a percentage, flagged with an icon and a label when it runs above the account's target. */
export function AcosValue({ acos, target }: { acos: number | undefined; target: number }) {
  if (acos === undefined) return <span className="text-muted-foreground">–</span>;
  const over = acosStatus(acos, target) === "over";
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title={`Target ${formatPercent(target, 0)}`}>
      {over && <TriangleAlert className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />}
      {formatPercent(acos)}
      {over && <span className="sr-only"> (above the {formatPercent(target, 0)} target)</span>}
    </span>
  );
}
