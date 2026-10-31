import type { AutonomyLevel, Currency, Marketplace, Member, MemberRole, SellerAccount, Workspace } from "@app/core";
import { DAY_MS, slugify, type GeneratorContext } from "../context";
import { AGENCY_NAMES, BRAND_PREFIXES, BRAND_SUFFIXES, CATEGORIES, type CategoryKey, type CategoryVocabulary } from "../vocabulary";

export const MERCHANT_SKU_COUNT = 120;
const MERCHANT_CATEGORIES: CategoryKey[] = ["kitchen", "outdoors", "pets"];

const AGENCY_CLIENTS: { marketplace: Marketplace; currency: Currency; autonomyLevel: AutonomyLevel }[] = [
  { marketplace: "US", currency: "USD", autonomyLevel: "L1" },
  { marketplace: "US", currency: "USD", autonomyLevel: "L2" },
  { marketplace: "CA", currency: "CAD", autonomyLevel: "L1" },
  { marketplace: "UK", currency: "GBP", autonomyLevel: "L0" },
  { marketplace: "DE", currency: "EUR", autonomyLevel: "L1" },
];

/** What to generate for one seller account. */
export type AccountPlan = {
  account: SellerAccount;
  brand: string;
  categories: { vocabulary: CategoryVocabulary; productCount: number }[];
};

export type Organizations = {
  workspaces: Workspace[];
  members: Member[];
  sellerAccounts: SellerAccount[];
  plans: AccountPlan[];
};

export function generateOrganizations(ctx: GeneratorContext): Organizations {
  const { rng, clock, nextId } = ctx;
  const usedBrands = new Set<string>();

  const brandName = () => {
    let brand: string;
    do {
      brand = `${rng.pick(BRAND_PREFIXES)}${rng.pick(BRAND_SUFFIXES)}`;
    } while (usedBrands.has(brand));
    usedBrands.add(brand);
    return brand;
  };

  const sellerId = () => `A${rng.faker.string.alphanumeric({ length: 13, casing: "upper" })}`;

  const workspaces: Workspace[] = [];
  const members: Member[] = [];
  const plans: AccountPlan[] = [];

  const addMember = (
    workspace: Workspace,
    role: MemberRole,
    emailDomain: string,
    sellerAccountIds: string[] = [],
  ): Member => {
    const firstName = rng.faker.person.firstName();
    const lastName = rng.faker.person.lastName();
    const joined = Date.parse(workspace.createdAt) + rng.int(0, 60) * DAY_MS;
    const member: Member = {
      id: nextId("mem"),
      workspaceId: workspace.id,
      name: `${firstName} ${lastName}`,
      email: rng.faker.internet.email({ firstName, lastName, provider: emailDomain }).toLowerCase(),
      role,
      sellerAccountIds,
      createdAt: clock.iso(role === "owner" ? Date.parse(workspace.createdAt) : joined),
    };
    members.push(member);
    return member;
  };

  // Merchant: one brand, one US account, ~120 SKUs over three categories.
  const merchantBrand = brandName();
  const merchant: Workspace = {
    id: nextId("ws"),
    name: `${merchantBrand} Co.`,
    kind: "merchant",
    createdAt: clock.iso(clock.daysAgo(rng.int(500, 700), 15)),
  };
  workspaces.push(merchant);
  const merchantDomain = `${slugify(merchantBrand)}.example.com`;
  addMember(merchant, "owner", merchantDomain);
  addMember(merchant, "specialist", merchantDomain);
  addMember(merchant, "viewer", merchantDomain);

  const first = rng.int(30, 50);
  const second = rng.int(30, MERCHANT_SKU_COUNT - first - 30);
  const merchantCounts = [first, second, MERCHANT_SKU_COUNT - first - second];
  plans.push({
    account: {
      id: nextId("sa"),
      workspaceId: merchant.id,
      name: `${merchantBrand} US`,
      sellerId: sellerId(),
      marketplace: "US",
      currency: "USD",
      autonomyLevel: "L1",
      connectedAt: clock.iso(Date.parse(merchant.createdAt) + rng.int(1, 10) * DAY_MS),
    },
    brand: merchantBrand,
    categories: MERCHANT_CATEGORIES.map((key, i) => ({
      vocabulary: CATEGORIES[key],
      productCount: merchantCounts[i] ?? 0,
    })),
  });

  // Agency: five client brands, each its own seller account.
  const agencyName = rng.pick(AGENCY_NAMES);
  const agency: Workspace = {
    id: nextId("ws"),
    name: agencyName,
    kind: "agency",
    createdAt: clock.iso(clock.daysAgo(rng.int(400, 600), 15)),
  };
  workspaces.push(agency);
  const agencyDomain = `${slugify(agencyName)}.example.com`;
  addMember(agency, "owner", agencyDomain);
  for (let i = 0; i < 3; i++) addMember(agency, "specialist", agencyDomain);
  addMember(agency, "viewer", agencyDomain);

  const categoryKeys = Object.keys(CATEGORIES) as CategoryKey[];
  for (const client of AGENCY_CLIENTS) {
    const brand = brandName();
    const account: SellerAccount = {
      id: nextId("sa"),
      workspaceId: agency.id,
      name: `${brand} ${client.marketplace}`,
      sellerId: sellerId(),
      marketplace: client.marketplace,
      currency: client.currency,
      autonomyLevel: client.autonomyLevel,
      connectedAt: clock.iso(Date.parse(agency.createdAt) + rng.int(5, 200) * DAY_MS),
    };
    const total = rng.int(18, 36);
    const keys = rng.pickMany(categoryKeys, 1, 2);
    const split = keys.length === 1 ? [total] : [Math.ceil(total / 2), Math.floor(total / 2)];
    plans.push({
      account,
      brand,
      categories: keys.map((key, i) => ({ vocabulary: CATEGORIES[key], productCount: split[i] ?? 0 })),
    });
    addMember(agency, "client_approver", `${slugify(brand)}.example.com`, [account.id]);
  }

  return { workspaces, members, sellerAccounts: plans.map((plan) => plan.account), plans };
}
