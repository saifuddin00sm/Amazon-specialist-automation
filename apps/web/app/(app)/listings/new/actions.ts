"use server";

import { NewListingBriefSchema, ProductTypeNameSchema, type AgentRun, type ProductType, type ProductTypeSummary } from "@app/core";
import { AgentRunError } from "@app/data";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDataSource } from "@/lib/data";
import { runOutcome, type RunOutcome } from "@/lib/runs";

export type ListingCreatorActionResult =
  | { ok: true; run: AgentRun; proposalId?: string; outcome?: RunOutcome }
  | { ok: false; message: string };

const SearchInput = z.object({ sellerAccountId: z.string().min(1), keywords: z.string().max(200) });
const ProductTypeInput = z.object({ sellerAccountId: z.string().min(1), productType: ProductTypeNameSchema });
const StartInput = z.object({ sellerAccountId: z.string().min(1), brief: NewListingBriefSchema });
const CompleteInput = z.object({ runId: z.string().min(1) });

/** Product types in the account's marketplace that match the wizard's search. */
export async function searchProductTypes(
  input: z.input<typeof SearchInput>,
): Promise<{ ok: true; results: ProductTypeSummary[] } | { ok: false; message: string }> {
  const parsed = SearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Search with fewer words." };
  const dataSource = await getDataSource();
  const account = await dataSource.getSellerAccount(parsed.data.sellerAccountId);
  if (!account) return { ok: false, message: "That seller account no longer exists." };
  return { ok: true, results: await dataSource.searchProductTypes({ marketplace: account.marketplace, keywords: parsed.data.keywords }) };
}

/** The attribute schema of the product type the wizard picked. */
export async function getProductType(
  input: z.input<typeof ProductTypeInput>,
): Promise<{ ok: true; productType: ProductType } | { ok: false; message: string }> {
  const parsed = ProductTypeInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pick a product type." };
  const dataSource = await getDataSource();
  const account = await dataSource.getSellerAccount(parsed.data.sellerAccountId);
  if (!account) return { ok: false, message: "That seller account no longer exists." };
  const productType = await dataSource.getProductType({ marketplace: account.marketplace, productType: parsed.data.productType });
  return productType ? { ok: true, productType } : { ok: false, message: `Amazon has no product type ${parsed.data.productType} in ${account.marketplace}.` };
}

/** Hands the wizard's brief to the listing creator as the workspace's acting member. */
export async function startListingCreator(input: z.input<typeof StartInput>): Promise<ListingCreatorActionResult> {
  const parsed = StartInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Fill in the product facts and pick a product type." };

  const dataSource = await getDataSource();
  const account = await dataSource.getSellerAccount(parsed.data.sellerAccountId);
  const member = account && (await dataSource.getActingMember(account.workspaceId));
  if (!account || !member) return { ok: false, message: "That seller account no longer exists." };

  return runWrite(async () => {
    const run = await dataSource.startListingCreator({ sellerAccountId: account.id, memberId: member.id, brief: parsed.data.brief });
    return { ok: true, run };
  });
}

/**
 * Phase 1 has no agent worker, so the wizard finishes the run once its replay ends. That files the
 * new listing draft in the approval inbox, as the account's autonomy allows.
 */
export async function completeListingCreatorRun(input: z.input<typeof CompleteInput>): Promise<ListingCreatorActionResult> {
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runWrite(async () => {
    const { run, proposal } = await (await getDataSource()).completeAgentRun(parsed.data.runId);
    return { ok: true, run, proposalId: proposal?.id, outcome: runOutcome(run, proposal) };
  });
}

async function runWrite(write: () => Promise<ListingCreatorActionResult>): Promise<ListingCreatorActionResult> {
  try {
    const result = await write();
    refresh();
    return result;
  } catch (error) {
    if (error instanceof AgentRunError) return { ok: false, message: error.message };
    throw error;
  }
}
