import { LISTING_LIMITS, factSheet } from "@app/core";
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
    // The run starts empty; a call made before its step is recorded names no step.
    const run = await dataSource.startListingOptimizer({ productId: product.id, memberId: owner.id });
    const live = dataset.listingVersions.find((version) => version.productId === product.id && version.status === "live")!;
    const facts = dataset.productFacts.find((candidate) => candidate.productId === product.id)!;

    const provider: LlmProvider = {
      name: "anthropic",
      dataPolicy: { trainsOnInputs: false, basis: "test" },
      complete: async ({ model }) => ({
        model,
        text: JSON.stringify({
          listing: { title: live.title, bullets: live.bullets, description: live.description, backendKeywords: live.backendKeywords },
          changes: [],
          claims: [],
        }),
        stopReason: "end",
        usage: { inputTokens: 800, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    };
    const gateway = agentRunGateway({ dataSource, provider, runId: run.id });
    await gateway.generate({
      prompt: PROMPTS.listingRewrite,
      input: {
        productType: product.category,
        limits: LISTING_LIMITS,
        facts: factSheet(product.brand, facts),
        prohibitedClaims: facts.prohibitedClaims,
        keywords: facts.targetKeywords,
        live,
        findings: [],
      },
    });

    const logged = (await dataSource.getAgentRun(run.id))!.llmCalls!;
    expect(logged).toHaveLength(1);
    expect(logged[0]!.stepId).toBeUndefined();
    expect(logged[0]).toMatchObject({
      provider: "anthropic",
      promptId: "listing_writer.rewrite",
      promptVersion: 2,
      model: "claude-opus-5-5",
      inputTokens: 800,
      outputTokens: 300,
      // 800 × $4 + 300 × $20 per million.
      costUsd: 0.0092,
    });
  });
});
