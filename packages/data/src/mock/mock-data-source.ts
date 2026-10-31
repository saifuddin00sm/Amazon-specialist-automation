import { SellerAccountSchema, WorkspaceSchema } from "@app/core";
import type { DataSource } from "../data-source";
import { sellerAccounts, workspaces } from "./fixtures";

export const mockDataSource: DataSource = {
  async listWorkspaces() {
    return WorkspaceSchema.array().parse(workspaces);
  },
  async listSellerAccounts(workspaceId) {
    const accounts = workspaceId
      ? sellerAccounts.filter((account) => account.workspaceId === workspaceId)
      : sellerAccounts;
    return SellerAccountSchema.array().parse(accounts);
  },
};
