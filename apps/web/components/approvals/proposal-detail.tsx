"use client";

import {
  DECISION_NOTE_MAX_LENGTH,
  EDITABLE_PROPOSAL_TYPES,
  checkProposalCompliance,
  hasBlockingFailure,
  type DiffEdit,
  type DiffEntry,
} from "@app/core";
import { AlarmClock, Check, ChevronDown, PencilLine, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ApprovalItem } from "@/app/(app)/approvals/load-approvals";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROPOSAL_TYPE_LABELS, formatDateTime } from "@/lib/format";
import { CampaignPlanDiff } from "./campaign-plan-diff";
import { CampaignPlanEditor } from "./campaign-plan-editor";
import { DiffView } from "./diff-view";
import { ProposalEditor } from "./proposal-editor";
import { RejectForm } from "./reject-form";
import { ComplianceResults, DataFreshnessPanel, ReviewerReport, RubricBreakdown, Section } from "./review-panels";
import { RiskBadge } from "./risk-badge";

export type DetailMode = "view" | "edit" | "reject";

export const SNOOZE_OPTIONS = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
] as const;
export type SnoozeHours = (typeof SNOOZE_OPTIONS)[number]["hours"];

export type DetailActions = {
  approve: () => void;
  approveWithEdits: (edits: DiffEdit[], note: string) => void;
  reject: (reason: string) => void;
  snooze: (hours: SnoozeHours) => void;
};

/** The right pane: what changes, why, how it scored, and the decision controls. Keyed by proposal id. */
export function ProposalDetail({
  item,
  mode,
  onModeChange,
  actions,
}: {
  item: ApprovalItem;
  mode: DetailMode;
  onModeChange: (mode: DetailMode) => void;
  actions: DetailActions;
}) {
  const { proposal, account, review } = item;
  const [draft, setDraft] = useState<DiffEntry[]>(proposal.diff);
  const [note, setNote] = useState("");
  const editing = mode === "edit";
  const editable = EDITABLE_PROPOSAL_TYPES.has(proposal.type);
  const plan = proposal.type === "campaign_plan";
  const updateDraft = (path: string, after: DiffEntry["after"]) =>
    setDraft((current) => current.map((entry) => (entry.path === path ? { ...entry, after } : entry)));

  const draftChecks = useMemo(
    () =>
      editing
        ? checkProposalCompliance({
            type: proposal.type,
            diff: draft,
            liveListing: item.liveListing,
            facts: item.facts,
            guardrails: item.account.guardrails,
          })
        : item.compliance,
    [editing, draft, proposal.type, item.liveListing, item.facts, item.compliance, item.account.guardrails],
  );
  const blocked = hasBlockingFailure(draftChecks);
  const edits: DiffEdit[] = draft.flatMap((entry, i) =>
    JSON.stringify(entry.after) === JSON.stringify(proposal.diff[i]?.after) ? [] : [{ path: entry.path, after: entry.after }],
  );

  const cancelEdit = () => {
    setDraft(proposal.diff);
    setNote("");
    onModeChange("view");
  };

  return (
    <article className="flex flex-col gap-4" aria-label={proposal.title} data-testid="proposal-detail">
      <header className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{PROPOSAL_TYPE_LABELS[proposal.type]}</Badge>
          <RiskBadge risk={proposal.risk} />
          <Badge variant="outline">
            {account.name} · {account.autonomyLevel}
          </Badge>
          <AIGeneratedBadge actor={proposal.createdBy} />
          <span className="ml-auto text-xs text-muted-foreground">Proposed {formatDateTime(proposal.createdAt)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg leading-snug font-semibold">{proposal.title}</h2>
          <p className="text-sm text-muted-foreground">
            {item.subject.label}
            {item.subject.detail && <span className="block text-xs">{item.subject.detail}</span>}
          </p>
        </div>
        <p className="text-sm">{proposal.rationale}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Score label="Confidence" value={proposal.scores.confidence} />
          <Score label="Impact" value={proposal.scores.impact} />
          {proposal.scores.rubric !== undefined && <Score label="Rubric" value={proposal.scores.rubric} />}
        </dl>
        {item.snoozed && proposal.snoozedUntil && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlarmClock className="size-4" aria-hidden />
            Snoozed until {formatDateTime(proposal.snoozedUntil)}
          </p>
        )}

        {editing ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <Input
              value={note}
              maxLength={DECISION_NOTE_MAX_LENGTH}
              placeholder="Note for the audit log (optional)"
              aria-label="Decision note"
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={blocked} onClick={() => actions.approveWithEdits(edits, note)}>
                <Check />
                {edits.length > 0 ? "Approve with edits" : "Approve"}
              </Button>
              <Button variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
              <span className="text-xs text-muted-foreground">
                {blocked
                  ? "Fix the failing compliance checks to approve."
                  : `${edits.length} ${plan ? (edits.length === 1 ? "line" : "lines") : edits.length === 1 ? "field" : "fields"} changed`}
              </span>
            </div>
          </div>
        ) : mode === "reject" ? (
          <div className="border-t pt-3">
            <RejectForm onSubmit={actions.reject} onCancel={() => onModeChange("view")} />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Wrapper keeps the tooltip working while the button is disabled. */}
                <span tabIndex={blocked ? 0 : -1}>
                  <Button disabled={blocked} onClick={actions.approve}>
                    <Check />
                    Approve <Kbd className="bg-primary-foreground/20 text-primary-foreground">A</Kbd>
                  </Button>
                </span>
              </TooltipTrigger>
              {blocked && <TooltipContent>Compliance is failing. Approve with edits to fix it.</TooltipContent>}
            </Tooltip>
            <Button variant="outline" disabled={!editable} onClick={() => onModeChange("edit")}>
              <PencilLine />
              Approve with edits <Kbd>E</Kbd>
            </Button>
            <Button variant="destructive" onClick={() => onModeChange("reject")}>
              <X />
              Reject <Kbd>R</Kbd>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost">
                  <AlarmClock />
                  Snooze
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {SNOOZE_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.hours} onSelect={() => actions.snooze(option.hours)}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <Section
        title={editing ? "Edit proposed changes" : "Proposed changes"}
        aside={!editing && <span className="text-xs text-muted-foreground">Before · After</span>}
      >
        {editing ? (
          plan ? (
            <CampaignPlanEditor draft={draft} original={proposal.diff} labels={item.planLabels} currency={account.currency} onChange={updateDraft} />
          ) : (
            <ProposalEditor draft={draft} currency={account.currency} onChange={updateDraft} />
          )
        ) : plan ? (
          <CampaignPlanDiff diff={proposal.diff} labels={item.planLabels} currency={account.currency} />
        ) : (
          <DiffView diff={proposal.diff} currency={account.currency} />
        )}
      </Section>

      <ComplianceResults checks={draftChecks} live={editing} />

      {review ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <RubricBreakdown review={review} />
          <ReviewerReport review={review} />
        </div>
      ) : (
        <Section title="Review">
          <p className="text-sm text-muted-foreground">
            Rubric reviews cover listing copy. This proposal is checked by its guardrails above.
            {plan && (
              <>
                {" "}
                <Link className="font-medium text-foreground underline underline-offset-4" href={`/campaigns/${proposal.target.id}`}>
                  See the plan on the campaign
                </Link>
                .
              </>
            )}
          </p>
        </Section>
      )}

      <DataFreshnessPanel freshness={proposal.freshness} proposedAt={proposal.createdAt} />
    </article>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
