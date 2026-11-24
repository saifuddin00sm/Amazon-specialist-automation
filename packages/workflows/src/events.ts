import { listingsItemChange } from "@app/amazon";
import type { Proposal } from "@app/core";
import { inngest, listingsItemChanged, proposalDecided } from "./client";

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
