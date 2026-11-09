/**
 * Connects a self-authorized seller account to a workspace and imports its catalog, the same way the
 * nightly sync does:
 *
 *   pnpm amazon:connect-seller --workspace ws_0001 [--name "Test seller"] [--marketplace US]
 *
 * Reads packages/workflows/.env.local (see .env.example). The refresh token is sealed into Supabase;
 * nightly syncs pick the account up from there. Only reads Amazon; changes nothing on it.
 */
import { amazonEnvironment, createRefreshTokenVault, encryptionKeyFromEnv } from "@app/amazon";
import { MarketplaceSchema } from "@app/core";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { syncSellerCatalog } from "../src/catalog-sync";
import { workflowDepsFromEnv } from "../src/deps";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch {
  // No .env.local; the environment may still have the variables.
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    name: { type: "string", default: "Test seller" },
    marketplace: { type: "string", default: "US" },
  },
});
const { AMAZON_SELLER_ID: sellerId, AMAZON_SELLER_REFRESH_TOKEN: refreshToken } = process.env;
if (!values.workspace) fail("Name the workspace to connect the seller to: --workspace <id>.");
if (!sellerId || !refreshToken) fail("Set AMAZON_SELLER_ID and AMAZON_SELLER_REFRESH_TOKEN in packages/workflows/.env.local.");
const marketplace = MarketplaceSchema.safeParse(values.marketplace);
if (!marketplace.success) fail(`--marketplace must be one of ${MarketplaceSchema.options.join(", ")}.`);

// Writes go to Supabase whatever the web app's DATA_SOURCE: the mock lives in the web app's memory.
const deps = workflowDepsFromEnv({ ...process.env, DATA_SOURCE: "supabase" });
const workspace = await deps.dataSource.getWorkspace(values.workspace);
if (!workspace) fail(`There is no workspace ${values.workspace}.`);

// Sealed with AMAZON_TOKEN_ENCRYPTION_KEY and bound to the seller; the web app needs the same key.
await createRefreshTokenVault(deps.authorizations, encryptionKeyFromEnv()).save(sellerId, refreshToken);

const existing = (await deps.dataSource.listSellerAccounts(workspace.id)).find(
  (account) => account.sellerId === sellerId && account.marketplace === marketplace.data,
);
let account = existing;
if (!account) {
  // With the secret key, the acting member is the workspace's owner.
  const owner = await deps.dataSource.getActingMember(workspace.id);
  if (!owner) fail(`${workspace.name} has no owner to connect the account.`);
  account = await deps.dataSource.connectSellerAccount({ workspaceId: workspace.id, memberId: owner.id, name: values.name, marketplace: marketplace.data, sellerId });
}

const environment = amazonEnvironment();
console.log(`${existing ? "Found" : "Connected"} ${account.name} (${account.marketplace}) in ${workspace.name}.`);
if (environment === "sandbox") {
  console.warn("AMAZON_ENV isn't production: the SP-API sandbox only answers Amazon's canned requests, so expect this sync to fail.");
}
console.log(`Importing its catalog from the ${environment} SP-API:`);
const summary = await syncSellerCatalog(deps, account.id, async (name, fn) => {
  console.log(`  ${name}`);
  return fn();
});

console.log(
  `Done: ${summary.created} new, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.newVersions} new live versions, ` +
    `${summary.deactivated} deactivated, over ${summary.pages} page(s).`,
);
for (const [reason, count] of Object.entries(summary.skipped)) console.log(`  ${count} × ${reason}`);
console.log(`Open /listings and pick "${account.name}" in the top bar.`);
