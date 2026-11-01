"use client";

import { toast } from "sonner";
import type { RunOutcome } from "@/lib/runs";

/** Tells the member how a run they watched ended, with a link to its proposal when there is one. */
export function announceRunOutcome(
  { outcome, proposalId }: { outcome?: RunOutcome; proposalId?: string },
  { what, open }: { what: string; open: (href: string) => void },
) {
  const review = proposalId ? { action: { label: "Review", onClick: () => open(`/approvals?proposal=${proposalId}`) } } : {};
  switch (outcome) {
    case "pending":
      toast.success(`${what} added to the approval inbox`, review);
      break;
    case "auto_approved":
      toast.success(`${what} auto-approved within guardrails`, {
        description: "Autonomy allows it on this account. Nothing changes on Amazon until approved changes are applied.",
        ...review,
      });
      break;
    case "suggested":
      toast.info("Suggestions only", { description: "Autonomy is L0 for this on this account, so nothing was filed." });
      break;
    case "cancelled":
      toast.warning("The run was cancelled", { description: "Agents are paused in this workspace." });
      break;
    case "none":
    case undefined:
      toast.info("No changes to propose.");
  }
}
