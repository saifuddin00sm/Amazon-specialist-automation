"use client";

import { MatchTypeSchema, PlanNegativeSchema, type Currency, type DiffEntry } from "@app/core";
import { cn } from "cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { groupPlanLines, type PlanLabels } from "@/lib/campaigns";
import { formatMoney, formatPercentChange } from "@/lib/format";
import { planCounts } from "./campaign-plan-diff";

type JsonValue = DiffEntry["after"];

/**
 * Edits a campaign plan line by line. Unticking a line skips it (its `after` goes back to `before`);
 * ticking it again restores the agent's value. Bids, keywords and match types can be changed in place.
 */
export function CampaignPlanEditor({
  draft,
  original,
  labels,
  currency,
  onChange,
}: {
  draft: DiffEntry[];
  /** The agent's diff, to restore a skipped line. */
  original: DiffEntry[];
  labels: PlanLabels | undefined;
  currency: Currency;
  onChange: (path: string, after: JsonValue) => void;
}) {
  const { groups } = groupPlanLines(draft, labels, { includeSkipped: true, original });
  const agentValue = new Map(original.map((entry) => [entry.path, entry.after]));
  const included = (entry: DiffEntry) => JSON.stringify(entry.after) !== JSON.stringify(entry.before);
  const toggle = (entry: DiffEntry, on: boolean) => onChange(entry.path, on ? (agentValue.get(entry.path) ?? null) : entry.before);
  const kept = groupPlanLines(draft, labels).groups;

  return (
    <div className="flex flex-col gap-5" data-testid="proposal-editor">
      <p className="text-xs text-muted-foreground tabular-nums">Keeping {planCounts(kept) || "nothing"}</p>
      {groups.map((group) => (
        <fieldset key={group.adGroupId} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{group.name}</legend>
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {group.bids.map((bid) => {
              const on = included(bid.entry);
              const agent = Number(agentValue.get(bid.entry.path) ?? bid.after);
              return (
                <Line key={bid.entry.path} entry={bid.entry} on={on} onToggle={toggle} label={`Bid · ${bid.label}`}>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Was {formatMoney(bid.before, currency)}
                    {on && ` · ${formatPercentChange(bid.before, bid.after)}`}
                  </span>
                  <MoneyInput
                    // Remount when re-ticked so the field shows the restored value.
                    key={String(on)}
                    label={`New bid for ${bid.label}`}
                    value={on ? bid.after : agent}
                    disabled={!on}
                    onChange={(value) => onChange(bid.entry.path, value)}
                  />
                </Line>
              );
            })}
            {group.keywords.map(({ entry, value }) => {
              const on = included(entry);
              return (
                <Line key={entry.path} entry={entry} on={on} onToggle={toggle} label="New keyword" name={`new keyword "${value.keyword}"`}>
                  <Input
                    aria-label="Keyword"
                    className="h-8 min-w-40 flex-1"
                    value={value.keyword}
                    disabled={!on}
                    onChange={(event) => onChange(entry.path, { ...value, keyword: event.target.value })}
                  />
                  <MatchSelect
                    value={value.matchType}
                    options={MatchTypeSchema.options}
                    disabled={!on}
                    onChange={(matchType) => onChange(entry.path, { ...value, matchType })}
                  />
                  <MoneyInput
                    key={String(on)}
                    label={`Bid for "${value.keyword}"`}
                    value={value.bid}
                    disabled={!on}
                    onChange={(bid) => onChange(entry.path, { ...value, bid })}
                  />
                </Line>
              );
            })}
            {group.negatives.map(({ entry, value }) => {
              const on = included(entry);
              return (
                <Line key={entry.path} entry={entry} on={on} onToggle={toggle} label="Negative" name={`negative "${value.keyword}"`}>
                  <Input
                    aria-label="Negative keyword"
                    className="h-8 min-w-40 flex-1"
                    value={value.keyword}
                    disabled={!on}
                    onChange={(event) => onChange(entry.path, { ...value, keyword: event.target.value })}
                  />
                  <MatchSelect
                    value={value.matchType}
                    options={PlanNegativeSchema.shape.matchType.options}
                    disabled={!on}
                    onChange={(matchType) => onChange(entry.path, { ...value, matchType })}
                  />
                </Line>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

function Line({
  entry,
  on,
  onToggle,
  label,
  name = label,
  children,
}: {
  entry: DiffEntry;
  on: boolean;
  onToggle: (entry: DiffEntry, on: boolean) => void;
  label: string;
  /** What the line is, for the checkbox's accessible name; defaults to `label`. */
  name?: string;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2", !on && "bg-muted/40")} data-skipped={!on}>
      <label className={cn("flex min-w-0 items-center gap-2", name === label ? "flex-1 basis-56" : "w-28 shrink-0")}>
        <Checkbox checked={on} onCheckedChange={(checked) => onToggle(entry, checked === true)} aria-label={`Keep ${name}`} />
        <span className={cn("min-w-0 break-words", !on && "text-muted-foreground line-through")}>{label}</span>
      </label>
      {children}
    </li>
  );
}

function MoneyInput({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="0.01"
      min="0"
      aria-label={label}
      className="h-8 w-24 tabular-nums"
      defaultValue={value}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.valueAsNumber;
        if (!Number.isNaN(next)) onChange(next);
      }}
    />
  );
}

function MatchSelect<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: readonly T[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-28" aria-label="Match type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option} className="capitalize">
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
