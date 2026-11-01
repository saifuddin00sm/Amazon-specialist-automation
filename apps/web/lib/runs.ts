import type { AgentRun, Proposal } from "@app/core";
import { SUGGESTIONS_ONLY_TITLE } from "@app/data";

/**
 * How a finished agent run ended, from the member's side: its proposal waits for a decision, the
 * system approved it (L2/L3), it only suggested (L0), the kill switch cancelled it, or it found
 * nothing to change.
 */
export type RunOutcome = "pending" | "auto_approved" | "suggested" | "cancelled" | "none";

export function runOutcome(run: Pick<AgentRun, "status" | "steps">, proposal: Pick<Proposal, "status"> | undefined): RunOutcome {
  if (run.status === "cancelled") return "cancelled";
  if (proposal) return proposal.status === "pending_approval" ? "pending" : "auto_approved";
  const last = run.steps?.at(-1);
  return last?.kind === "awaiting_approval" && last.title === SUGGESTIONS_ONLY_TITLE ? "suggested" : "none";
}
