import { z } from "zod";
import { ActorSchema, EntityRefSchema, IdSchema, IsoDateTimeSchema } from "./common";

export const AuditActionSchema = z.enum([
  "agent_run.started",
  "agent_run.finished",
  "proposal.created",
  "proposal.edited",
  "proposal.snoozed",
  "proposal.approved",
  "proposal.rejected",
  "proposal.applied",
  "proposal.failed",
  "listing_version.published",
  "member.invited",
  "seller_account.connected",
  "settings.updated",
  "member.updated",
  "member.removed",
  "agents.paused",
  "agents.resumed",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** Append-only record of who did what. */
export const AuditEventSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  sellerAccountId: IdSchema.optional(),
  at: IsoDateTimeSchema,
  actor: ActorSchema,
  action: AuditActionSchema,
  entity: EntityRefSchema,
  metadata: z.record(z.string(), z.json()),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
