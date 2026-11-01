import { z } from "zod";
import { AutonomyLevelSchema } from "./autonomy";
import { CurrencySchema, IdSchema, IsoDateTimeSchema, MarketplaceSchema } from "./common";

/** A merchant runs its own seller accounts; an agency runs its clients' accounts. */
export const WorkspaceKindSchema = z.enum(["merchant", "agency"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: WorkspaceKindSchema,
  createdAt: IsoDateTimeSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const MemberRoleSchema = z.enum(["owner", "specialist", "client_approver", "viewer"]);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const MemberSchema = z
  .object({
    id: IdSchema,
    workspaceId: IdSchema,
    name: z.string().min(1),
    email: z.email(),
    role: MemberRoleSchema,
    /** Accounts this member is limited to. Empty means every account in the workspace. */
    sellerAccountIds: z.array(IdSchema),
    createdAt: IsoDateTimeSchema,
  })
  .refine((member) => member.role !== "client_approver" || member.sellerAccountIds.length > 0, {
    message: "A client_approver must be scoped to at least one seller account",
    path: ["sellerAccountIds"],
  });
export type Member = z.infer<typeof MemberSchema>;

/** An Amazon Seller Central account connected to a workspace. */
export const SellerAccountSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string().min(1),
  /** Amazon merchant token. */
  sellerId: z.string().regex(/^A[0-9A-Z]{12,13}$/),
  marketplace: MarketplaceSchema,
  currency: CurrencySchema,
  autonomyLevel: AutonomyLevelSchema,
  /** Advertising cost of sales the account aims for, as a fraction (0.3 = 30%). */
  targetAcos: z.number().positive().max(1),
  connectedAt: IsoDateTimeSchema,
});
export type SellerAccount = z.infer<typeof SellerAccountSchema>;
