"use client";

import {
  ProposalRiskSchema,
  ProposalTypeSchema,
  hasBlockingFailure,
  type DiffEdit,
  type ProposalRisk,
  type ProposalType,
} from "@app/core";
import { cn } from "cn";
import { AlarmClock, CheckCheck, ChevronDown, Inbox, Loader2, X } from "lucide-react";
import { useEffect, useEffectEvent, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import {
  approveProposalWithEdits,
  approveProposals,
  rejectProposals,
  snoozeProposals,
  type ActionResult,
} from "@/app/(app)/approvals/actions";
import type { ApprovalItem, ApprovalsData } from "@/app/(app)/approvals/load-approvals";
import { useSellerContext } from "@/components/shell/seller-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROPOSAL_TYPE_LABELS, RISK_LABELS } from "@/lib/format";
import { ProposalDetail, SNOOZE_OPTIONS, type DetailMode, type SnoozeHours } from "./proposal-detail";
import { ProposalList } from "./proposal-list";
import { RejectForm } from "./reject-form";

type View = "queue" | "snoozed";
type Filters = { type: ProposalType | "all"; risk: ProposalRisk | "all"; account: string };
const NO_FILTERS: Filters = { type: "all", risk: "all", account: "all" };

const MEMBER_ROLE_LABELS = { owner: "Owner", specialist: "Specialist", client_approver: "Client approver", viewer: "Viewer" };

/** Approval queue for the selected workspace: filters, bulk select, decisions and j/k/a/r shortcuts. */
export function ApprovalsWorkbench({ data }: { data: ApprovalsData }) {
  const { workspace, sellerAccounts } = useSellerContext();
  const [items, hide] = useOptimistic(data.items, (current, ids: readonly string[]) =>
    current.filter((item) => !ids.includes(item.proposal.id)),
  );
  const [saving, startTransition] = useTransition();
  const [view, setView] = useState<View>("queue");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string>();
  const [modeFor, setModeFor] = useState<{ id: string; mode: DetailMode }>();
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  // False while server rendering and hydrating; shortcuts only work once this is true.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  // A filter on an account from another workspace means nothing after switching workspaces.
  const accountFilter = sellerAccounts.some((account) => account.id === filters.account) ? filters.account : "all";
  const inWorkspace = items.filter((item) => item.proposal.workspaceId === workspace?.id);
  const counts = {
    queue: inWorkspace.filter((item) => !item.snoozed).length,
    snoozed: inWorkspace.filter((item) => item.snoozed).length,
  };
  const visible = inWorkspace.filter(
    (item) =>
      item.snoozed === (view === "snoozed") &&
      (filters.type === "all" || item.proposal.type === filters.type) &&
      (filters.risk === "all" || item.proposal.risk === filters.risk) &&
      (accountFilter === "all" || item.account.id === accountFilter),
  );
  const activeIndex = Math.max(0, visible.findIndex((item) => item.proposal.id === activeId));
  const active: ApprovalItem | undefined = visible[activeIndex];
  const mode: DetailMode = active && modeFor?.id === active.proposal.id ? modeFor.mode : "view";
  const selectedVisible = visible.filter((item) => selected.has(item.proposal.id));
  const filtered = filters.type !== "all" || filters.risk !== "all" || accountFilter !== "all";
  const actingMember = workspace ? data.actingMembers[workspace.id] : undefined;

  const activate = (id: string | undefined) => {
    setActiveId(id);
    detailRef.current?.scrollTo({ top: 0 });
    if (id) document.querySelector(`[data-proposal-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const move = (delta: number) => {
    const next = visible[Math.min(visible.length - 1, Math.max(0, activeIndex + delta))];
    activate(next?.proposal.id);
  };

  /** Hides `ids` right away, runs the write, then reports. Failed proposals come back on their own. */
  const run = (ids: string[], write: () => Promise<ActionResult>, verb: string) => {
    if (ids.length === 0) return;
    const leaving = new Set(ids);
    const stayActive = active && !leaving.has(active.proposal.id);
    const next = stayActive
      ? active
      : (visible.slice(activeIndex).find((item) => !leaving.has(item.proposal.id)) ??
        visible.findLast((item) => !leaving.has(item.proposal.id)));

    startTransition(async () => {
      hide(ids);
      setActiveId(next?.proposal.id);
      setModeFor(undefined);
      const result = await write();
      report(result, verb);
      setSelected((current) => new Set([...current].filter((id) => !result.done.includes(id))));
    });
  };

  const approve = (targets: ApprovalItem[]) => {
    const blocked = targets.filter((item) => hasBlockingFailure(item.compliance));
    const ready = targets.filter((item) => !hasBlockingFailure(item.compliance));
    if (blocked.length > 0) {
      toast.warning(
        blocked.length === 1 && targets.length === 1
          ? "Compliance is failing. Press E to approve with edits."
          : `Skipped ${blocked.length} with failing compliance. Open each one to edit it.`,
      );
    }
    const ids = ready.map((item) => item.proposal.id);
    run(ids, () => approveProposals({ ids }), "Approved");
  };

  const reject = (targets: ApprovalItem[], reason: string) => {
    const ids = targets.map((item) => item.proposal.id);
    run(ids, () => rejectProposals({ ids, reason }), "Rejected");
  };

  const snooze = (targets: ApprovalItem[], hours: SnoozeHours) => {
    const ids = targets.map((item) => item.proposal.id);
    run(ids, () => snoozeProposals({ ids, hours }), "Snoozed");
  };

  const approveWithEdits = (item: ApprovalItem, edits: DiffEdit[], note: string) => {
    const id = item.proposal.id;
    run(
      [id],
      () => (edits.length > 0 ? approveProposalWithEdits({ id, edits, note }) : approveProposals({ ids: [id], note })),
      edits.length > 0 ? "Approved with edits" : "Approved",
    );
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    // Leave keys alone while a menu, select or dialog is open.
    if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;

    switch (event.key) {
      case "j":
        move(1);
        break;
      case "k":
        move(-1);
        break;
      case "a":
        if (!active || mode !== "view") return;
        approve([active]);
        break;
      case "r":
        if (!active) return;
        setModeFor({ id: active.proposal.id, mode: "reject" });
        break;
      case "e":
        if (!active) return;
        setModeFor({ id: active.proposal.id, mode: "edit" });
        break;
      case "x":
        if (!active) return;
        toggle(active.proposal.id);
        break;
      case "Escape":
        setModeFor(undefined);
        break;
      default:
        return;
    }
    // Stops the key from also being typed into a field that opens because of it.
    event.preventDefault();
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-hydrated={hydrated}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label="Queue">
          {(["queue", "snoozed"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
                view === key ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setView(key)}
            >
              {key === "queue" ? <Inbox className="size-4" aria-hidden /> : <AlarmClock className="size-4" aria-hidden />}
              {key === "queue" ? "Pending" : "Snoozed"}
              <span className="text-xs tabular-nums opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>

        <FilterSelect
          label="Type"
          value={filters.type}
          options={ProposalTypeSchema.options.map((type) => ({ value: type, label: PROPOSAL_TYPE_LABELS[type] }))}
          onChange={(type) => setFilters((current) => ({ ...current, type: type as Filters["type"] }))}
        />
        <FilterSelect
          label="Risk"
          value={filters.risk}
          options={ProposalRiskSchema.options.map((risk) => ({ value: risk, label: RISK_LABELS[risk] }))}
          onChange={(risk) => setFilters((current) => ({ ...current, risk: risk as Filters["risk"] }))}
        />
        <FilterSelect
          label="Account"
          value={accountFilter}
          options={sellerAccounts.map((account) => ({ value: account.id, label: account.name }))}
          onChange={(account) => setFilters((current) => ({ ...current, account }))}
        />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
            Reset
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {saving && (
            <span className="inline-flex items-center gap-1" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Saving
            </span>
          )}
          {actingMember && (
            <span>
              Deciding as <span className="font-medium text-foreground">{actingMember.name}</span> (
              {MEMBER_ROLE_LABELS[actingMember.role]})
            </span>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <div className="flex max-h-[28rem] min-h-0 flex-col overflow-hidden rounded-xl border bg-card lg:max-h-none">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <Checkbox
              checked={allSelected ? true : selectedVisible.length > 0 ? "indeterminate" : false}
              disabled={visible.length === 0}
              onCheckedChange={() =>
                setSelected(allSelected ? new Set() : new Set(visible.map((item) => item.proposal.id)))
              }
              aria-label="Select all"
            />
            {selectedVisible.length > 0 ? (
              <div className="flex flex-1 items-center gap-1" aria-label="Bulk actions">
                <span className="mr-auto text-sm font-medium tabular-nums">{selectedVisible.length} selected</span>
                <Button size="xs" onClick={() => approve(selectedVisible)}>
                  <CheckCheck />
                  Approve
                </Button>
                <Button size="xs" variant="destructive" onClick={() => setBulkRejectOpen(true)}>
                  Reject
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="xs" variant="outline" aria-label="Snooze selected">
                      <AlarmClock />
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {SNOOZE_OPTIONS.map((option) => (
                      <DropdownMenuItem key={option.hours} onSelect={() => snooze(selectedVisible, option.hours)}>
                        Snooze {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="icon-xs" variant="ghost" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                  <X />
                </Button>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground tabular-nums">
                {visible.length} {visible.length === 1 ? "proposal" : "proposals"}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.length > 0 ? (
              <ProposalList
                items={visible}
                activeId={active?.proposal.id}
                selected={selected}
                onActivate={activate}
                onToggle={toggle}
              />
            ) : (
              <EmptyQueue filtered={filtered} snoozed={view === "snoozed"} onReset={() => setFilters(NO_FILTERS)} />
            )}
          </div>

          <div className="hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground lg:flex">
            <Shortcut keys={["J", "K"]} label="move" />
            <Shortcut keys={["A"]} label="approve" />
            <Shortcut keys={["R"]} label="reject" />
            <Shortcut keys={["E"]} label="edit" />
            <Shortcut keys={["X"]} label="select" />
          </div>
        </div>

        <div ref={detailRef} className="min-h-0 overflow-y-auto" aria-live="polite">
          {active ? (
            <ProposalDetail
              key={active.proposal.id}
              item={active}
              mode={mode}
              onModeChange={(next) => setModeFor({ id: active.proposal.id, mode: next })}
              actions={{
                approve: () => approve([active]),
                approveWithEdits: (edits, note) => approveWithEdits(active, edits, note),
                reject: (reason) => reject([active], reason),
                snooze: (hours) => snooze([active], hours),
              }}
            />
          ) : (
            <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              Nothing selected
            </div>
          )}
        </div>
      </div>

      <Dialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {selectedVisible.length} proposals</DialogTitle>
            <DialogDescription>The same reason is recorded on each one.</DialogDescription>
          </DialogHeader>
          <RejectForm
            count={selectedVisible.length}
            onCancel={() => setBulkRejectOpen(false)}
            onSubmit={(reason) => {
              setBulkRejectOpen(false);
              reject(selectedVisible, reason);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function report(result: ActionResult, verb: string) {
  const done = result.done.length;
  if (done > 0) toast.success(`${verb} ${done} ${done === 1 ? "proposal" : "proposals"}`);
  if (result.errors.length === 1) toast.error(result.errors[0]!.message);
  if (result.errors.length > 1) {
    toast.error(`${result.errors.length} proposals weren't changed`, {
      description: [...new Set(result.errors.map((error) => error.message))].join(" "),
    });
  }
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={`Filter by ${label.toLowerCase()}`} className="min-w-32">
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyQueue({ filtered, snoozed, onReset }: { filtered: boolean; snoozed: boolean; onReset: () => void }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-center">
      <CheckCheck className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">
        {filtered ? "No proposals match these filters" : snoozed ? "Nothing snoozed" : "You're all caught up"}
      </p>
      {filtered ? (
        <Button variant="outline" size="sm" onClick={onReset}>
          Reset filters
        </Button>
      ) : (
        <p className="max-w-56 text-sm text-muted-foreground">
          {snoozed ? "Snoozed proposals wait here until it's time." : "New proposals from agents land here for a decision."}
        </p>
      )}
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      {label}
    </span>
  );
}

function subscribeNever() {
  return () => {};
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
