import { z } from "zod";

/**
 * How much an agent may do without a human.
 * L0: suggest only · L1: draft Proposals · L2: auto-apply within Guardrails · L3: fully autonomous.
 */
export const AutonomyLevelSchema = z.enum(["L0", "L1", "L2", "L3"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

/** Whether agents may file proposals at this level. L0 only shows what it would do. */
export function filesProposals(level: AutonomyLevel): boolean {
  return level !== "L0";
}

/**
 * Whether the system approves an agent's proposal without a member. L2 needs a low-risk change
 * where every guardrail passes; L3 needs only that nothing blocks. L0 and L1 never auto-approve.
 */
export function autoApproves(
  level: AutonomyLevel,
  { risk, checks }: { risk: "low" | "medium" | "high"; checks: readonly { status: "pass" | "warn" | "fail" }[] },
): boolean {
  if (level === "L2") return risk === "low" && checks.every((check) => check.status === "pass");
  if (level === "L3") return checks.every((check) => check.status !== "fail");
  return false;
}
