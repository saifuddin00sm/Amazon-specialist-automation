import { describe, expect, it } from "vitest";
import { mockDataSource } from "./mock-data-source";

describe("mockDataSource", () => {
  it("lists workspaces", async () => {
    const workspaces = await mockDataSource.listWorkspaces();
    expect(workspaces.length).toBeGreaterThan(0);
  });

  it("filters seller accounts by workspace", async () => {
    const [first] = await mockDataSource.listWorkspaces();
    const accounts = await mockDataSource.listSellerAccounts(first!.id);
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((account) => account.workspaceId === first!.id)).toBe(true);
  });

  it("gives every workspace at least one seller account", async () => {
    const workspaces = await mockDataSource.listWorkspaces();
    for (const workspace of workspaces) {
      expect(await mockDataSource.listSellerAccounts(workspace.id)).not.toHaveLength(0);
    }
  });
});
