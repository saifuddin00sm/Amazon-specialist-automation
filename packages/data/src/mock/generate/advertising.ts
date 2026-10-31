import type { AdGroup, BiddingStrategy, Campaign, CampaignType, Target, Workspace } from "@app/core";
import { groupBy, round2, type GeneratorContext } from "../context";
import { NEGATIVE_MODIFIERS, keywordIdeas } from "../vocabulary";
import { randomAsin, type Catalog } from "./catalog";
import type { AccountPlan } from "./organizations";

export type Advertising = {
  campaigns: Campaign[];
  adGroups: AdGroup[];
  targets: Target[];
};

const AUTO_TYPES = ["close_match", "loose_match", "substitutes", "complements"] as const;

export function generateAdvertising(
  ctx: GeneratorContext,
  plans: AccountPlan[],
  catalog: Catalog,
  workspaces: Workspace[],
): Advertising {
  const { rng, clock, nextId } = ctx;
  const campaigns: Campaign[] = [];
  const adGroups: AdGroup[] = [];
  const targets: Target[] = [];

  const bid = (base: number) => Math.max(0.2, round2(base * rng.float(0.8, 1.3)));
  const targetState = () => (rng.chance(0.05) ? ("paused" as const) : ("enabled" as const));

  for (const plan of plans) {
    const sellerAccountId = plan.account.id;
    const accountProducts = catalog.products.filter(
      (product) => product.sellerAccountId === sellerAccountId && product.status === "active",
    );

    const addCampaign = (name: string, type: CampaignType, targetingType: "auto" | "manual", biddingStrategy: BiddingStrategy) => {
      const campaign: Campaign = {
        id: nextId("cmp"),
        sellerAccountId,
        name,
        type,
        targetingType,
        state: rng.chance(0.12) ? "paused" : "enabled",
        // Set from spend once metrics exist.
        dailyBudget: 1,
        biddingStrategy,
        startDate: clock.isoDate(clock.daysAgo(rng.int(100, 400))),
      };
      campaigns.push(campaign);
      return campaign;
    };

    const addAdGroup = (campaign: Campaign, name: string, productIds: string[]) => {
      const adGroup: AdGroup = {
        id: nextId("ag"),
        campaignId: campaign.id,
        name,
        state: "enabled",
        defaultBid: round2(rng.float(0.45, 1.6)),
        productIds,
      };
      adGroups.push(adGroup);
      return adGroup;
    };

    for (const { vocabulary } of plan.categories) {
      const products = accountProducts.filter((product) => product.category === vocabulary.name);
      if (products.length === 0) continue;
      const productIds = products.map((product) => product.id);
      const prefix = `${plan.brand} | ${vocabulary.short}`;

      // Auto campaign: Amazon picks the queries.
      const auto = addCampaign(`${prefix} | SP Auto`, "sponsored_products", "auto", "dynamic_down_only");
      const autoGroup = addAdGroup(auto, `All ${vocabulary.short}`, productIds);
      for (const autoType of AUTO_TYPES) {
        targets.push({
          id: nextId("tgt"),
          adGroupId: autoGroup.id,
          state: targetState(),
          negative: false,
          bid: bid(autoGroup.defaultBid),
          kind: "auto",
          autoType,
        });
      }

      // Manual keyword campaign: one ad group per product type.
      const manual = addCampaign(
        `${prefix} | SP Keywords`,
        "sponsored_products",
        "manual",
        rng.pick(["fixed", "dynamic_down_only"] as const),
      );
      const byNoun = groupBy(products, (product) => catalog.profiles.get(product.id)?.noun ?? product.category);
      for (const [noun, group] of byNoun) {
        const adGroup = addAdGroup(manual, noun, group.map((product) => product.id));
        const adjective = catalog.profiles.get(group[0]?.id ?? "")?.adjective ?? "";
        for (const keyword of rng.pickMany(keywordIdeas(vocabulary, noun, adjective), 3, 5)) {
          for (const matchType of ["exact", rng.pick(["phrase", "broad"] as const)] as const) {
            targets.push({
              id: nextId("tgt"),
              adGroupId: adGroup.id,
              state: targetState(),
              negative: false,
              bid: bid(adGroup.defaultBid),
              kind: "keyword",
              keyword,
              matchType,
            });
          }
        }
        for (const modifier of rng.pickMany(NEGATIVE_MODIFIERS, 1, 2)) {
          targets.push({
            id: nextId("tgt"),
            adGroupId: adGroup.id,
            state: "enabled",
            negative: true,
            kind: "keyword",
            keyword: `${noun.toLowerCase()} ${modifier}`,
            matchType: "exact",
          });
        }
      }

      // Product targeting: show up on competitor detail pages.
      if (rng.chance(0.6)) {
        const pat = addCampaign(`${prefix} | SP Competitors`, "sponsored_products", "manual", "fixed");
        const adGroup = addAdGroup(pat, "Competitor ASINs", productIds);
        for (let i = rng.int(4, 8); i > 0; i--) {
          targets.push({
            id: nextId("tgt"),
            adGroupId: adGroup.id,
            state: targetState(),
            negative: false,
            bid: bid(adGroup.defaultBid),
            kind: "product",
            asin: randomAsin(ctx),
          });
        }
      }
    }

    // Merchants defend their own brand terms with Sponsored Brands.
    const workspace = workspaces.find((candidate) => candidate.id === plan.account.workspaceId);
    if (workspace?.kind === "merchant" && accountProducts.length > 0) {
      const sb = addCampaign(`${plan.brand} | Brand | SB`, "sponsored_brands", "manual", "fixed");
      const adGroup = addAdGroup(sb, "Brand defense", accountProducts.slice(0, 5).map((product) => product.id));
      const brand = plan.brand.toLowerCase();
      const nouns = [...new Set(accountProducts.map((product) => catalog.profiles.get(product.id)?.noun))];
      for (const keyword of [brand, ...nouns.slice(0, 2).map((noun) => `${brand} ${noun?.toLowerCase()}`)]) {
        targets.push({
          id: nextId("tgt"),
          adGroupId: adGroup.id,
          state: "enabled",
          negative: false,
          bid: bid(adGroup.defaultBid),
          kind: "keyword",
          keyword,
          matchType: "exact",
        });
      }
    }
  }

  return { campaigns, adGroups, targets };
}
