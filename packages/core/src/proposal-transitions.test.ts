import { describe, expect, it } from "vitest";
import { ProposalStatusSchema } from "./proposal";
import { PROPOSAL_TRANSITIONS, allowedStatusChanges, canTransition, transitionRefusal, type ProposalTransition } from "./proposal-transitions";

const transitions = Object.keys(PROPOSAL_TRANSITIONS) as ProposalTransition[];

describe("proposal state machine", () => {
  it("decides only pending proposals and publishes only approved ones", () => {
    const allowed = (transition: ProposalTransition) => ProposalStatusSchema.options.filter((status) => canTransition(status, transition));
    expect(allowed("approve")).toEqual(["pending_approval"]);
    expect(allowed("reject")).toEqual(["pending_approval"]);
    expect(allowed("snooze")).toEqual(["pending_approval"]);
    expect(allowed("publish")).toEqual(["approved"]);
    expect(allowed("fail")).toEqual(["approved"]);
  });

  it("never leaves a final status", () => {
    for (const status of ["rejected", "applied", "failed", "superseded"] as const) {
      expect(transitions.filter((transition) => canTransition(status, transition))).toEqual([]);
    }
  });

  it("lists every status change once", () => {
    expect(allowedStatusChanges()).toEqual([
      ["pending_approval", "approved"],
      ["pending_approval", "rejected"],
      ["pending_approval", "pending_approval"],
      ["pending_approval", "superseded"],
      ["approved", "applied"],
      ["approved", "failed"],
    ]);
  });

  it("explains a refused transition in plain words", () => {
    expect(transitionRefusal("approved", "publish")).toBeUndefined();
    expect(transitionRefusal("pending_approval", "publish")).toBe(
      "Only approved proposals can be published. This one is still pending approval.",
    );
    expect(transitionRefusal("rejected", "publish")).toBe("Only approved proposals can be published. This one was rejected.");
    expect(transitionRefusal("applied", "publish")).toBe(
      "Only approved proposals can be published. This one was already published to Amazon.",
    );
    expect(transitionRefusal("approved", "reject")).toBe("Only pending proposals can be rejected. This one is already approved.");
  });
});
