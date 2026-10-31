import { LISTING_COPY_FIELDS, utf8ByteLength, type Currency, type DiffEntry } from "@app/core";
import { cn } from "cn";
import { ArrowRight } from "lucide-react";
import { fieldLabel, formatMoney, formatPercentChange } from "@/lib/format";
import { changeStats, diffWords, sideOf, type DiffSegment } from "@/lib/word-diff";

type JsonValue = DiffEntry["after"];

const LISTING_FIELDS: ReadonlySet<string> = new Set(LISTING_COPY_FIELDS);
const MONEY_FIELDS: ReadonlySet<string> = new Set(["bid", "dailyBudget", "price"]);

/** Before/after for every entry in a proposal's diff: word-level for listing copy, values for the rest. */
export function DiffView({ diff, currency }: { diff: DiffEntry[]; currency: Currency }) {
  return (
    <div className="flex flex-col gap-5">
      {diff.map((entry) => (
        <DiffEntryView key={entry.path} entry={entry} currency={currency} />
      ))}
    </div>
  );
}

function DiffEntryView({ entry, currency }: { entry: DiffEntry; currency: Currency }) {
  if (LISTING_FIELDS.has(entry.path)) {
    if (Array.isArray(entry.before) || Array.isArray(entry.after)) {
      return <ListDiff label={fieldLabel(entry.path)} before={asStrings(entry.before)} after={asStrings(entry.after)} />;
    }
    return (
      <TextDiff
        label={fieldLabel(entry.path)}
        before={String(entry.before ?? "")}
        after={String(entry.after ?? "")}
        measure={entry.path === "backendKeywords" ? "bytes" : "chars"}
      />
    );
  }

  if (typeof entry.before === "number" && typeof entry.after === "number") {
    const format = (value: number) => (MONEY_FIELDS.has(entry.path) ? formatMoney(value, currency) : String(value));
    return (
      <FieldBlock label={fieldLabel(entry.path)} meta={formatPercentChange(entry.before, entry.after)}>
        <div className="flex items-center gap-3 text-lg tabular-nums">
          <span className="text-muted-foreground line-through decoration-red-500/60">{format(entry.before)}</span>
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          <span className="font-semibold">{format(entry.after)}</span>
        </div>
      </FieldBlock>
    );
  }

  if (Array.isArray(entry.after)) {
    const before = new Set(asStrings(entry.before));
    const after = asStrings(entry.after);
    return (
      <FieldBlock label={fieldLabel(entry.path)} meta={`${after.length - before.size} added`}>
        <ul className="flex flex-wrap gap-1.5">
          {after.map((term) => (
            <li
              key={term}
              className={cn(
                "rounded-md border px-2 py-0.5 text-sm",
                before.has(term) ? "text-muted-foreground" : "border-emerald-500/40 bg-emerald-500/10 font-medium",
              )}
            >
              {before.has(term) ? term : `+ ${term}`}
            </li>
          ))}
        </ul>
      </FieldBlock>
    );
  }

  if (entry.after && typeof entry.after === "object") {
    const fields = Object.entries(entry.after);
    return (
      <FieldBlock label={fieldLabel(entry.path)} meta={entry.before === null ? "new" : undefined}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          {fields.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1")}</dt>
              <dd className="font-medium">{formatValue(key, value, currency)}</dd>
            </div>
          ))}
        </dl>
      </FieldBlock>
    );
  }

  return (
    <FieldBlock label={fieldLabel(entry.path)}>
      <div className="flex items-center gap-3 text-sm">
        <span className="rounded-md bg-red-500/10 px-2 py-0.5 capitalize line-through">{String(entry.before)}</span>
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-medium capitalize">{String(entry.after)}</span>
      </div>
    </FieldBlock>
  );
}

function TextDiff({ label, before, after, measure }: { label: string; before: string; after: string; measure: "chars" | "bytes" }) {
  const segments = diffWords(before, after);
  const size = (text: string) => (measure === "bytes" ? utf8ByteLength(text) : text.length);
  return (
    <FieldBlock label={label} meta={`${size(before)} → ${size(after)} ${measure} · ${statsLabel(segments)}`}>
      <SideBySide before={sideOf(segments, "before")} after={sideOf(segments, "after")} />
    </FieldBlock>
  );
}

function ListDiff({ label, before, after }: { label: string; before: string[]; after: string[] }) {
  const rows = Array.from({ length: Math.max(before.length, after.length) }, (_, i) => diffWords(before[i] ?? "", after[i] ?? ""));
  return (
    <FieldBlock label={label} meta={`${before.length} → ${after.length} items · ${statsLabel(rows.flat())}`}>
      <ol className="flex flex-col gap-2">
        {rows.map((segments, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-4 shrink-0 pt-2 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <SideBySide
              className="flex-1"
              before={before[i] === undefined ? null : sideOf(segments, "before")}
              after={after[i] === undefined ? null : sideOf(segments, "after")}
            />
          </li>
        ))}
      </ol>
    </FieldBlock>
  );
}

function SideBySide({ before, after, className }: { before: DiffSegment[] | null; after: DiffSegment[] | null; className?: string }) {
  return (
    <div className={cn("grid gap-2 md:grid-cols-2", className)}>
      <DiffText segments={before} side="before" />
      <DiffText segments={after} side="after" />
    </div>
  );
}

function DiffText({ segments, side }: { segments: DiffSegment[] | null; side: "before" | "after" }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
        side === "before" ? "bg-muted/40" : "bg-background",
      )}
      data-diff-side={side}
    >
      <span className="sr-only">{side === "before" ? "Before: " : "After: "}</span>
      {segments === null ? (
        <span className="text-muted-foreground italic">{side === "before" ? "Not in live listing" : "Removed"}</span>
      ) : (
        segments.map((segment, i) =>
          segment.type === "delete" ? (
            <del key={i} className="rounded-sm bg-red-500/15 text-red-800 decoration-red-500/60 dark:text-red-300">
              {segment.text}
            </del>
          ) : segment.type === "insert" ? (
            <ins key={i} className="rounded-sm bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-300">
              {segment.text}
            </ins>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )
      )}
    </div>
  );
}

function FieldBlock({ label, meta, children }: { label: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="text-sm font-medium">{label}</h4>
        {meta && <span className="text-xs text-muted-foreground tabular-nums">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function statsLabel(segments: DiffSegment[]): string {
  const { added, removed } = changeStats(segments);
  return added === 0 && removed === 0 ? "no word changes" : `+${added} −${removed} words`;
}

function asStrings(value: JsonValue): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function formatValue(key: string, value: JsonValue, currency: Currency): string {
  if (typeof value === "number" && MONEY_FIELDS.has(key)) return formatMoney(value, currency);
  if (key === "matchType" && typeof value === "string") return value[0]!.toUpperCase() + value.slice(1);
  return String(value);
}
