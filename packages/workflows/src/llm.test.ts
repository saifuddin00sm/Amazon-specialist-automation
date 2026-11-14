import { createMockDataSource, generateMockDataset } from "@app/data";
import { PROMPTS, type LlmProvider } from "@app/llm";
import { describe, expect, it } from "vitest";
import { agentRunGateway } from "./llm";

describe("agentRunGateway", () => {
  it("logs every call to the agent run it works for", async () => {
    const dataset = generateMockDataset();
    const dataSource = createMockDataSource(dataset);
    const workspace = dataset.workspaces[0]!;
    const owner = dataset.members.find((member) => member.workspaceId === workspace.id && member.role === "owner")!;
    const account = dataset.sellerAccounts.find((candidate) => candidate.workspaceId === workspace.id)!;
    const product = dataset.products.find(
      (candidate) =>
        candidate.sellerAccountId === account.id &&
        candidate.status === "active" &&
        dataset.listingVersions.some((version) => version.productId === candidate.id && version.status === "live") &&
        !dataset.proposals.some((proposal) => proposal.target.id === candidate.id && proposal.status === "pending_approval"),
    )!;
    const run = await dataSource.startListingOptimizer({ productId: product.id, memberId: owner.id });
    const draftStep = run.steps!.find((step) => step.kind === "draft")!;
    const live = dataset.listingVersions.find((version) => version.productId === product.id && version.status === "live")!;
    const facts = dataset.productFacts.find((candidate) => candidate.productId === product.id)!;

    const provider: LlmProvider = {
      name: "anthropic",
      dataPolicy: { trainsOnInputs: false, basis: "test" },
      complete: async ({ model }) => ({
        model,
        text: JSON.stringify({ title: live.title, bullets: live.bullets, description: live.description, backendKeywords: live.backendKeywords }),
        stopReason: "end",
        usage: { inputTokens: 800, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    };
    const gateway = agentRunGateway({ dataSource, provider, runId: run.id });
    await gateway.generate({
      prompt: PROMPTS.listingRewrite,
      input: { brand: product.brand, productTitle: product.title, facts, live, findings: [] },
      stepId: draftStep.id,
    });

    const logged = (await dataSource.getAgentRun(run.id))!.llmCalls!;
    expect(logged).toHaveLength(run.llmCalls!.length + 1);
    expect(logged.at(-1)).toMatchObject({
      stepId: draftStep.id,
      provider: "anthropic",
      promptId: "listing_writer.rewrite",
      promptVersion: 1,
      model: "claude-opus-5-5",
      inputTokens: 800,
      outputTokens: 300,
      // 800 × $4 + 300 × $20 per million.
      costUsd: 0.0092,
    });
  });
});
