import { describe, expect, it } from "vitest";
import { TargetSchema } from "./advertising";
import { AgentRunSchema } from "./agent-run";
import { AutonomyLevelSchema } from "./autonomy";
import { LISTING_LIMITS, ListingVersionSchema } from "./catalog";
import { isAgentProduced } from "./common";
import { MetricsDailySchema } from "./metrics";
import { ProposalSchema, type Proposal } from "./proposal";
import { overallScore } from "./review";
import { MemberSchema, SellerAccountSchema } from "./workspace";

const at = "2026-10-30T12:00:00.000Z";

describe("AutonomyLevelSchema", () => {
  it("only allows L0–L3", () => {
    expect(AutonomyLevelSchema.options).toEqual(["L0", "L1", "L2", "L3"]);
    expect(AutonomyLevelSchema.safeParse("L4").success).toBe(false);
  });
});

describe("MemberSchema", () => {
  const member = {
    id: "mem_1",
    workspaceId: "ws_1",
    name: "Ana Diaz",
    email: "ana@example.com",
    role: "client_approver",
    sellerAccountIds: ["sa_1"],
    createdAt: at,
  };

  it("accepts a scoped client approver", () => {
    expect(MemberSchema.safeParse(member).success).toBe(true);
  });

  it("rejects a client approver with no seller accounts", () => {
    expect(MemberSchema.safeParse({ ...member, sellerAccountIds: [] }).success).toBe(false);
  });
});

describe("SellerAccountSchema", () => {
  it("rejects an unknown marketplace", () => {
    const result = SellerAccountSchema.safeParse({
      id: "sa_1",
      workspaceId: "ws_1",
      name: "Acme US",
      sellerId: "A1B2C3D4E5F6G7",
      marketplace: "XX",
      currency: "USD",
      autonomyLevel: "L1",
      connectedAt: at,
    });
    expect(result.success).toBe(false);
  });
});

describe("ListingVersionSchema", () => {
  const version = {
    id: "lv_1",
    productId: "prd_1",
    version: 1,
    status: "live",
    title: "Steel water bottle",
    bullets: ["Keeps drinks cold"],
    description: "",
    backendKeywords: "flask thermos",
    createdBy: { type: "system" },
    createdAt: at,
  };

  it("accepts a valid version", () => {
    expect(ListingVersionSchema.safeParse(version).success).toBe(true);
  });

  it("enforces Amazon title and bullet limits", () => {
    const longTitle = "x".repeat(LISTING_LIMITS.titleMaxLength + 1);
    expect(ListingVersionSchema.safeParse({ ...version, title: longTitle }).success).toBe(false);
    expect(ListingVersionSchema.safeParse({ ...version, bullets: Array(6).fill("b") }).success).toBe(false);
  });

  it("measures backend keywords in bytes, not characters", () => {
    expect(ListingVersionSchema.safeParse({ ...version, backendKeywords: "é".repeat(125) }).success).toBe(false);
  });
});

describe("ProposalSchema", () => {
  const pending: Proposal = {
    id: "prop_1",
    workspaceId: "ws_1",
    sellerAccountId: "sa_1",
    type: "bid_change",
    status: "pending_approval",
    risk: "low",
    title: "Lower bid on 'water bottle'",
    rationale: "ACoS above target for 14 days.",
    target: { type: "target", id: "tgt_1" },
    diff: [{ path: "bid", before: 1.2, after: 0.95 }],
    scores: { confidence: 80, impact: 40 },
    freshness: [{ source: "ad_metrics", asOf: "2026-10-30T02:00:00.000Z" }],
    createdBy: { type: "agent", agent: "bid_optimizer", agentRunId: "run_1" },
    createdAt: at,
  };

  it("accepts a pending proposal", () => {
    expect(ProposalSchema.safeParse(pending).success).toBe(true);
  });

  it("requires a decision for approved proposals", () => {
    expect(ProposalSchema.safeParse({ ...pending, status: "approved" }).success).toBe(false);
    expect(
      ProposalSchema.safeParse({ ...pending, status: "approved", decidedBy: { type: "member" as const, memberId: "mem_1" }, decidedAt: at }).success,
    ).toBe(true);
  });

  it("ties appliedAt to the applied status", () => {
    const decided = { ...pending, decidedBy: { type: "member" as const, memberId: "mem_1" }, decidedAt: at };
    expect(ProposalSchema.safeParse({ ...decided, status: "applied" }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...decided, status: "applied", appliedAt: at }).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...decided, status: "approved", appliedAt: at }).success).toBe(false);
  });

  it("requires at least one diff entry", () => {
    expect(ProposalSchema.safeParse({ ...pending, diff: [] }).success).toBe(false);
  });

  it("only lets pending proposals be snoozed", () => {
    const decided = { ...pending, decidedBy: { type: "member" as const, memberId: "mem_1" }, decidedAt: at };
    expect(ProposalSchema.safeParse({ ...pending, snoozedUntil: at }).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...decided, status: "approved", snoozedUntil: at }).success).toBe(false);
  });

  it("requires a reason when a member rejects", () => {
    const rejected = { ...pending, status: "rejected" as const, decidedBy: { type: "member" as const, memberId: "mem_1" }, decidedAt: at };
    expect(ProposalSchema.safeParse(rejected).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...rejected, decisionNote: "  " }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...rejected, decisionNote: "Off brand." }).success).toBe(true);
  });
});

describe("TargetSchema", () => {
  const keyword = {
    id: "tgt_1",
    adGroupId: "ag_1",
    state: "enabled",
    negative: false,
    bid: 0.9,
    kind: "keyword",
    keyword: "water bottle",
    matchType: "exact",
  };

  it("accepts each target kind", () => {
    expect(TargetSchema.safeParse(keyword).success).toBe(true);
    expect(TargetSchema.safeParse({ ...keyword, kind: "product", asin: "B0ABCDEFGH" }).success).toBe(true);
    expect(TargetSchema.safeParse({ ...keyword, kind: "auto", autoType: "close_match" }).success).toBe(true);
  });

  it("requires bids on positive targets only", () => {
    expect(TargetSchema.safeParse({ ...keyword, bid: undefined }).success).toBe(false);
    expect(TargetSchema.safeParse({ ...keyword, negative: true }).success).toBe(false);
    expect(TargetSchema.safeParse({ ...keyword, negative: true, bid: undefined }).success).toBe(true);
  });
});

describe("MetricsDailySchema", () => {
  const row = {
    date: "2026-10-30",
    sellerAccountId: "sa_1",
    entityType: "target",
    entityId: "tgt_1",
    impressions: 100,
    clicks: 5,
    spend: 4.5,
    adSales: 30,
    adOrders: 1,
  };

  it("accepts a consistent row", () => {
    expect(MetricsDailySchema.safeParse(row).success).toBe(true);
  });

  it("rejects impossible funnels", () => {
    expect(MetricsDailySchema.safeParse({ ...row, clicks: 101 }).success).toBe(false);
    expect(MetricsDailySchema.safeParse({ ...row, adOrders: 6 }).success).toBe(false);
  });
});

describe("AgentRunSchema", () => {
  const run = {
    id: "run_1",
    workspaceId: "ws_1",
    sellerAccountId: "sa_1",
    agent: "listing_writer",
    status: "succeeded",
    autonomyLevel: "L1",
    trigger: "schedule",
    summary: "Drafted 3 listings",
    proposalIds: [],
    startedAt: at,
    finishedAt: at,
  };

  it("ties finishedAt and error to the status", () => {
    expect(AgentRunSchema.safeParse(run).success).toBe(true);
    expect(AgentRunSchema.safeParse({ ...run, finishedAt: undefined }).success).toBe(false);
    expect(AgentRunSchema.safeParse({ ...run, status: "failed" }).success).toBe(false);
    expect(AgentRunSchema.safeParse({ ...run, status: "failed", error: "Throttled" }).success).toBe(true);
  });
});

describe("helpers", () => {
  it("maps rubric scores onto 0–100", () => {
    const all = (score: number) => ({
      title: score,
      bullets: score,
      description: score,
      keywords: score,
      factual_accuracy: score,
      compliance: score,
    });
    expect(overallScore(all(1))).toBe(0);
    expect(overallScore(all(5))).toBe(100);
    expect(overallScore(all(3))).toBe(50);
  });

  it("detects agent-produced work", () => {
    expect(isAgentProduced({ type: "agent", agent: "listing_writer", agentRunId: "run_1" })).toBe(true);
    expect(isAgentProduced({ type: "member", memberId: "mem_1" })).toBe(false);
  });
});
