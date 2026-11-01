import type { MockDataset } from "../mock/generate";
import type { TablesInsert } from "./database.types";
import {
  adGroupToRow,
  agentRunToRow,
  auditEventToRow,
  campaignToRow,
  listingVersionToRow,
  memberToRow,
  metricsDailyToRow,
  productFactsToRow,
  productToRow,
  proposalToRow,
  reviewToRow,
  sellerAccountToRow,
  targetToRow,
  workspaceToRow,
  type Scope,
} from "./rows";
import type { AppSupabaseClient } from "./supabase-data-source";

/** Rows for every table, in an order that satisfies the foreign keys. */
export type SeedRows = {
  workspaces: TablesInsert<"workspaces">[];
  seller_accounts: TablesInsert<"seller_accounts">[];
  members: TablesInsert<"members">[];
  products: TablesInsert<"products">[];
  product_facts: TablesInsert<"product_facts">[];
  listing_versions: TablesInsert<"listing_versions">[];
  reviews: TablesInsert<"reviews">[];
  campaigns: TablesInsert<"campaigns">[];
  ad_groups: TablesInsert<"ad_groups">[];
  targets: TablesInsert<"targets">[];
  metrics_daily: TablesInsert<"metrics_daily">[];
  proposals: TablesInsert<"proposals">[];
  agent_runs: TablesInsert<"agent_runs">[];
  audit_events: Omit<TablesInsert<"audit_events">, "seq">[];
};

export type SeedTable = keyof SeedRows;

/** The tables the app writes to; tests restore them between write tests. */
export const MUTABLE_TABLES = ["listing_versions", "reviews", "proposals", "agent_runs", "audit_events"] as const satisfies SeedTable[];

const BATCH_SIZE = 1000;

export function datasetRows(dataset: MockDataset): SeedRows {
  const lookup = <T>(map: Map<string, T>, id: string, what: string): T => {
    const value = map.get(id);
    if (value === undefined) throw new Error(`Seed data refers to unknown ${what} ${id}`);
    return value;
  };
  const accountScope = new Map<string, Scope>(
    dataset.sellerAccounts.map((account) => [account.id, { workspaceId: account.workspaceId, sellerAccountId: account.id }]),
  );
  const productScope = new Map(dataset.products.map((product) => [product.id, lookup(accountScope, product.sellerAccountId, "seller account")]));
  const versionScope = new Map(dataset.listingVersions.map((version) => [version.id, lookup(productScope, version.productId, "product")]));
  const campaignScope = new Map(dataset.campaigns.map((campaign) => [campaign.id, lookup(accountScope, campaign.sellerAccountId, "seller account")]));
  const adGroupScope = new Map(dataset.adGroups.map((adGroup) => [adGroup.id, lookup(campaignScope, adGroup.campaignId, "campaign")]));
  const workspaceOf = (sellerAccountId: string) => lookup(accountScope, sellerAccountId, "seller account").workspaceId;

  return {
    workspaces: dataset.workspaces.map(workspaceToRow),
    seller_accounts: dataset.sellerAccounts.map(sellerAccountToRow),
    members: dataset.members.map(memberToRow),
    products: dataset.products.map((product) => productToRow(product, workspaceOf(product.sellerAccountId))),
    product_facts: dataset.productFacts.map((facts) => productFactsToRow(facts, lookup(productScope, facts.productId, "product"))),
    listing_versions: dataset.listingVersions.map((version) => listingVersionToRow(version, lookup(productScope, version.productId, "product"))),
    reviews: dataset.reviews.map((review) => reviewToRow(review, lookup(versionScope, review.listingVersionId, "listing version"))),
    campaigns: dataset.campaigns.map((campaign) => campaignToRow(campaign, workspaceOf(campaign.sellerAccountId))),
    ad_groups: dataset.adGroups.map((adGroup) => adGroupToRow(adGroup, lookup(campaignScope, adGroup.campaignId, "campaign"))),
    targets: dataset.targets.map((target) => targetToRow(target, lookup(adGroupScope, target.adGroupId, "ad group"))),
    metrics_daily: dataset.metricsDaily.map((row) => metricsDailyToRow(row, workspaceOf(row.sellerAccountId))),
    proposals: dataset.proposals.map(proposalToRow),
    agent_runs: dataset.agentRuns.map(agentRunToRow),
    // The dataset lists events newest first; insert oldest first so `seq` keeps their order.
    audit_events: [...dataset.auditEvents].reverse().map(auditEventToRow),
  };
}

async function insertAll(admin: AppSupabaseClient, table: SeedTable, rows: SeedRows[SeedTable]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    // Each table's rows match its insert type; the union of tables is too wide for the client's overloads.
    const { error } = await admin.from(table).insert(rows.slice(i, i + BATCH_SIZE) as never);
    if (error) throw new Error(`Seeding ${table} failed: ${error.message}`);
  }
}

/**
 * Replaces everything in the database with the dataset, then gives every member an auth user so they
 * can sign in with a magic link (users are linked to members by email). Needs the secret key.
 */
export async function seedDatabase(
  admin: AppSupabaseClient,
  dataset: MockDataset,
  { onProgress = () => {} }: { onProgress?: (message: string) => void } = {},
): Promise<void> {
  const rows = datasetRows(dataset);

  // Every table hangs off a workspace, so this clears them all.
  const { error } = await admin.from("workspaces").delete().neq("id", "");
  if (error) throw new Error(`Clearing the database failed: ${error.message}`);

  for (const table of Object.keys(rows) as SeedTable[]) {
    onProgress(`${table}: ${rows[table].length} rows`);
    await insertAll(admin, table, rows[table]);
  }

  const emails = [...new Set(dataset.members.map((member) => member.email.toLowerCase()))];
  onProgress(`auth users: ${emails.length}`);
  for (const email of emails) {
    const { error: userError } = await admin.auth.admin.createUser({ email, email_confirm: true });
    // A user left from an earlier seed was linked when its member row was inserted again.
    if (userError && userError.code !== "email_exists") throw new Error(`Creating the user for ${email} failed: ${userError.message}`);
  }
}

/** Puts the tables the app writes to back to the dataset's state. Leaves the rest alone. */
export async function resetMutableTables(admin: AppSupabaseClient, dataset: MockDataset): Promise<void> {
  const rows = datasetRows(dataset);
  const clear = async (table: (typeof MUTABLE_TABLES)[number]) => {
    const { error } = await admin.from(table).delete().neq("id", "");
    if (error) throw new Error(`Clearing ${table} failed: ${error.message}`);
  };
  // Proposals point at reviews, and reviews at listing versions.
  for (const table of ["proposals", "agent_runs", "audit_events", "reviews", "listing_versions"] as const) await clear(table);
  for (const table of MUTABLE_TABLES) await insertAll(admin, table, rows[table]);
  // Workspaces can't be cleared without cascading to everything, so only their branding goes back.
  for (const workspace of rows.workspaces) {
    const { error } = await admin.from("workspaces").update({ branding: workspace.branding ?? null }).eq("id", workspace.id);
    if (error) throw new Error(`Restoring branding of ${workspace.id} failed: ${error.message}`);
  }
}
