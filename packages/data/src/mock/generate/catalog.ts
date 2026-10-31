import { LISTING_LIMITS, type ListingVersion, type Member, type Product, type ProductFacts } from "@app/core";
import { DAY_MS, round2, truncate, type GeneratorContext } from "../context";
import { keywordIdeas, type CategoryVocabulary } from "../vocabulary";
import type { AccountPlan } from "./organizations";

/** Generator-only details about a product, used to write copy and pick keywords. */
export type ProductProfile = {
  product: Product;
  vocabulary: CategoryVocabulary;
  noun: string;
  adjective: string;
  material: string;
  color: string;
  features: (readonly [string, string])[];
  keywords: string[];
};

export type Catalog = {
  products: Product[];
  productFacts: ProductFacts[];
  listingVersions: ListingVersion[];
  profiles: Map<string, ProductProfile>;
};

type ListingCopy = Pick<ListingVersion, "title" | "bullets" | "description" | "backendKeywords">;

export function generateCatalog(ctx: GeneratorContext, plans: AccountPlan[], members: Member[]): Catalog {
  const { rng, clock, nextId } = ctx;
  const usedAsins = new Set<string>();
  const products: Product[] = [];
  const productFacts: ProductFacts[] = [];
  const listingVersions: ListingVersion[] = [];
  const profiles = new Map<string, ProductProfile>();

  for (const plan of plans) {
    const editors = members.filter(
      (member) =>
        member.workspaceId === plan.account.workspaceId && (member.role === "owner" || member.role === "specialist"),
    );
    let skuNumber = 0;

    for (const { vocabulary, productCount } of plan.categories) {
      for (let i = 0; i < productCount; i++) {
        skuNumber++;
        const noun = rng.pick(vocabulary.nouns);
        const adjective = rng.pick(vocabulary.adjectives);
        const material = rng.pick(vocabulary.materials);
        const color = rng.pick(vocabulary.colors);
        const createdMs = clock.daysAgo(rng.int(120, 900), rng.int(8, 20));
        const [minPrice, maxPrice] = vocabulary.priceRange;

        const product: Product = {
          id: nextId("prd"),
          sellerAccountId: plan.account.id,
          asin: uniqueAsin(ctx, usedAsins),
          sku: `${plan.brand.slice(0, 3).toUpperCase()}-${vocabulary.code}-${String(skuNumber).padStart(4, "0")}`,
          title: "",
          brand: plan.brand,
          category: vocabulary.name,
          price: round2(Math.floor(rng.float(minPrice, maxPrice)) + 0.99),
          status: rng.weighted([
            { weight: 90, value: "active" as const },
            { weight: 6, value: "inactive" as const },
            { weight: 4, value: "suppressed" as const },
          ]),
          createdAt: clock.iso(createdMs),
        };

        const profile: ProductProfile = {
          product,
          vocabulary,
          noun,
          adjective,
          material,
          color,
          features: rng.pickMany(vocabulary.features, 5, 5),
          keywords: [...keywordIdeas(vocabulary, noun, adjective), ...rng.pickMany(vocabulary.keywords, 3, 5)],
        };
        profiles.set(product.id, profile);

        const [minSize, maxSize] = vocabulary.sizeCmRange;
        const [minWeight, maxWeight] = vocabulary.weightGramsRange;
        productFacts.push({
          productId: product.id,
          material,
          color,
          dimensions: {
            lengthCm: round1(rng.float(minSize, maxSize)),
            widthCm: round1(rng.float(minSize / 2, maxSize / 2)),
            heightCm: round1(rng.float(minSize / 3, maxSize / 2)),
          },
          weightGrams: rng.int(minWeight, maxWeight),
          includedComponents: [`1 x ${noun}`, ...rng.pickMany(vocabulary.components, 1, 3)],
          features: profile.features.map(([, sentence]) => sentence),
          prohibitedClaims: rng.pickMany(vocabulary.prohibitedClaims, 1, 3),
          targetKeywords: profile.keywords,
          // Facts get re-verified now and then, so most are a few months old at most.
          updatedAt: clock.iso(Math.max(createdMs + rng.int(1, 60) * DAY_MS, clock.daysAgo(rng.int(3, 200)))),
        });

        // v1 from launch; some products got a human rewrite later.
        const firstCopy = humanListing(plan.brand, profile, 3);
        const v1: ListingVersion = {
          id: nextId("lv"),
          productId: product.id,
          version: 1,
          status: "live",
          ...firstCopy,
          createdBy: { type: "member", memberId: rng.pick(editors).id },
          createdAt: product.createdAt,
        };
        listingVersions.push(v1);
        product.title = v1.title;

        if (rng.chance(0.2)) {
          v1.status = "superseded";
          const revisedMs = rng.int(createdMs + DAY_MS, clock.daysAgo(30));
          const v2: ListingVersion = {
            id: nextId("lv"),
            productId: product.id,
            version: 2,
            status: "live",
            ...humanListing(plan.brand, profile, 4),
            createdBy: { type: "member", memberId: rng.pick(editors).id },
            createdAt: clock.iso(revisedMs),
          };
          listingVersions.push(v2);
          product.title = v2.title;
        }

        products.push(product);
      }
    }
  }

  return { products, productFacts, listingVersions, profiles };
}

/** Plain, human-written copy: short title, few bullets. Leaves room for agents to improve. */
function humanListing(brand: string, profile: ProductProfile, bulletCount: number): ListingCopy {
  const { noun, adjective, color, features, keywords } = profile;
  return {
    title: truncate(`${brand} ${adjective} ${noun}, ${color}`, LISTING_LIMITS.titleMaxLength),
    bullets: features.slice(0, bulletCount).map(([, sentence]) => sentence),
    description: `The ${brand} ${noun.toLowerCase()} in ${color.toLowerCase()}. ${features[0]?.[1] ?? ""}`.trim(),
    backendKeywords: backendKeywords(keywords.slice(0, 3)),
  };
}

/** Agent-written copy: keyword-rich title and five structured bullets. */
export function agentListing(
  brand: string,
  profile: ProductProfile,
  options: { prohibitedClaim?: string; unsupportedClaim?: boolean } = {},
): ListingCopy {
  const { noun, adjective, material, color, features, keywords, vocabulary } = profile;
  const useCase = vocabulary.useCases[0] ?? "everyday use";
  const headline = features[0]?.[0] ?? "";
  const bullets = features.map(([title, sentence]) => `${title} – ${sentence}`);
  if (options.prohibitedClaim) bullets[1] = `${features[1]?.[0] ?? "QUALITY"} – ${options.prohibitedClaim}.`;
  if (options.unsupportedClaim) bullets[2] = `${features[2]?.[0] ?? "CAPACITY"} – Holds twice as much as leading brands.`;

  return {
    title: truncate(
      `${brand} ${adjective} ${noun} for ${useCase} – ${material}, ${toTitleCase(headline)}, ${color}`,
      LISTING_LIMITS.titleMaxLength,
    ),
    bullets,
    description: [
      `Meet the ${brand} ${noun.toLowerCase()}, made from ${material.toLowerCase()} in ${color.toLowerCase()}.`,
      ...features.map(([, sentence]) => sentence),
      `A practical pick for ${vocabulary.useCases.join(", ")}.`,
    ].join(" "),
    backendKeywords: backendKeywords(keywords),
  };
}

function backendKeywords(keywords: string[]): string {
  const words: string[] = [];
  for (const word of new Set(keywords.join(" ").toLowerCase().split(/\s+/))) {
    if ([...words, word].join(" ").length > LISTING_LIMITS.backendKeywordsMaxBytes) break;
    words.push(word);
  }
  return words.join(" ");
}

function uniqueAsin(ctx: GeneratorContext, used: Set<string>): string {
  let asin: string;
  do {
    asin = `B0${ctx.rng.faker.string.alphanumeric({ length: 8, casing: "upper" })}`;
  } while (used.has(asin));
  used.add(asin);
  return asin;
}

export function randomAsin(ctx: GeneratorContext): string {
  return `B0${ctx.rng.faker.string.alphanumeric({ length: 8, casing: "upper" })}`;
}

function toTitleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s-])(\w)/g, (_, separator: string, char: string) => separator + char.toUpperCase());
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
