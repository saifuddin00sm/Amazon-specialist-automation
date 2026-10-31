import { z } from "zod";

/**
 * How much an agent may do without a human.
 * L0: suggest only · L1: draft Proposals · L2: auto-apply within Guardrails · L3: fully autonomous.
 */
export const AutonomyLevelSchema = z.enum(["L0", "L1", "L2", "L3"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;
