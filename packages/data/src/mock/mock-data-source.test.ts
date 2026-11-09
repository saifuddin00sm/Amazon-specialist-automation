import { describe, expect, it } from "vitest";
import { describeDataSourceContract } from "../data-source.contract";
import { generateMockDataset } from "./generate";
import { createMockDataSource } from "./mock-data-source";

const dataset = generateMockDataset();
const dataSource = createMockDataSource(dataset);

// Writes are copy-on-write, so every write test gets a fresh source over the same frozen dataset.
describeDataSourceContract("mock", async () => ({
  dataset,
  reader: () => dataSource,
  writer: async (now) => createMockDataSource(dataset, { now }),
}));

describe("mockDataSource", () => {
  it("does not let callers mutate the underlying data", async () => {
    const [workspace] = await dataSource.listWorkspaces();
    expect(() => {
      (workspace as { name: string }).name = "Changed";
    }).toThrow(TypeError);
  });

  it("leaves the shared dataset untouched when a source writes", async () => {
    const proposal = dataset.proposals.find((candidate) => candidate.status === "pending_approval" && candidate.type === "bid_change")!;
    const owner = dataset.members.find((member) => member.workspaceId === proposal.workspaceId && member.role === "owner")!;
    const source = createMockDataSource(dataset, { now: () => new Date("2026-10-31T09:00:00.000Z") });
    await source.approveProposal({ proposalId: proposal.id, memberId: owner.id });

    expect(await dataSource.getProposal(proposal.id)).toEqual(proposal);
    expect(await createMockDataSource(dataset).getProposal(proposal.id)).toEqual(proposal);
  });

  it("keeps the catalog sync's writes from members", async () => {
    const owner = dataset.members.find((member) => member.role === "owner")!;
    const account = dataset.sellerAccounts.find((candidate) => candidate.workspaceId === owner.workspaceId)!;
    const asOwner = createMockDataSource(dataset).asMember(owner.id)!;
    const syncedAt = "2026-10-31T03:00:00.000Z";
    await expect(asOwner.importCatalogListings({ sellerAccountId: account.id, syncedAt, listings: [] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      asOwner.finishCatalogSync({ sellerAccountId: account.id, syncedAt, counts: { created: 0, updated: 0, unchanged: 0, newVersions: 0 }, skipped: {} }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
