import type {
  AdGroup,
  AgentRun,
  AuditEvent,
  Campaign,
  ListingVersion,
  Member,
  MetricsDaily,
  Product,
  ProductFacts,
  Proposal,
  Review,
  SellerAccount,
  Target,
  Workspace,
} from "@app/core";
import { createContext } from "../context";
import { generateActivity } from "./activity";
import { generateAdvertising } from "./advertising";
import { generateCatalog } from "./catalog";
import { generateMetrics } from "./metrics";
import { generateOrganizations } from "./organizations";

export const MOCK_SEED = 20261030;
/** Last day with metrics. Fixed so the dataset never depends on the real clock. */
export const MOCK_ANCHOR_DATE = "2026-10-30";
export const MOCK_METRIC_DAYS = 90;

export type MockDataset = {
  workspaces: Workspace[];
  members: Member[];
  sellerAccounts: SellerAccount[];
  products: Product[];
  productFacts: ProductFacts[];
  listingVersions: ListingVersion[];
  reviews: Review[];
  proposals: Proposal[];
  campaigns: Campaign[];
  adGroups: AdGroup[];
  targets: Target[];
  metricsDaily: MetricsDaily[];
  agentRuns: AgentRun[];
  auditEvents: AuditEvent[];
};

export type GenerateOptions = {
  seed?: number;
  /** YYYY-MM-DD; "now" is 18:00 UTC on this day. */
  anchorDate?: string;
  days?: number;
};

/**
 * One merchant (~120 SKUs, 3 categories) and one agency (5 client accounts),
 * with 90 days of metrics. Same options, same dataset, every time.
 */
export function generateMockDataset({
  seed = MOCK_SEED,
  anchorDate = MOCK_ANCHOR_DATE,
  days = MOCK_METRIC_DAYS,
}: GenerateOptions = {}): MockDataset {
  const ctx = createContext(seed, anchorDate, days);
  const orgs = generateOrganizations(ctx);
  const catalog = generateCatalog(ctx, orgs.plans, orgs.members);
  const ads = generateAdvertising(ctx, orgs.plans, catalog, orgs.workspaces);
  const metricsDaily = generateMetrics(ctx, catalog, ads);
  // Runs last: applied proposals update listings, bids, budgets and targets in place.
  const activity = generateActivity(ctx, orgs, catalog, ads, metricsDaily);

  return {
    workspaces: orgs.workspaces,
    members: orgs.members,
    sellerAccounts: orgs.sellerAccounts,
    products: catalog.products,
    productFacts: catalog.productFacts,
    listingVersions: catalog.listingVersions,
    reviews: activity.reviews,
    proposals: activity.proposals,
    campaigns: ads.campaigns,
    adGroups: ads.adGroups,
    targets: ads.targets,
    metricsDaily,
    agentRuns: activity.agentRuns,
    auditEvents: activity.auditEvents,
  };
}
