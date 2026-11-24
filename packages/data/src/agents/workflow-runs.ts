import { AgentRunSchema, canActOnAccount, type AgentRun, type AgentRunStep, type AuditEvent, type LlmCall } from "@app/core";
import { AgentRunError } from "../data-source";
import { assertAgentsRunning } from "./autonomy";
import type { ListingCreatorStore } from "./listing-creator";

// Runs an Inngest workflow drives (packages/workflows), as opposed to the Phase 1 stand-ins whose
// steps are planned up front: the workflow starts the run empty, appends each step as it takes it,
// and either files its output (completeAgentRun) or stops with a reason. Backend only.

type AuditDraft = Omit<AuditEvent, "id">;

export const WORKFLOW_RUNS_BACKEND_ONLY = "Only the backend's workflows record their runs.";

/**
 * Starts the newListing workflow's listing creator run for a member's New listing request, with no
 * steps yet. The member must be able to run agents on the account, and agents must be running.
 */
export function startNewListingWorkflowRun(
  store: Pick<ListingCreatorStore, "workspace" | "members" | "account">,
  { runId, sellerAccountId, memberId, productType, at }: { runId: string; sellerAccountId: string; memberId: string; productType: string; at: Date },
): { run: AgentRun; events: AuditDraft[] } {
  const { account } = store;
  if (!account || account.id !== sellerAccountId) throw new AgentRunError("not_found", "That seller account doesn't exist.");
  const member = store.members.find((candidate) => candidate.id === memberId);
  if (!member || !canActOnAccount(member, { workspaceId: account.workspaceId, sellerAccountId: account.id })) {
    throw new AgentRunError("forbidden", "You don't have permission to run agents on this account.");
  }
  assertAgentsRunning(store.workspace);

  const run = AgentRunSchema.parse({
    id: runId,
    workspaceId: account.workspaceId,
    sellerAccountId: account.id,
    agent: "listing_creator",
    status: "running",
    autonomyLevel: account.autonomyLevel,
    trigger: "manual",
    summary: "Drafting a new listing.",
    proposalIds: [],
    steps: [],
    startedAt: at.toISOString(),
  });
  return {
    run,
    events: [
      {
        workspaceId: run.workspaceId,
        sellerAccountId: run.sellerAccountId,
        at: run.startedAt,
        actor: { type: "agent", agent: "listing_creator", agentRunId: run.id },
        action: "agent_run.started",
        entity: { type: "agent_run", id: run.id },
        metadata: { trigger: "manual", requestedBy: memberId, productType },
      },
    ],
  };
}

/**
 * A running run with `steps` after the ones it has, and the model calls made for them after its
 * calls. Steps it already has, by id, are skipped, and so are the calls when every step was: a retried
 * workflow step appends nothing twice. Returns what is new.
 */
export function withSteps(
  run: AgentRun | undefined,
  steps: readonly AgentRunStep[],
  llmCalls: readonly LlmCall[] = [],
): { run: AgentRun; added: AgentRunStep[]; calls: LlmCall[] } {
  if (!run) throw new AgentRunError("not_found", "That agent run doesn't exist.");
  const have = new Set((run.steps ?? []).map((step) => step.id));
  const added = steps.filter((step) => !have.has(step.id));
  if (added.length === 0) return { run, added, calls: [] };
  if (run.status !== "running") throw new AgentRunError("conflict", "That agent run has finished; its steps are final.");
  const calls = [...llmCalls];
  const next = AgentRunSchema.safeParse({
    ...run,
    steps: [...(run.steps ?? []), ...added],
    ...(calls.length > 0 ? { llmCalls: [...(run.llmCalls ?? []), ...calls] } : {}),
  });
  if (!next.success) throw new AgentRunError("invalid_input", "Those steps, or their model calls, aren't valid.");
  return { run: next.data, added, calls };
}

/** A running run stopped for `error`, a reason a member can read. A finished run comes back as it is. */
export function failedRun(run: AgentRun | undefined, { error, at }: { error: string; at: string }): { run: AgentRun; events: AuditDraft[] } {
  if (!run) throw new AgentRunError("not_found", "That agent run doesn't exist.");
  if (run.status !== "running") return { run, events: [] };
  const failed = AgentRunSchema.parse({ ...run, status: "failed", error, summary: error, finishedAt: at });
  return {
    run: failed,
    events: [
      {
        workspaceId: run.workspaceId,
        sellerAccountId: run.sellerAccountId,
        at,
        actor: { type: "agent", agent: run.agent, agentRunId: run.id },
        action: "agent_run.finished",
        entity: { type: "agent_run", id: run.id },
        metadata: { status: "failed", proposals: 0 },
      },
    ],
  };
}
