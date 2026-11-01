"use server";

import { AgentRunError } from "@app/data";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDataSource } from "@/lib/data";

export type RunActionResult = { ok: true; runId: string; proposalId?: string } | { ok: false; message: string };

const StartInput = z.object({ productId: z.string().min(1) });
const CompleteInput = z.object({ runId: z.string().min(1) });

/** Starts the listing optimizer on a product as the workspace's acting member. */
export async function startListingOptimizer(input: z.input<typeof StartInput>): Promise<RunActionResult> {
  const parsed = StartInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  const dataSource = await getDataSource();
  const product = await dataSource.getProduct(parsed.data.productId);
  const account = product && (await dataSource.getSellerAccount(product.sellerAccountId));
  const member = account && (await dataSource.getActingMember(account.workspaceId));
  if (!product || !member) return { ok: false, message: "That product no longer exists." };

  return runWrite(async () => {
    const run = await dataSource.startListingOptimizer({ productId: product.id, memberId: member.id });
    return { ok: true, runId: run.id };
  });
}

/**
 * Phase 1 has no agent worker, so the viewer finishes the run once its replay ends. That files the
 * run's Proposal in the approval inbox.
 */
export async function completeOptimizerRun(input: z.input<typeof CompleteInput>): Promise<RunActionResult> {
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runWrite(async () => {
    const { run, proposal } = await (await getDataSource()).completeAgentRun(parsed.data.runId);
    return { ok: true, runId: run.id, proposalId: proposal?.id };
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
