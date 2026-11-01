"use server";

import { AgentRunError } from "@app/data";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDataSource } from "@/lib/data";
import { runOutcome, type RunOutcome } from "@/lib/runs";

export type RunActionResult = { ok: true; runId: string; proposalId?: string; outcome?: RunOutcome } | { ok: false; message: string };

const StartInput = z.object({ campaignId: z.string().min(1) });
const CompleteInput = z.object({ runId: z.string().min(1) });

/** Starts the campaign optimizer on a campaign as the workspace's acting member. */
export async function startCampaignOptimizer(input: z.input<typeof StartInput>): Promise<RunActionResult> {
  const parsed = StartInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  const dataSource = await getDataSource();
  const campaign = await dataSource.getCampaign(parsed.data.campaignId);
  const account = campaign && (await dataSource.getSellerAccount(campaign.sellerAccountId));
  const member = account && (await dataSource.getActingMember(account.workspaceId));
  if (!campaign || !member) return { ok: false, message: "That campaign no longer exists." };

  return runWrite(async () => {
    const run = await dataSource.startCampaignOptimizer({ campaignId: campaign.id, memberId: member.id });
    return { ok: true, runId: run.id };
  });
}

/**
 * Phase 1 has no agent worker, so the viewer finishes the run once its replay ends. That files the
 * campaign plan in the approval inbox, when the run found changes.
 */
export async function completeCampaignOptimizerRun(input: z.input<typeof CompleteInput>): Promise<RunActionResult> {
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runWrite(async () => {
    const { run, proposal } = await (await getDataSource()).completeAgentRun(parsed.data.runId);
    return { ok: true, runId: run.id, proposalId: proposal?.id, outcome: runOutcome(run, proposal) };
  });
}

async function runWrite(write: () => Promise<RunActionResult>): Promise<RunActionResult> {
  try {
    const result = await write();
    refresh();
    return result;
  } catch (error) {
    if (error instanceof AgentRunError) return { ok: false, message: error.message };
    throw error;
  }
}
