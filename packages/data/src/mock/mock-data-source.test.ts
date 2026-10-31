import { describe, expect, it } from "vitest";
import { generateMockDataset } from "./generate";
import { createMockDataSource } from "./mock-data-source";

const dataset = generateMockDataset();
const dataSource = createMockDataSource(dataset);
const [merchant, agency] = dataset.workspaces;
const merchantAccount = dataset.sellerAccounts.find((account) => account.workspaceId === merchant?.id);

describe("mockDataSource", () => {
  it("lists workspaces and their seller accounts", async () => {
    expect(await dataSource.listWorkspaces()).toHaveLength(2);
    expect(await dataSource.listSellerAccounts(agency?.id)).toHaveLength(5);
    expect(await dataSource.listSellerAccounts()).toHaveLength(6);
  });

  it("returns undefined for unknown ids", async () => {
    expect(await dataSource.getWorkspace("nope")).toBeUndefined();
    expect(await dataSource.getProduct("nope")).toBeUndefined();
    expect(await dataSource.getProposal("nope")).toBeUndefined();
  });

  it("filters products by account, category and status", async () => {
    const all = await dataSource.listProducts({ sellerAccountId: merchantAccount!.id });
    const category = all[0]!.category;
    const inCategory = await dataSource.listProducts({ sellerAccountId: merchantAccount!.id, category, status: "active" });
    expect(inCategory.length).toBeGreaterThan(0);
    expect(inCategory.every((product) => product.category === category && product.status === "active")).toBe(true);
  });

  it("returns listing versions newest first", async () => {
    const product = dataset.products.find((candidate) =>
      dataset.listingVersions.filter((version) => version.productId === candidate.id).length > 1,
    );
    const versions = await dataSource.listListingVersions(product!.id);
    expect(versions.map((version) => version.version)).toEqual(
      versions.map((version) => version.version).sort((a, b) => b - a),
    );
  });

  it("filters proposals by status", async () => {
    const pending = await dataSource.listProposals({ workspaceId: agency!.id, status: "pending_approval" });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((proposal) => proposal.status === "pending_approval" && proposal.workspaceId === agency!.id)).toBe(
      true,
    );
  });

  it("returns typed metrics for a date range, oldest first", async () => {
    const rows = await dataSource.listMetricsDaily({
      sellerAccountId: merchantAccount!.id,
      entityType: "campaign",
      range: { from: "2026-10-01", to: "2026-10-07" },
    });
    const campaigns = await dataSource.listCampaigns(merchantAccount!.id);
    expect(rows).toHaveLength(campaigns.length * 7);
    expect(rows[0]!.date).toBe("2026-10-01");
    expect(rows.at(-1)!.date).toBe("2026-10-07");
    expect(rows.every((row) => row.entityType === "campaign" && row.spend >= 0)).toBe(true);
  });

  it("limits activity feeds", async () => {
    expect(await dataSource.listAuditEvents({ workspaceId: merchant!.id, limit: 10 })).toHaveLength(10);
    expect(await dataSource.listAgentRuns({ workspaceId: merchant!.id, limit: 3 })).toHaveLength(3);
  });

  it("does not let callers mutate the underlying data", async () => {
    const [workspace] = await dataSource.listWorkspaces();
    expect(() => {
      (workspace as { name: string }).name = "Changed";
    }).toThrow(TypeError);
  });
});
