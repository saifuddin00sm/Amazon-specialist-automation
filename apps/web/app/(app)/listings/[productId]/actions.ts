"use server";

import { AgentRunError } from "@app/data";
import { closeStalledListingOptimizerRun, listingOptimizerRunStalled, listingOptimizerUnavailable, requestListingOptimization } from "@app/workflows";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDataSource } from "@/lib/data";

export type RunActionResult = { ok: true; runId: string } | { ok: false; message: string };

const StartInput = z.object({ productId: z.string().min(1) });

/**
 * Starts the listing optimizer on a product as the workspace's acting member, then hands the run to
 * the optimizeListing workflow, which drafts, checks and reviews it and files the proposal. The
 * product page follows the run as its steps land. Nothing starts when the workflow couldn't finish
 * the run; a stalled earlier run is closed first.
 */
export async function startListingOptimizer(input: z.input<typeof StartInput>): Promise<RunActionResult> {
  const parsed = StartInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  const unavailable = listingOptimizerUnavailable();
  if (unavailable) return { ok: false, message: unavailable };

  const dataSource = await getDataSource();
  const product = await dataSource.getProduct(parsed.data.productId);
  const account = product && (await dataSource.getSellerAccount(product.sellerAccountId));
  const member = account && (await dataSource.getActingMember(account.workspaceId));
  if (!product || !account || !member) return { ok: false, message: "That product no longer exists." };

  try {
    const [latest] = await dataSource.listAgentRuns({ workspaceId: account.workspaceId, subjectId: product.id, limit: 1 });
    if (latest && listingOptimizerRunStalled(latest)) await closeStalledListingOptimizerRun(latest.id);
    const run = await dataSource.startListingOptimizer({ productId: product.id, memberId: member.id });
    const request = await requestListingOptimization({ runId: run.id, productId: product.id });
    refresh();
    return request.sent ? { ok: true, runId: run.id } : { ok: false, message: request.reason };
  } catch (error) {
    if (error instanceof AgentRunError) return { ok: false, message: error.message };
    throw error;
  }
}
