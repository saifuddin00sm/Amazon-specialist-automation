import { listingsItemChange } from "@app/amazon";
import { agentRunStalled, type AgentRun, type Proposal } from "@app/core";
import type { RunStep } from "./catalog-sync";
import { inngest, listingOptimizeRequested, listingsItemChanged, proposalDecided } from "./client";
import { backgroundWorkUnavailable, workflowDeps } from "./deps";
import { OPTIMIZER_STOPPED, optimizeListingRun, type OptimizeListingRequest } from "./optimize-listing";

/** Why a run never started: the request didn't reach the workflows. */
export const WORKER_UNREACHABLE = "Couldn't reach the background worker, so the optimizer never started. Nothing changed on Amazon; try again in a moment.";

/** Why a run was closed before it finished: nothing had taken it forward in a long while. */
export const RUN_STALLED = "The optimizer stopped responding, so this run was closed. Nothing changed on Amazon.";

/**
 * Why the optimizer can't be started on this server, or undefined when it can: the workflow has to
 * be able to write the run's steps and finish it, or the run would stay "running" for good.
 */
export function listingOptimizerUnavailable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const reason = backgroundWorkUnavailable(env);
  return reason && `The optimizer can't run on this server yet. ${reason} Nothing was started.`;
}

/** Optimizer runs this process is taking with WORKFLOWS_INLINE=1, across module copies like the mock. */
const inlineRuns: Set<string> = ((globalThis as { __inlineOptimizerRuns?: Set<string> }).__inlineOptimizerRuns ??= new Set());

/**
 * Whether an optimizer run marked running is no longer being taken: it hasn't moved in
 * AGENT_RUN_STALL_MS, or (with WORKFLOWS_INLINE=1, where this process takes every run) this process
 * isn't taking it, as after a restart.
 */
export function listingOptimizerRunStalled(run: Pick<AgentRun, "id" | "status" | "startedAt" | "steps">, now = new Date(), env: NodeJS.ProcessEnv = process.env): boolean {
  if (run.status !== "running") return false;
  return (env.WORKFLOWS_INLINE === "1" && !inlineRuns.has(run.id)) || agentRunStalled(run, now);
}

/** Closes a stalled optimizer run as failed, so the product can be optimized again. */
export async function closeStalledListingOptimizerRun(runId: string): Promise<void> {
  await workflowDeps().dataSource.failAgentRun({ runId, error: RUN_STALLED });
}

/**
 * Hands a run DataSource.startListingOptimizer made to the optimizeListing workflow. When the
 * request can't be sent, the run fails with why, so the product isn't left waiting on it. Check
 * listingOptimizerUnavailable before starting the run: failing it needs the workflows' backend.
 *
 * With WORKFLOWS_INLINE=1 (the e2e, local development without the Inngest dev server) the workflow
 * runs here in the background instead, its steps run in order with their results passed through
 * JSON as Inngest keeps them, but with no retries.
 */
export async function requestListingOptimization(request: OptimizeListingRequest, env: NodeJS.ProcessEnv = process.env): Promise<{ sent: true } | { sent: false; reason: string }> {
  if (env.WORKFLOWS_INLINE === "1") {
    const deps = workflowDeps();
    inlineRuns.add(request.runId);
    void optimizeListingRun(deps, request, { run: inlineStep })
      .catch(async (error: unknown) => {
        // The error's name only: its message can quote seller data.
        console.warn(`[workflows] The listing optimizer stopped in-process (${error instanceof Error ? error.name : "unknown error"}).`);
        await deps.dataSource.failAgentRun({ runId: request.runId, error: OPTIMIZER_STOPPED }).catch(() => undefined);
      })
      .finally(() => inlineRuns.delete(request.runId));
    return { sent: true };
  }
  try {
    await inngest.send(listingOptimizeRequested.create(request));
    return { sent: true };
  } catch {
    await workflowDeps().dataSource.failAgentRun({ runId: request.runId, error: WORKER_UNREACHABLE });
    return { sent: false, reason: WORKER_UNREACHABLE };
  }
}

/** A step run in-process, its result passed through JSON as Inngest would keep it. */
const inlineStep: RunStep = async (_name, fn) => {
  const result = await fn();
  return result === undefined ? result : JSON.parse(JSON.stringify(result));
};

/**
 * Tells the workflows waiting on new listing proposals that members decided them. Best effort: the
 * decision is saved whether or not this reaches Inngest, and a workflow reads the proposal's status
 * itself when its wait ends, so a lost event only delays a submission.
 */
export async function announceDecisions(proposals: readonly Pick<Proposal, "id" | "type" | "status">[]): Promise<void> {
  const events = proposals.filter((proposal) => proposal.type === "new_listing").map((proposal) => proposalDecided.create({ proposalId: proposal.id, status: proposal.status }));
  if (events.length === 0) return;
  try {
    await inngest.send(events);
  } catch {
    console.warn("[workflows] Couldn't announce proposal decisions to Inngest; waiting workflows read them when their wait ends.");
  }
}

/**
 * Forwards an Amazon notification about a listing (bare, or as EventBridge delivers it) to the
 * workflows following it. False when it isn't one, so nothing was sent.
 */
export async function forwardListingsNotification(message: unknown): Promise<boolean> {
  const change = listingsItemChange(message);
  if (!change) return false;
  await inngest.send(listingsItemChanged.create(change));
  return true;
}
