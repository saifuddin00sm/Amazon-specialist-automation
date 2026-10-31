import { z } from "zod";
import { ActorSchema, EntityRefSchema, IdSchema, IsoDateTimeSchema } from "./common";

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
    scores: ProposalScoresSchema,
    reviewId: IdSchema.optional(),
    createdBy: ActorSchema,
    createdAt: IsoDateTimeSchema,
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
  });
export type Proposal = z.infer<typeof ProposalSchema>;
