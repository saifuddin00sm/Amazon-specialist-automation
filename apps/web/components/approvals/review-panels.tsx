import {
  FRESHNESS_MAX_AGE_HOURS,
  RubricCriterionSchema,
  freshnessAgeHours,
  isStale,
  type ComplianceCheck,
  type DataFreshness,
  type FindingSeverity,
  type Review,
} from "@app/core";
import { cn } from "cn";
import { CircleAlert, CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { Badge } from "@/components/ui/badge";
import { FRESHNESS_LABELS, RUBRIC_LABELS, formatAge, formatDateTime } from "@/lib/format";

export function Section({
  title,
  aside,
  children,
  className,
  ...props
}: { title: string; aside?: React.ReactNode } & React.ComponentProps<"section">) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", className)} {...props}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function RubricBreakdown({ review }: { review: Review }) {
  return (
    <Section title="Rubric" aside={<AIGeneratedBadge actor={review.reviewer} />} aria-label="Rubric breakdown">
      <div className="flex items-baseline gap-2">
        <span className={cn("text-3xl font-semibold tabular-nums", scoreTone(review.overall))}>{review.overall}</span>
        <span className="text-sm text-muted-foreground">/ 100 overall</span>
      </div>
      <dl className="grid gap-2">
        {RubricCriterionSchema.options.map((criterion) => {
          const score = review.scores[criterion];
          return (
            <div key={criterion} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm">
              <dt className="text-muted-foreground">{RUBRIC_LABELS[criterion]}</dt>
              <dd className="flex gap-1" aria-hidden>
                {[1, 2, 3, 4, 5].map((step) => (
                  <span
                    key={step}
                    className={cn("h-2 flex-1 rounded-full", step <= score ? barTone(score) : "bg-muted")}
                  />
                ))}
              </dd>
              <dd className="text-right font-medium tabular-nums">{score}/5</dd>
            </div>
          );
        })}
      </dl>
    </Section>
  );
}

const SEVERITY_ICON: Record<FindingSeverity, typeof Info> = { info: Info, warning: TriangleAlert, error: CircleAlert };
const SEVERITY_TONE: Record<FindingSeverity, string> = {
  info: "text-sky-600 dark:text-sky-400",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

export function ReviewerReport({ review }: { review: Review }) {
  const findings = [...review.report.findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return (
    <Section title="Reviewer report" aside={<AIGeneratedBadge actor={review.reviewer} />}>
      <p className="text-sm">{review.report.summary}</p>
      {findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No findings.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {findings.map((finding, i) => {
            const Icon = SEVERITY_ICON[finding.severity];
            return (
              <li key={i} className="flex gap-2 text-sm">
                <Icon className={cn("mt-0.5 size-4 shrink-0", SEVERITY_TONE[finding.severity])} aria-label={finding.severity} />
                <span>
                  <span className="font-medium">{RUBRIC_LABELS[finding.criterion]}:</span> {finding.message}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

const CHECK_ICON = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX } as const;
const CHECK_TONE = {
  pass: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-red-600 dark:text-red-400",
} as const;

export function ComplianceResults({ checks, live }: { checks: ComplianceCheck[]; live?: boolean }) {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  const summary =
    checks.length === 0 ? null : failed > 0 ? (
      <Badge variant="destructive">{failed} blocking</Badge>
    ) : warned > 0 ? (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
        {warned} {warned === 1 ? "warning" : "warnings"}
      </Badge>
    ) : (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
        All passed
      </Badge>
    );

  return (
    <Section title={live ? "Compliance (live, with your edits)" : "Compliance"} aside={summary} data-testid="compliance-results">
      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No guardrails apply to this kind of change.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {checks.map((check) => {
            const Icon = CHECK_ICON[check.status];
            return (
              <li key={check.id} className="flex gap-2 text-sm" data-status={check.status}>
                <Icon className={cn("mt-0.5 size-4 shrink-0", CHECK_TONE[check.status])} aria-label={check.status} />
                <span className="min-w-0">
                  <span className="font-medium">{check.label}</span>
                  {check.detail && <span className="block text-xs break-words text-muted-foreground">{check.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function DataFreshnessPanel({ freshness, proposedAt }: { freshness: DataFreshness[]; proposedAt: string }) {
  return (
    <Section title="Data freshness">
      <ul className="flex flex-col gap-2">
        {freshness.map((entry) => {
          const stale = isStale(entry, proposedAt);
          return (
            <li key={entry.source} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{FRESHNESS_LABELS[entry.source]}</span>
                <span className="block text-xs text-muted-foreground">
                  As of {formatDateTime(entry.asOf)} · {formatAge(freshnessAgeHours(entry, proposedAt))} old when proposed
                </span>
              </span>
              {stale ? (
                <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                  Stale (limit {formatAge(FRESHNESS_MAX_AGE_HOURS[entry.source])})
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Fresh
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function severityRank(severity: FindingSeverity): number {
  return { info: 0, warning: 1, error: 2 }[severity];
}

function scoreTone(overall: number): string {
  return overall >= 80 ? "text-emerald-600 dark:text-emerald-400" : overall >= 60 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
}

function barTone(score: number): string {
  return score >= 4 ? "bg-emerald-500" : score === 3 ? "bg-amber-500" : "bg-red-500";
}
