import { z } from "zod";
import { AutonomyLevelSchema } from "./autonomy";
import { ListingCopySchema } from "./catalog";
import { AgentNameSchema, EntityRefSchema, IdSchema, IsoDateTimeSchema } from "./common";
import { ComplianceCheckSchema } from "./compliance";
import { LlmCallSchema } from "./llm";
import { DiffEntrySchema } from "./proposal";
import { ReviewReportSchema, ReviewScoresSchema } from "./review";

export const AgentRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

const FINISHED_STATUSES: ReadonlySet<AgentRunStatus> = new Set(["succeeded", "failed", "cancelled"]);

const StepBase = {
  id: IdSchema,
  title: z.string().min(1),
  /** What the agent said while working on the step; the viewer streams it. */
  text: z.string(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
};

/** One stage of an agent run, in the order it happened. */
export const AgentRunStepSchema = z.discriminatedUnion("kind", [
  z.object({ ...StepBase, kind: z.literal("draft"), agent: AgentNameSchema, round: z.number().int().positive(), listing: ListingCopySchema }),
  z.object({ ...StepBase, kind: z.literal("compliance_check"), checks: z.array(ComplianceCheckSchema) }),
  z.object({
    ...StepBase,
    kind: z.literal("review"),
    agent: AgentNameSchema,
    round: z.number().int().positive(),
    scores: ReviewScoresSchema,
    overall: z.number().int().min(0).max(100),
    findings: ReviewReportSchema.shape.findings,
    /** The reviewer's one-sentence verdict. */
    summary: z.string().min(1).optional(),
    /** The overall a draft needs to be proposed without a flag. */
    target: z.number().int().min(0).max(100).optional(),
    /** The compliance gate: a draft that fails it scores 0, whatever the rubric says. */
    gate: z.object({ passed: z.boolean(), detail: z.string().optional() }).optional(),
  }),
  /** Changes one pass of the campaign optimizer found, as lines of the campaign plan's diff. */
  z.object({ ...StepBase, kind: z.literal("plan"), agent: AgentNameSchema, changes: z.array(DiffEntrySchema) }),
  /** The run's output is a Proposal waiting for a member. Set once the proposal exists. */
  z.object({ ...StepBase, kind: z.literal("awaiting_approval"), proposalId: IdSchema.optional() }),
]);
export type AgentRunStep = z.infer<typeof AgentRunStepSchema>;
export type AgentRunStepKind = AgentRunStep["kind"];

/** One execution of an agent against a seller account. */
export const AgentRunSchema = z
  .object({
    id: IdSchema,
    workspaceId: IdSchema,
    sellerAccountId: IdSchema,
    agent: AgentNameSchema,
    status: AgentRunStatusSchema,
    /** Autonomy level in force when the run started. */
    autonomyLevel: AutonomyLevelSchema,
    trigger: z.enum(["schedule", "manual", "event"]),
    /** The one entity the run worked on, when it targets one (e.g. the product a listing run rewrote). */
    subject: EntityRefSchema.optional(),
    summary: z.string(),
    proposalIds: z.array(IdSchema),
    /** Timeline of the run, when the agent recorded one. */
    steps: z.array(AgentRunStepSchema).optional(),
    /** Every model call the run made, in order, as the LLM gateway logged it. */
    llmCalls: z.array(LlmCallSchema).optional(),
    startedAt: IsoDateTimeSchema,
    finishedAt: IsoDateTimeSchema.optional(),
    error: z.string().optional(),
  })
  .refine((run) => FINISHED_STATUSES.has(run.status) === (run.finishedAt !== undefined), {
    message: "finishedAt is set exactly when the run has finished",
    path: ["finishedAt"],
  })
  .refine((run) => (run.status === "failed") === (run.error !== undefined), {
    message: "error is set exactly when the run failed",
    path: ["error"],
  })
  .refine((run) => (run.llmCalls ?? []).every((call) => call.stepId === undefined || run.steps?.some((step) => step.id === call.stepId)), {
    message: "a model call's step is one of the run's steps",
    path: ["llmCalls"],
  });
export type AgentRun = z.infer<typeof AgentRunSchema>;

/**
 * How long a running run can go without a new step before it counts as stalled: whatever was taking
 * it is gone (the worker never got it, or stopped). Generous, since a step is a model call with retries.
 */
export const AGENT_RUN_STALL_MS = 10 * 60_000;

/** When the run last moved: its latest step's end, or its start. */
export function lastActivityAt(run: Pick<AgentRun, "startedAt" | "steps">): Date {
  const last = run.steps?.at(-1)?.finishedAt ?? run.startedAt;
  return new Date(Math.max(Date.parse(last), Date.parse(run.startedAt)));
}

/** A run still marked running that hasn't moved in AGENT_RUN_STALL_MS. */
export function agentRunStalled(run: Pick<AgentRun, "status" | "startedAt" | "steps">, now: Date, afterMs = AGENT_RUN_STALL_MS): boolean {
  return run.status === "running" && now.getTime() - lastActivityAt(run).getTime() >= afterMs;
}
