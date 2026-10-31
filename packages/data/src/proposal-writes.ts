import {
  DECISION_NOTE_MAX_LENGTH,
  EDITABLE_PROPOSAL_TYPES,
  ProposalSchema,
  applyDiffEdits,
  canDecideProposal,
  hasBlockingFailure,
  type AuditEvent,
  type ComplianceCheck,
  type DiffEdit,
  type DiffEntry,
  type Member,
  type Proposal,
} from "@app/core";

export type ProposalWriteErrorCode = "not_found" | "forbidden" | "not_pending" | "invalid_input" | "compliance_failed";

/** A write the data source refused. `message` is safe to show to the member. */
export class ProposalWriteError extends Error {
  constructor(
    readonly code: ProposalWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProposalWriteError";
  }
}

export type AuditEventDraft = Omit<AuditEvent, "id">;

export type ProposalWriteResult = { proposal: Proposal; events: AuditEventDraft[] };

/** What every write needs, loaded by the data source implementation. */
export type ProposalWriteContext = {
  proposal: Proposal | undefined;
  member: Member | undefined;
  /** ISO timestamp of the write. */
  at: string;
  /** Guardrail checks for a candidate diff (approve only). */
  checkCompliance: (diff: DiffEntry[]) => ComplianceCheck[];
};

/**
 * The rules for approve, reject and snooze, shared by every DataSource. Pure: returns the updated
 * proposal and the audit events to append, or throws ProposalWriteError.
 */
export function approveProposalWrite(
  ctx: ProposalWriteContext,
  { note, edits }: { note?: string; edits?: DiffEdit[] },
): ProposalWriteResult {
  const { proposal, member } = assertDecidable(ctx);
  let diff = proposal.diff;
  let changed: DiffEntry[] = [];

  if (edits && edits.length > 0) {
    if (!EDITABLE_PROPOSAL_TYPES.has(proposal.type)) {
      throw new ProposalWriteError("invalid_input", "This kind of proposal can't be edited.");
    }
    const result = applyDiffEdits(proposal.diff, edits);
    if ("error" in result) throw new ProposalWriteError("invalid_input", result.error);
    changed = result.diff.filter((entry, i) => JSON.stringify(entry.after) !== JSON.stringify(proposal.diff[i]?.after));
    diff = result.diff;
  }

  const checks = ctx.checkCompliance(diff);
  if (hasBlockingFailure(checks)) {
    const failures = checks.filter((check) => check.status === "fail");
    throw new ProposalWriteError(
      "compliance_failed",
      `Fix compliance first: ${failures.map((check) => check.detail ?? check.label).join(" ")}`,
    );
  }

  const trimmedNote = note?.trim();
  const edited = changed.length > 0;
  const next = ProposalSchema.parse({
    ...withoutSnooze(proposal),
    status: "approved",
    diff,
    ...(edited ? { originalDiff: proposal.originalDiff ?? proposal.diff } : {}),
    decidedBy: { type: "member", memberId: member.id },
    decidedAt: ctx.at,
    ...(trimmedNote ? { decisionNote: trimmedNote } : {}),
  });

  const actor = { type: "member" as const, memberId: member.id };
  const events: AuditEventDraft[] = [];
  if (edited) {
    events.push(event(proposal, ctx.at, actor, "proposal.edited", {
      changes: changed.map((entry) => ({
        path: entry.path,
        agent: proposal.diff.find((original) => original.path === entry.path)?.after ?? null,
        final: entry.after,
      })),
    }));
  }
  events.push(event(proposal, ctx.at, actor, "proposal.approved", { note: trimmedNote || null, edited }));
  return { proposal: next, events };
}

export function rejectProposalWrite(ctx: ProposalWriteContext, { reason }: { reason: string }): ProposalWriteResult {
  const { proposal, member } = assertDecidable(ctx);
  const trimmed = reason.trim();
  if (trimmed.length === 0) throw new ProposalWriteError("invalid_input", "A reason is required to reject.");
  if (trimmed.length > DECISION_NOTE_MAX_LENGTH) {
    throw new ProposalWriteError("invalid_input", `Keep the reason under ${DECISION_NOTE_MAX_LENGTH} characters.`);
  }

  const actor = { type: "member" as const, memberId: member.id };
  const next = ProposalSchema.parse({ ...withoutSnooze(proposal), status: "rejected", decidedBy: actor, decidedAt: ctx.at, decisionNote: trimmed });
  return { proposal: next, events: [event(proposal, ctx.at, actor, "proposal.rejected", { reason: trimmed })] };
}

export function snoozeProposalWrite(ctx: ProposalWriteContext, { until }: { until: string }): ProposalWriteResult {
  const { proposal, member } = assertDecidable(ctx);
  const untilMs = Date.parse(until);
  if (Number.isNaN(untilMs) || untilMs <= Date.parse(ctx.at)) {
    throw new ProposalWriteError("invalid_input", "Snooze until a time in the future.");
  }
  const untilIso = new Date(untilMs).toISOString();
  const actor = { type: "member" as const, memberId: member.id };
  const next = ProposalSchema.parse({ ...proposal, snoozedUntil: untilIso });
  return { proposal: next, events: [event(proposal, ctx.at, actor, "proposal.snoozed", { until: untilIso })] };
}

function assertDecidable(ctx: ProposalWriteContext): { proposal: Proposal; member: Member } {
  const { proposal, member } = ctx;
  if (!proposal) throw new ProposalWriteError("not_found", "That proposal no longer exists.");
  if (!member || !canDecideProposal(member, proposal)) {
    throw new ProposalWriteError("forbidden", "You don't have permission to decide this proposal.");
  }
  if (proposal.status !== "pending_approval") {
    throw new ProposalWriteError("not_pending", `This proposal was already ${proposal.status.replace("_", " ")}.`);
  }
  return { proposal, member };
}

/** Deciding a proposal also wakes it up. */
function withoutSnooze(proposal: Proposal): Proposal {
  const copy = { ...proposal };
  delete copy.snoozedUntil;
  return copy;
}

function event(
  proposal: Proposal,
  at: string,
  actor: AuditEvent["actor"],
  action: AuditEvent["action"],
  metadata: AuditEvent["metadata"],
): AuditEventDraft {
  return {
    workspaceId: proposal.workspaceId,
    sellerAccountId: proposal.sellerAccountId,
    at,
    actor,
    action,
    entity: { type: "proposal", id: proposal.id },
    metadata,
  };
}
