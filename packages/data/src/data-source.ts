import type { SellerAccount, Workspace } from "@app/core";

/** The only way the UI reads or writes data. Implementations: mock (Phase 1), Supabase/Amazon (later). */
export interface DataSource {
  listWorkspaces(): Promise<Workspace[]>;
  listSellerAccounts(workspaceId?: string): Promise<SellerAccount[]>;
}
