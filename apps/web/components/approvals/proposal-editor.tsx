"use client";

import { LISTING_LIMITS, utf8ByteLength, type Currency, type DiffEntry } from "@app/core";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fieldLabel, formatMoney, formatPercentChange } from "@/lib/format";

type JsonValue = DiffEntry["after"];

/** Edits the `after` side of every diff entry in place. Shape stays the same as the agent's value. */
export function ProposalEditor({
  draft,
  currency,
  onChange,
}: {
  draft: DiffEntry[];
  currency: Currency;
  onChange: (path: string, after: JsonValue) => void;
}) {
  return (
    <div className="flex flex-col gap-5" data-testid="proposal-editor">
      {draft.map((entry, i) => (
        <EntryEditor
          key={entry.path}
          entry={entry}
          currency={currency}
          autoFocus={i === 0}
          onChange={(after) => onChange(entry.path, after)}
        />
      ))}
    </div>
  );
}

function EntryEditor({
  entry,
  currency,
  autoFocus,
  onChange,
}: {
  entry: DiffEntry;
  currency: Currency;
  autoFocus: boolean;
  onChange: (after: JsonValue) => void;
}) {
  const id = `edit-${entry.path}`;
  const { path, before, after } = entry;

  if (path === "title" && typeof after === "string") {
    return (
      <Field id={id} label={fieldLabel(path)} count={after.length} limit={LISTING_LIMITS.titleMaxLength}>
        <Input id={id} value={after} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />
      </Field>
    );
  }

  if ((path === "description" || path === "backendKeywords") && typeof after === "string") {
    const bytes = path === "backendKeywords";
    return (
      <Field
        id={id}
        label={fieldLabel(path)}
        count={bytes ? utf8ByteLength(after) : after.length}
        limit={bytes ? LISTING_LIMITS.backendKeywordsMaxBytes : LISTING_LIMITS.descriptionMaxLength}
        unit={bytes ? "bytes" : "chars"}
      >
        <Textarea
          id={id}
          value={after}
          rows={bytes ? 3 : 6}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    );
  }

  if (path === "bullets" && Array.isArray(after)) {
    const bullets = after.map(String);
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">{fieldLabel(path)}</legend>
        {bullets.map((bullet, i) => (
          <Field
            key={i}
            id={`${id}-${i}`}
            label={`Bullet ${i + 1}`}
            count={bullet.length}
            limit={LISTING_LIMITS.bulletMaxLength}
            subtle
          >
            <Textarea
              id={`${id}-${i}`}
              value={bullet}
              rows={2}
              autoFocus={autoFocus && i === 0}
              onChange={(event) => onChange(bullets.map((value, j) => (j === i ? event.target.value : value)))}
            />
          </Field>
        ))}
      </fieldset>
    );
  }

  if (typeof after === "number") {
    const money = path === "bid" || path === "dailyBudget" || path === "price";
    return (
      <NumberField
        id={id}
        label={fieldLabel(path)}
        value={after}
        hint={
          typeof before === "number"
            ? `Was ${money ? formatMoney(before, currency) : before} · ${formatPercentChange(before, after)}`
            : undefined
        }
        autoFocus={autoFocus}
        onChange={onChange}
      />
    );
  }

  if (path === "keywords" && after && typeof after === "object" && !Array.isArray(after)) {
    const keyword = String(after.keyword ?? "");
    const matchType = String(after.matchType ?? "exact");
    const bid = typeof after.bid === "number" ? after.bid : 0;
    return (
      <fieldset className="grid gap-3 sm:grid-cols-[1fr_9rem_8rem]">
        <legend className="mb-2 text-sm font-medium">{fieldLabel(path)}</legend>
        <Field id={`${id}-keyword`} label="Keyword" subtle>
          <Input
            id={`${id}-keyword`}
            value={keyword}
            autoFocus={autoFocus}
            onChange={(event) => onChange({ ...after, keyword: event.target.value })}
          />
        </Field>
        <Field id={`${id}-match`} label="Match type" subtle>
          <Select value={matchType} onValueChange={(value) => onChange({ ...after, matchType: value })}>
            <SelectTrigger id={`${id}-match`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["exact", "phrase", "broad"].map((type) => (
                <SelectItem key={type} value={type} className="capitalize">
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <NumberField id={`${id}-bid`} label="Bid" value={bid} onChange={(value) => onChange({ ...after, bid: value })} subtle />
      </fieldset>
    );
  }

  if (path === "negativeKeywords" && Array.isArray(after)) {
    const existing = new Set(Array.isArray(before) ? before.map(String) : []);
    const terms = after.map(String);
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">{fieldLabel(path)}</legend>
        {terms.map((term, i) =>
          existing.has(term) ? null : (
            <Field key={i} id={`${id}-${i}`} label="New negative keyword" subtle>
              <Input
                id={`${id}-${i}`}
                value={term}
                autoFocus={autoFocus}
                onChange={(event) => onChange(terms.map((value, j) => (j === i ? event.target.value : value)))}
              />
            </Field>
          ),
        )}
      </fieldset>
    );
  }

  return <p className="text-sm text-muted-foreground">{fieldLabel(path)} can&apos;t be edited.</p>;
}

function NumberField({
  id,
  label,
  value,
  hint,
  autoFocus,
  subtle,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  hint?: string;
  autoFocus?: boolean;
  subtle?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field id={id} label={label} hint={hint} subtle={subtle}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className="max-w-40 tabular-nums"
        defaultValue={value}
        autoFocus={autoFocus}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (!Number.isNaN(next)) onChange(next);
        }}
      />
    </Field>
  );
}

function Field({
  id,
  label,
  count,
  limit,
  unit = "chars",
  hint,
  subtle,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  limit?: number;
  unit?: string;
  hint?: string;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  const over = count !== undefined && limit !== undefined && count > limit;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className={cn(subtle && "text-xs font-normal text-muted-foreground")}>
          {label}
        </Label>
        {count !== undefined && limit !== undefined && (
          <span className={cn("text-xs tabular-nums", over ? "font-medium text-destructive" : "text-muted-foreground")}>
            {count} / {limit} {unit}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground tabular-nums">{hint}</p>}
    </div>
  );
}
