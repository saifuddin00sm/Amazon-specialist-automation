import {
  DECISION_NOTE_MAX_LENGTH,
  EDITABLE_PROPOSAL_TYPES,
  ListingSubmissionSchema,
  PROPOSAL_TRANSITIONS,
  ProposalSchema,
  applyDiffEdits,
  canDecideProposal,
  hasBlockingFailure,
  submissionChanged,
  transitionRefusal,
  type AuditEvent,
  type ComplianceCheck,
  type DiffEdit,
  type DiffEntry,
  type ListingSubmission,
  type Member,
  type Proposal,
  type ProposalStatus,
  type ProposalTransition,
} from "@app/core";

export type ProposalWriteErrorCode = "not_found" | "forbidden" | "invalid_transition" | "invalid_input" | "compliance_failed";

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

/** `transition` is what the write did; a backend commits it only while the status still allows it. */
export type ProposalWriteResult = { proposal: Proposal; transition: ProposalTransition; events: AuditEventDraft[] };

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
 * The rules for approve, reject, snooze and publish, shared by every DataSource. Each one is a
 * transition of the state machine in @app/core. Pure: returns the updated proposal and the audit
 * events to append, or throws ProposalWriteError.
 */
export function approveProposalWrite(
  ctx: ProposalWriteContext,
  { note, edits }: { note?: string; edits?: DiffEdit[] },
): ProposalWriteResult {
  const { proposal, member } = assertCanTransition(ctx, "approve");
  let diff = proposal.diff;
  /** The agent's value and the approved one for every path the member changed; a dropped change ends at `before`. */
  let changes: { path: string; agent: DiffEntry["after"]; final: DiffEntry["after"] }[] = [];

  if (edits && edits.length > 0) {
    if (!EDITABLE_PROPOSAL_TYPES.has(proposal.type)) {
      throw new ProposalWriteError("invalid_input", "This kind of proposal can't be edited.");
    }
    const result = applyDiffEdits(proposal.diff, edits);
    if ("error" in result) throw new ProposalWriteError("invalid_input", result.error);
    const approved = new Map(result.diff.map((entry) => [entry.path, entry.after]));
    changes = proposal.diff.flatMap((entry) => {
      const final = approved.has(entry.path) ? approved.get(entry.path)! : entry.before;
      return JSON.stringify(final) === JSON.stringify(entry.after) ? [] : [{ path: entry.path, agent: entry.after, final }];
    });
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
  const edited = changes.length > 0;
  const next = ProposalSchema.parse({
    ...withoutSnooze(proposal),
    status: PROPOSAL_TRANSITIONS.approve.to,
    diff,
    ...(edited ? { originalDiff: proposal.originalDiff ?? proposal.diff } : {}),
    decidedBy: { type: "member", memberId: member.id },
    decidedAt: ctx.at,
    ...(trimmedNote ? { decisionNote: trimmedNote } : {}),
  });

  const actor = { type: "member" as const, memberId: member.id };
  const events: AuditEventDraft[] = [];
  if (edited) {
    events.push(event(proposal, ctx.at, actor, "proposal.edited", { changes }));
  }
  events.push(event(proposal, ctx.at, actor, "proposal.approved", { note: trimmedNote || null, edited }));
  return { proposal: next, transition: "approve", events };
}

export function rejectProposalWrite(ctx: ProposalWriteContext, { reason }: { reason: string }): ProposalWriteResult {
  const { proposal, member } = assertCanTransition(ctx, "reject");
  const trimmed = reason.trim();
  if (trimmed.length === 0) throw new ProposalWriteError("invalid_input", "A reason is required to reject.");
  if (trimmed.length > DECISION_NOTE_MAX_LENGTH) {
    throw new ProposalWriteError("invalid_input", `Keep the reason under ${DECISION_NOTE_MAX_LENGTH} characters.`);
  }

  const actor = { type: "member" as const, memberId: member.id };
  const next = ProposalSchema.parse({
    ...withoutSnooze(proposal),
    status: PROPOSAL_TRANSITIONS.reject.to,
    decidedBy: actor,
    decidedAt: ctx.at,
    decisionNote: trimmed,
  });
  return { proposal: next, transition: "reject", events: [event(proposal, ctx.at, actor, "proposal.rejected", { reason: trimmed })] };
}

export function snoozeProposalWrite(ctx: ProposalWriteContext, { until }: { until: string }): ProposalWriteResult {
  const { proposal, member } = assertCanTransition(ctx, "snooze");
  const untilMs = Date.parse(until);
  if (Number.isNaN(untilMs) || untilMs <= Date.parse(ctx.at)) {
    throw new ProposalWriteError("invalid_input", "Snooze until a time in the future.");
  }
  const untilIso = new Date(untilMs).toISOString();
  const actor = { type: "member" as const, memberId: member.id };
  const next = ProposalSchema.parse({ ...proposal, snoozedUntil: untilIso });
  return { proposal: next, transition: "snooze", events: [event(proposal, ctx.at, actor, "proposal.snoozed", { until: untilIso })] };
}

/**
 * Publishes an approved proposal: it becomes applied. Refused for anything not approved, so nothing
 * unapproved can reach Amazon. Phase 1 has no Amazon connection, so this only records the publish.
 */
export function publishProposalWrite(ctx: ProposalWriteContext): ProposalWriteResult {
  const { proposal, member } = assertCanTransition(ctx, "publish");
  const actor = { type: "member" as const, memberId: member.id };
  const next = ProposalSchema.parse({ ...proposal, status: PROPOSAL_TRANSITIONS.publish.to, appliedAt: ctx.at });
  return { proposal: next, transition: "publish", events: [event(proposal, ctx.at, actor, "proposal.applied", { type: proposal.type })] };
}

export const LISTING_SUBMISSIONS_BACKEND_ONLY = "Only the backend records what Amazon says about a submitted listing.";

/** A submission write, with the statuses the proposal must still be in for a backend to commit it. */
export type ListingSubmissionWriteResult = { proposal: Proposal; from: ProposalStatus[]; events: AuditEventDraft[] };

/**
 * Records Amazon's word on a new listing. The first answer to an approved proposal's submission
 * publishes it (accepted) or fails it (invalid), through the state machine; later ones, from listing
 * notifications, update the submission of the same SKU and change nothing else. Returns undefined
 * when Amazon said nothing new. The system acts: no member is involved.
 */
export function listingSubmissionWrite(
  { proposal, at }: Pick<ProposalWriteContext, "proposal" | "at">,
  submission: ListingSubmission,
): ListingSubmissionWriteResult | undefined {
  if (!proposal) throw new ProposalWriteError("not_found", "That proposal no longer exists.");
  if (proposal.type !== "new_listing") throw new ProposalWriteError("invalid_input", "Only new listings are submitted to Amazon.");
  const parsed = ListingSubmissionSchema.safeParse(submission);
  if (!parsed.success) throw new ProposalWriteError("invalid_input", "That isn't a listing submission.");
  const next = parsed.data;
  const system = { type: "system" as const };
  const metadata = { sku: next.sku, ...(next.submissionId ? { submissionId: next.submissionId } : {}), status: next.status, issues: next.issues.length };

  const current = proposal.listingSubmission;
  if (current) {
    if (current.sku !== next.sku || current.submissionId !== next.submissionId) {
      throw new ProposalWriteError("invalid_input", "That submission isn't this proposal's.");
    }
    if (!submissionChanged(current, next)) return undefined;
    const updated = ProposalSchema.parse({ ...proposal, listingSubmission: { ...next, submittedAt: current.submittedAt } });
    return { proposal: updated, from: [proposal.status], events: [event(proposal, at, system, "proposal.listing_updated", metadata)] };
  }

  const transition: ProposalTransition = next.status === "invalid" ? "fail" : "publish";
  const refusal = transitionRefusal(proposal.status, transition);
  if (refusal) throw new ProposalWriteError("invalid_transition", refusal);
  const to = PROPOSAL_TRANSITIONS[transition].to;
  const recorded = ProposalSchema.parse({
    ...proposal,
    status: to,
    ...(to === "applied" ? { appliedAt: next.submittedAt } : {}),
    listingSubmission: next,
  });
  const action = to === "applied" ? "proposal.applied" : "proposal.failed";
  return { proposal: recorded, from: [...PROPOSAL_TRANSITIONS[transition].from], events: [event(proposal, at, system, action, { type: proposal.type, ...metadata })] };
}

function assertCanTransition(ctx: ProposalWriteContext, transition: ProposalTransition): { proposal: Proposal; member: Member } {
  const { proposal, member } = ctx;
  if (!proposal) throw new ProposalWriteError("not_found", "That proposal no longer exists.");
  if (!member || !canDecideProposal(member, proposal)) {
    throw new ProposalWriteError("forbidden", "You don't have permission to decide this proposal.");
  }
  const refusal = transitionRefusal(proposal.status, transition);
  if (refusal) throw new ProposalWriteError("invalid_transition", refusal);
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
