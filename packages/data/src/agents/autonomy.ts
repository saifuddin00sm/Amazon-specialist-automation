import {
  ProposalSchema,
  autoApproves,
  filesProposals,
  type AgentRunStep,
  type AuditEvent,
  type AutonomyLevel,
  type ComplianceCheck,
  type Proposal,
  type Workspace,
} from "@app/core";
import { AgentRunError } from "../data-source";

type AuditDraft = Omit<AuditEvent, "id">;

/** Title of a run's last step when autonomy L0 kept it from filing anything. */
export const SUGGESTIONS_ONLY_TITLE = "Suggestions only";

export const AGENTS_PAUSED_MESSAGE = "Agents are paused in this workspace. An owner can resume them in Settings.";

/** Throws when the kill switch is on: no agent starts or files anything. */
export function assertAgentsRunning(workspace: Pick<Workspace, "agentsPausedAt"> | undefined): void {
  if (workspace?.agentsPausedAt !== undefined) throw new AgentRunError("conflict", AGENTS_PAUSED_MESSAGE);
}

export type FiledProposal =
  /** L0: the agent only suggests; nothing is filed. */
  | { outcome: "suggested" }
  | { outcome: "pending" | "auto_approved"; proposal: Proposal; events: AuditDraft[] };

/**
 * Applies the account's autonomy for the proposal's type to a proposal an agent drafted as pending:
 * L0 files nothing, L1 files it for a member, and L2/L3 have the system approve it when the guardrail
 * `checks` allow (see autoApproves). Approved is not applied: Amazon changes come later, never here.
 */
export function fileWithAutonomy(draft: Proposal, level: AutonomyLevel, checks: ComplianceCheck[], at: string): FiledProposal {
  if (!filesProposals(level)) return { outcome: "suggested" };
  const created: AuditDraft = {
    workspaceId: draft.workspaceId,
    sellerAccountId: draft.sellerAccountId,
    at,
    actor: draft.createdBy,
    action: "proposal.created",
    entity: { type: "proposal", id: draft.id },
    metadata: { type: draft.type, risk: draft.risk },
  };
  if (!autoApproves(level, { risk: draft.risk, checks })) return { outcome: "pending", proposal: draft, events: [created] };

  const note = level === "L2" ? "Auto-approved under L2: low risk and every guardrail passed." : "Auto-approved under L3: no guardrail blocks it.";
  const proposal = ProposalSchema.parse({ ...draft, status: "approved", decidedBy: { type: "system" }, decidedAt: at, decisionNote: note });
  return {
    outcome: "auto_approved",
    proposal,
    events: [
      created,
      { ...created, actor: { type: "system" }, action: "proposal.approved", metadata: { note, edited: false, autonomyLevel: level } },
    ],
  };
}

/** The run's last step, rewritten to say what happened to its output. */
export function finalStep(steps: AgentRunStep[] | undefined, filed: FiledProposal, what: string): AgentRunStep[] | undefined {
  return steps?.map((step) => {
    if (step.kind !== "awaiting_approval") return step;
    if (filed.outcome === "suggested") {
      return {
        ...step,
        title: SUGGESTIONS_ONLY_TITLE,
        text: `Autonomy for ${what} is L0 on this account, so the agent only suggests. Nothing was filed for approval.`,
      };
    }
    if (filed.outcome === "auto_approved") {
      return {
        ...step,
        title: "Auto-approved",
        text: `${filed.proposal.decisionNote} Approved isn't applied: Amazon is only changed when approved proposals are applied.`,
        proposalId: filed.proposal.id,
      };
    }
    return { ...step, proposalId: filed.proposal.id };
  });
}
