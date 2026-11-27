import { AGENT_RUN_STALL_MS, agentRunStalled, type AgentRun, type AgentRunStep } from "@app/core";
import { getMockDataSource } from "@app/data";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RUN_STALLED, closeStalledListingOptimizerRun, listingOptimizerRunStalled, listingOptimizerUnavailable, requestListingOptimization } from "./events";

const INLINE = { WORKFLOWS_INLINE: "1" } as NodeJS.ProcessEnv;
const ON_INNGEST = {} as NodeJS.ProcessEnv;

/** An active product of the mock's with a live listing and no proposal waiting, and who may run agents on it. */
async function optimizable() {
  const source = getMockDataSource();
  const [workspace] = await source.listWorkspaces();
  const owner = (await source.listMembers(workspace!.id)).find((member) => member.role === "owner")!;
  const [account] = await source.listSellerAccounts(workspace!.id);
  const pending = await source.listProposals({ workspaceId: workspace!.id, status: "pending_approval" });
  for (const product of await source.listProducts({ sellerAccountId: account!.id, status: "active" })) {
    if (pending.some((proposal) => proposal.target.id === product.id)) continue;
    if (!(await source.listListingVersions(product.id)).some((version) => version.status === "live")) continue;
    const [latest] = await source.listAgentRuns({ workspaceId: workspace!.id, subjectId: product.id, limit: 1 });
    if (latest?.status !== "running") return { source, owner, product };
  }
  throw new Error("The mock has no product to optimize.");
}

const running = (startedAt: string, steps: AgentRun["steps"] = []) => ({ id: "run_x", status: "running" as const, startedAt, steps });

describe("listingOptimizerUnavailable", () => {
  it("refuses before anything starts when the workflows couldn't write the run", () => {
    expect(listingOptimizerUnavailable({ DATA_SOURCE: "supabase", SUPABASE_URL: "http://127.0.0.1:55321" } as NodeJS.ProcessEnv)).toMatch(
      /SUPABASE_SECRET_KEY.*Nothing was started/,
    );
    expect(listingOptimizerUnavailable({ DATA_SOURCE: "supabase", SUPABASE_URL: "http://127.0.0.1:55321", SUPABASE_SECRET_KEY: "key" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(listingOptimizerUnavailable({ DATA_SOURCE: "mock" } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("listingOptimizerRunStalled", () => {
  const start = "2026-11-27T09:00:00.000Z";
  const at = (ms: number) => new Date(Date.parse(start) + ms);

  it("counts a run on Inngest stalled once nothing has moved it in a while", () => {
    expect(listingOptimizerRunStalled(running(start), at(AGENT_RUN_STALL_MS - 1), ON_INNGEST)).toBe(false);
    expect(listingOptimizerRunStalled(running(start), at(AGENT_RUN_STALL_MS), ON_INNGEST)).toBe(true);
    // A step counts as progress.
    const step: AgentRunStep = { id: "run_x_plan", kind: "plan", agent: "listing_writer", title: "Read the listing", text: "", changes: [], startedAt: at(5 * 60_000).toISOString(), finishedAt: at(6 * 60_000).toISOString() };
    expect(agentRunStalled(running(start, [step]), at(AGENT_RUN_STALL_MS + 60_000))).toBe(false);
    expect(listingOptimizerRunStalled({ ...running(start), status: "failed" }, at(AGENT_RUN_STALL_MS * 10), ON_INNGEST)).toBe(false);
  });

  it("counts an inline run this process isn't taking stalled at once, as after a restart", () => {
    expect(listingOptimizerRunStalled(running(new Date().toISOString()), new Date(), INLINE)).toBe(true);
  });
});

describe("inline optimizer runs", () => {
  beforeAll(() => {
    vi.stubEnv("DATA_SOURCE", "mock");
    vi.stubEnv("LLM_PROVIDER", "stand-in");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("closes a run left running by a restart, so the product can be optimized again", async () => {
    const { source, owner, product } = await optimizable();
    const orphan = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });
    expect(listingOptimizerRunStalled(orphan, new Date(), INLINE)).toBe(true);
    await expect(source.startListingOptimizer({ productId: product.id, memberId: owner.id })).rejects.toMatchObject({ code: "conflict" });

    await closeStalledListingOptimizerRun(orphan.id);
    expect(await source.getAgentRun(orphan.id)).toMatchObject({ status: "failed", error: RUN_STALLED });
    const next = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });
    await closeStalledListingOptimizerRun(next.id);
  });

  it("follows a run it is taking until it files the proposal", async () => {
    const { source, owner, product } = await optimizable();
    const run = await source.startListingOptimizer({ productId: product.id, memberId: owner.id });
    expect(await requestListingOptimization({ runId: run.id, productId: product.id }, INLINE)).toEqual({ sent: true });
    expect(listingOptimizerRunStalled(run, new Date(), INLINE)).toBe(false);

    await vi.waitFor(async () => expect((await source.getAgentRun(run.id))?.status).toBe("succeeded"), { timeout: 20_000, interval: 100 });
    expect((await source.getAgentRun(run.id))?.proposalIds).toHaveLength(1);
  }, 30_000);
});
