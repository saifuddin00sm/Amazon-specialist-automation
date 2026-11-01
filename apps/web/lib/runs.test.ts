import type { AgentRunStep } from "@app/core";
import { SUGGESTIONS_ONLY_TITLE } from "@app/data";
import { describe, expect, it } from "vitest";
import { runOutcome } from "./runs";

const last = (title: string): AgentRunStep[] => [
  {
    id: "s1",
    kind: "awaiting_approval",
    title,
    text: "",
    startedAt: "2026-10-31T09:00:00.000Z",
    finishedAt: "2026-10-31T09:00:01.000Z",
  },
];

describe("runOutcome", () => {
  it("tells how a run ended", () => {
    expect(runOutcome({ status: "cancelled", steps: last("Awaiting approval") }, undefined)).toBe("cancelled");
    expect(runOutcome({ status: "succeeded" }, { status: "pending_approval" })).toBe("pending");
    expect(runOutcome({ status: "succeeded" }, { status: "approved" })).toBe("auto_approved");
    expect(runOutcome({ status: "succeeded", steps: last(SUGGESTIONS_ONLY_TITLE) }, undefined)).toBe("suggested");
    expect(runOutcome({ status: "succeeded", steps: last("No proposal needed") }, undefined)).toBe("none");
  });
});
