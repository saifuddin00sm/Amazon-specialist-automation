import { z } from "zod";
import { ActorSchema, EntityRefSchema, IdSchema, IsoDateTimeSchema } from "./common";
import { DataFreshnessSchema } from "./freshness";

export const ProposalTypeSchema = z.enum([
  "listing_update",
  "price_change",
  "bid_change",
  "budget_change",
  "keyword_add",
  "keyword_negate",
  "target_pause",
]);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;

export const ProposalStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "rejected",
  "applied",
  "failed",
  "superseded",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

/** Statuses that require a human decision to have been recorded. */
const DECIDED_STATUSES: ReadonlySet<ProposalStatus> = new Set(["approved", "rejected", "applied", "failed"]);

export const ProposalRiskSchema = z.enum(["low", "medium", "high"]);
export type ProposalRisk = z.infer<typeof ProposalRiskSchema>;

/** One changed field. `path` is relative to the target entity, e.g. "bid" or "bullets.2". */
export const DiffEntrySchema = z.object({
  path: z.string().min(1),
  before: z.json(),
  after: z.json(),
});
export type DiffEntry = z.infer<typeof DiffEntrySchema>;

/** A member's replacement for the `after` value at one diff path. */
export const DiffEditSchema = DiffEntrySchema.pick({ path: true, after: true });
export type DiffEdit = z.infer<typeof DiffEditSchema>;

export const ProposalScoresSchema = z.object({
  /** How sure the agent is the change is right, 0–100. */
  confidence: z.number().int().min(0).max(100),
  /** Expected business impact, 0–100. */
  impact: z.number().int().min(0).max(100),
  /** Review overall score of the proposed listing, when there is one. */
  rubric: z.number().int().min(0).max(100).optional(),
});
export type ProposalScores = z.infer<typeof ProposalScoresSchema>;

/** Any change to Amazon or to spend. Nothing is applied until a Proposal is approved. */
export const ProposalSchema = z
  .object({
    id: IdSchema,
    workspaceId: IdSchema,
    sellerAccountId: IdSchema,
    type: ProposalTypeSchema,
    status: ProposalStatusSchema,
    risk: ProposalRiskSchema,
    title: z.string().min(1),
    rationale: z.string().min(1),
    target: EntityRefSchema,
    diff: z.array(DiffEntrySchema).min(1),
    /** The agent's diff, kept when a member edited `diff` before approving. */
    originalDiff: z.array(DiffEntrySchema).min(1).optional(),
    scores: ProposalScoresSchema,
    /** How current each input the agent used was. */
    freshness: z.array(DataFreshnessSchema).min(1),
    reviewId: IdSchema.optional(),
    createdBy: ActorSchema,
    createdAt: IsoDateTimeSchema,
    /** Hidden from the approval queue until then. Only pending proposals can be snoozed. */
    snoozedUntil: IsoDateTimeSchema.optional(),
    /** A member, or the system when autonomy (L2+) auto-approved it within guardrails. */
    decidedBy: ActorSchema.optional(),
    decidedAt: IsoDateTimeSchema.optional(),
    decisionNote: z.string().optional(),
    appliedAt: IsoDateTimeSchema.optional(),
  })
  .superRefine((proposal, ctx) => {
    if (DECIDED_STATUSES.has(proposal.status) && (!proposal.decidedBy || !proposal.decidedAt)) {
      ctx.addIssue({
        code: "custom",
        message: `A ${proposal.status} proposal needs decidedBy and decidedAt`,
        path: ["decidedBy"],
      });
    }
    if (proposal.status === "applied" && !proposal.appliedAt) {
      ctx.addIssue({ code: "custom", message: "An applied proposal needs appliedAt", path: ["appliedAt"] });
    }
    if (proposal.status !== "applied" && proposal.appliedAt) {
      ctx.addIssue({ code: "custom", message: "Only applied proposals have appliedAt", path: ["appliedAt"] });
    }
    if (proposal.status !== "pending_approval" && proposal.snoozedUntil) {
      ctx.addIssue({ code: "custom", message: "Only pending proposals can be snoozed", path: ["snoozedUntil"] });
    }
    if (proposal.status === "rejected" && proposal.decidedBy?.type === "member" && !proposal.decisionNote?.trim()) {
      ctx.addIssue({ code: "custom", message: "A member rejection needs a reason", path: ["decisionNote"] });
    }
  });
export type Proposal = z.infer<typeof ProposalSchema>;

/** Longest decision note or rejection reason a member can write. */
export const DECISION_NOTE_MAX_LENGTH = 500;

/** Proposal types whose `after` values a member may change before approving. */
export const EDITABLE_PROPOSAL_TYPES: ReadonlySet<ProposalType> = new Set([
  "listing_update",
  "price_change",
  "bid_change",
  "budget_change",
  "keyword_add",
  "keyword_negate",
]);

/**
 * Replaces `after` values in a diff. Every edit must name a path already in the diff and keep the
 * value's shape (string stays string, array stays array, ...). Returns an error message otherwise.
 */
export function applyDiffEdits(diff: DiffEntry[], edits: DiffEdit[]): { diff: DiffEntry[] } | { error: string } {
  const byPath = new Map(edits.map((edit) => [edit.path, edit.after]));
  if (byPath.size !== edits.length) return { error: "Each path can only be edited once." };
  for (const path of byPath.keys()) {
    if (!diff.some((entry) => entry.path === path)) return { error: `"${path}" is not part of this proposal.` };
  }
  const next: DiffEntry[] = [];
  for (const entry of diff) {
    if (!byPath.has(entry.path)) {
      next.push(entry);
      continue;
    }
    const after = byPath.get(entry.path) ?? null;
    if (jsonShape(after) !== jsonShape(entry.after)) {
      return { error: `"${entry.path}" must stay a ${jsonShape(entry.after)}.` };
    }
    next.push({ ...entry, after });
  }
  return { diff: next };
}

function jsonShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  return typeof value === "object" ? "object" : typeof value;
}
