import { z } from "zod";
import { AutonomyLevelSchema } from "./autonomy";
import { AgentNameSchema, IdSchema, IsoDateTimeSchema } from "./common";

export const AgentRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

const FINISHED_STATUSES: ReadonlySet<AgentRunStatus> = new Set(["succeeded", "failed", "cancelled"]);

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
    summary: z.string(),
    proposalIds: z.array(IdSchema),
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
  });
export type AgentRun = z.infer<typeof AgentRunSchema>;
