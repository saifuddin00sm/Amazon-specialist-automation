import { z } from "zod";

/** A workspace groups one or more Amazon seller accounts under one team. */
export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const MarketplaceSchema = z.enum(["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"]);
export type Marketplace = z.infer<typeof MarketplaceSchema>;

/** An Amazon Seller Central account connected to a workspace. */
export const SellerAccountSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  marketplace: MarketplaceSchema,
});
export type SellerAccount = z.infer<typeof SellerAccountSchema>;
