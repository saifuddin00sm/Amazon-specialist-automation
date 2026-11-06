"use server";

import { DECISION_NOTE_MAX_LENGTH, DiffEditSchema } from "@app/core";
import { ProposalWriteError } from "@app/data";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDataSource } from "@/lib/data";

export type ActionResult = {
  /** Proposals the write went through for. */
  done: string[];
  errors: { proposalId: string; message: string }[];
};

const IdsSchema = z.array(z.string().min(1)).min(1).max(200);
const NoteSchema = z.string().max(DECISION_NOTE_MAX_LENGTH).optional();

const ApproveInput = z.object({ ids: IdsSchema, note: NoteSchema });
const ApproveWithEditsInput = z.object({ id: z.string().min(1), edits: z.array(DiffEditSchema).min(1), note: NoteSchema });
const RejectInput = z.object({ ids: IdsSchema, reason: z.string().trim().min(1, "A reason is required to reject.").max(DECISION_NOTE_MAX_LENGTH) });
const SnoozeInput = z.object({ ids: IdsSchema, hours: z.literal([24, 72, 168]) });
const PublishInput = z.object({ ids: IdsSchema });

export async function approveProposals(input: z.input<typeof ApproveInput>): Promise<ActionResult> {
  const parsed = ApproveInput.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);
  const { ids, note } = parsed.data;
  return forEachProposal(ids, async (proposalId, memberId) => (await getDataSource()).approveProposal({ proposalId, memberId, note }));
}

export async function approveProposalWithEdits(input: z.input<typeof ApproveWithEditsInput>): Promise<ActionResult> {
  const parsed = ApproveWithEditsInput.safeParse(input);
  if (!parsed.success) return invalid({ ids: [input.id] }, parsed.error);
  const { id, edits, note } = parsed.data;
  return forEachProposal([id], async (proposalId, memberId) => (await getDataSource()).approveProposal({ proposalId, memberId, note, edits }));
}

export async function rejectProposals(input: z.input<typeof RejectInput>): Promise<ActionResult> {
  const parsed = RejectInput.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);
  const { ids, reason } = parsed.data;
  return forEachProposal(ids, async (proposalId, memberId) => (await getDataSource()).rejectProposal({ proposalId, memberId, reason }));
}

export async function snoozeProposals(input: z.input<typeof SnoozeInput>): Promise<ActionResult> {
  const parsed = SnoozeInput.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);
  const { ids, hours } = parsed.data;
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  return forEachProposal(ids, async (proposalId, memberId) => (await getDataSource()).snoozeProposal({ proposalId, memberId, until }));
}

/** Publishes approved proposals. Anything not approved comes back as an error and is left as it was. */
export async function publishProposals(input: z.input<typeof PublishInput>): Promise<ActionResult> {
  const parsed = PublishInput.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);
  return forEachProposal(parsed.data.ids, async (proposalId, memberId) => (await getDataSource()).publishProposal({ proposalId, memberId }));
}

/**
 * Runs one write per proposal as the acting member of the proposal's workspace. Each write records
 * its own AuditEvent in the DataSource; refusals come back as messages instead of throwing.
 */
async function forEachProposal(
  ids: string[],
  write: (proposalId: string, memberId: string) => Promise<unknown>,
): Promise<ActionResult> {
  const dataSource = await getDataSource();
  const result: ActionResult = { done: [], errors: [] };

  for (const proposalId of new Set(ids)) {
    const proposal = await dataSource.getProposal(proposalId);
    const member = proposal && (await dataSource.getActingMember(proposal.workspaceId));
    try {
      if (!proposal || !member) throw new ProposalWriteError("not_found", "That proposal no longer exists.");
      await write(proposalId, member.id);
      result.done.push(proposalId);
    } catch (error) {
      if (!(error instanceof ProposalWriteError)) throw error;
      result.errors.push({ proposalId, message: error.message });
    }
  }

  if (result.done.length > 0) refresh();
  return result;
}

function invalid(input: unknown, error: z.ZodError): ActionResult {
  const ids = typeof input === "object" && input && "ids" in input && Array.isArray(input.ids) ? input.ids : [];
  const message = error.issues[0]?.message ?? "Invalid request.";
  return { done: [], errors: (ids.length > 0 ? ids : ["unknown"]).map((proposalId) => ({ proposalId: String(proposalId), message })) };
}
