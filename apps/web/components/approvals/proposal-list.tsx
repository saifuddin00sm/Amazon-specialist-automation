"use client";

import { hasBlockingFailure } from "@app/core";
import { cn } from "cn";
import { AlarmClock, ShieldAlert } from "lucide-react";
import type { ApprovalItem } from "@/app/(app)/approvals/load-approvals";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PROPOSAL_TYPE_LABELS, formatDateTime } from "@/lib/format";
import { RiskBadge } from "./risk-badge";

export function ProposalList({
  items,
  activeId,
  selected,
  onActivate,
  onToggle,
}: {
  items: ApprovalItem[];
  activeId: string | undefined;
  selected: ReadonlySet<string>;
  onActivate: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col divide-y" aria-label="Proposals">
      {items.map((item) => {
        const { proposal } = item;
        const active = proposal.id === activeId;
        return (
          <li
            key={proposal.id}
            data-proposal-id={proposal.id}
            aria-current={active ? "true" : undefined}
            className={cn(
              "relative flex gap-3 px-3 py-3 transition-colors",
              active ? "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary" : "hover:bg-muted/50",
            )}
          >
            <Checkbox
              className="mt-0.5"
              checked={selected.has(proposal.id)}
              onCheckedChange={() => onToggle(proposal.id)}
              aria-label={`Select ${proposal.title}`}
            />
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col gap-1.5 text-left outline-none focus-visible:underline"
              onClick={() => onActivate(proposal.id)}
            >
              <span className="line-clamp-2 text-sm leading-snug font-medium">{proposal.title}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{PROPOSAL_TYPE_LABELS[proposal.type]}</Badge>
                <RiskBadge risk={proposal.risk} />
                <AIGeneratedBadge actor={proposal.createdBy} compact />
                {hasBlockingFailure(item.compliance) && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                    <ShieldAlert className="size-3.5" aria-hidden />
                    Blocked
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="truncate">{item.account.name}</span>
                <span aria-hidden>·</span>
                {item.snoozed && proposal.snoozedUntil ? (
                  <span className="inline-flex items-center gap-1">
                    <AlarmClock className="size-3" aria-hidden />
                    Until {formatDateTime(proposal.snoozedUntil)}
                  </span>
                ) : (
                  <span>{formatDateTime(proposal.createdAt)}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
