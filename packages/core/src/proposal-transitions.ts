import type { ProposalStatus } from "./proposal";

type Transition = { from: readonly ProposalStatus[]; to: ProposalStatus };

/**
 * The proposal state machine: every way a filed proposal can change, and the statuses each one may
 * start from. It is the only place that says so; every write asks it first. The database mirrors
 * the status pairs in a trigger (supabase/migrations/20261101000014_proposal_transitions.sql).
 */
export const PROPOSAL_TRANSITIONS = {
  /** A member accepts the change, or the system does under autonomy L2+. Amazon is still untouched. */
  approve: { from: ["pending_approval"], to: "approved" },
  /** A member turns it down, with a reason. */
  reject: { from: ["pending_approval"], to: "rejected" },
  /** Hides it from the queue for a while; the status stays. */
  snooze: { from: ["pending_approval"], to: "pending_approval" },
  /** An agent filed a newer proposal for the same target. */
  supersede: { from: ["pending_approval"], to: "superseded" },
  /** The approved change is written to Amazon. Nothing that isn't approved is ever published. */
  publish: { from: ["approved"], to: "applied" },
  /** Amazon refused the approved change. */
  fail: { from: ["approved"], to: "failed" },
} as const satisfies Record<string, Transition>;

export type ProposalTransition = keyof typeof PROPOSAL_TRANSITIONS;

export function canTransition(status: ProposalStatus, transition: ProposalTransition): boolean {
  return (PROPOSAL_TRANSITIONS[transition].from as readonly ProposalStatus[]).includes(status);
}

/** Every (from, to) status pair some transition allows, a self-pair for snooze included. */
export function allowedStatusChanges(): [ProposalStatus, ProposalStatus][] {
  const pairs = Object.values(PROPOSAL_TRANSITIONS).flatMap(({ from, to }: Transition) => from.map((status) => `${status}>${to}`));
  return [...new Set(pairs)].map((pair) => pair.split(">") as [ProposalStatus, ProposalStatus]);
}

/** How a status reads in "Only … proposals can be …". */
const STATUS_ADJECTIVES: Record<ProposalStatus, string> = {
  pending_approval: "pending",
  approved: "approved",
  rejected: "rejected",
  applied: "published",
  failed: "failed",
  superseded: "superseded",
};

/** How a status reads in "This one …". */
const STATUS_PHRASES: Record<ProposalStatus, string> = {
  pending_approval: "is still pending approval",
  approved: "is already approved",
  rejected: "was rejected",
  applied: "was already published to Amazon",
  failed: "failed to publish",
  superseded: "was replaced by a newer proposal",
};

const DONE: Record<ProposalTransition, string> = {
  approve: "approved",
  reject: "rejected",
  snooze: "snoozed",
  supersede: "superseded",
  publish: "published",
  fail: "marked failed",
};

/**
 * Why `transition` can't happen to a proposal in `status`, in words a member can read, e.g. "Only
 * approved proposals can be published. This one is still pending approval." Undefined when it can.
 */
export function transitionRefusal(status: ProposalStatus, transition: ProposalTransition): string | undefined {
  if (canTransition(status, transition)) return undefined;
  const allowed = PROPOSAL_TRANSITIONS[transition].from.map((from) => STATUS_ADJECTIVES[from]).join(" or ");
  return `Only ${allowed} proposals can be ${DONE[transition]}. This one ${STATUS_PHRASES[status]}.`;
}
