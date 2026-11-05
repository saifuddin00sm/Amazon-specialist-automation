"use server";

import { CampaignBriefSchema, type AgentRun } from "@app/core";
import { AgentRunError } from "@app/data";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDataSource } from "@/lib/data";
import { runOutcome, type RunOutcome } from "@/lib/runs";

export type StrategistActionResult =
  | { ok: true; run: AgentRun; proposalId?: string; outcome?: RunOutcome }
  | { ok: false; message: string };

const StartInput = z.object({ sellerAccountId: z.string().min(1), brief: CampaignBriefSchema });
const CompleteInput = z.object({ runId: z.string().min(1) });

/** Hands the wizard's brief to the campaign strategist as the workspace's acting member. */
export async function startCampaignStrategist(input: z.input<typeof StartInput>): Promise<StrategistActionResult> {
  const parsed = StartInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pick products, a goal, a daily budget and a target ACoS." };

  const dataSource = await getDataSource();
  const account = await dataSource.getSellerAccount(parsed.data.sellerAccountId);
  const member = account && (await dataSource.getActingMember(account.workspaceId));
  if (!account || !member) return { ok: false, message: "That seller account no longer exists." };

  return runWrite(async () => {
    const run = await dataSource.startCampaignStrategist({ sellerAccountId: account.id, memberId: member.id, brief: parsed.data.brief });
    return { ok: true, run };
  });
}

/**
 * Phase 1 has no agent worker, so the wizard finishes the run once its replay ends. That files the
 * new campaign plan in the approval inbox, as the account's autonomy allows.
 */
export async function completeCampaignStrategistRun(input: z.input<typeof CompleteInput>): Promise<StrategistActionResult> {
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runWrite(async () => {
    const { run, proposal } = await (await getDataSource()).completeAgentRun(parsed.data.runId);
    return { ok: true, run, proposalId: proposal?.id, outcome: runOutcome(run, proposal) };
  });
}

async function runWrite(write: () => Promise<StrategistActionResult>): Promise<StrategistActionResult> {
  try {
    const result = await write();
    refresh();
    return result;
  } catch (error) {
    if (error instanceof AgentRunError) return { ok: false, message: error.message };
    throw error;
  }
}
