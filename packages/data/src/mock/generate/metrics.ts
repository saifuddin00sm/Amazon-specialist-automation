import type { AdMetricsDaily, MetricsDaily, ProductMetricsDaily, Target } from "@app/core";
import { round2, type GeneratorContext } from "../context";
import type { Advertising } from "./advertising";
import type { Catalog } from "./catalog";

/** Sunday-first demand multipliers. */
const WEEKDAY_FACTOR = [1.12, 0.94, 0.96, 0.98, 1.0, 1.03, 1.1] as const;
/** Days before the anchor that get a deal-event spike (like Prime Big Deal Days). */
const DEAL_DAYS_AGO = [23, 22];
const DEAL_FACTOR = 2.1;
/** Share of budget that counts as "spent out" for the budget pacer. */
export const BUDGET_CAPPED_SHARE = 0.95;

export function generateMetrics(ctx: GeneratorContext, catalog: Catalog, ads: Advertising): MetricsDaily[] {
  const { rng, clock } = ctx;
  const { dates } = clock;
  const dayCount = dates.length;
  const dealDates = new Set(DEAL_DAYS_AGO.map((daysAgo) => dates[dayCount - 1 - daysAgo]));
  const dayFactors = dates.map((date, i) => {
    const weekday = WEEKDAY_FACTOR[new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? 1;
    const trend = dayCount > 1 ? 0.9 + (0.2 * i) / (dayCount - 1) : 1;
    return weekday * trend * (dealDates.has(date) ? DEAL_FACTOR : 1);
  });
  const noise = (spread: number) => rng.float(1 - spread, 1 + spread);

  const rows: MetricsDaily[] = [];

  for (const product of catalog.products) {
    const popularity = rng.float(0, 1) ** 2;
    const baseSessions = 4 + 260 * popularity;
    const unitSessionRate = rng.float(0.05, 0.18);
    const activeDays =
      product.status === "active" ? dayCount : product.status === "suppressed" ? dayCount - rng.int(5, 30) : 0;

    dates.forEach((date, i) => {
      const sessions = i < activeDays ? Math.round(baseSessions * (dayFactors[i] ?? 1) * noise(0.25)) : 0;
      const unitsOrdered = Math.min(sessions, Math.round(sessions * unitSessionRate * noise(0.4)));
      const row: ProductMetricsDaily = {
        date,
        sellerAccountId: product.sellerAccountId,
        entityType: "product",
        entityId: product.id,
        sessions,
        pageViews: Math.round(sessions * rng.float(1.1, 1.6)),
        unitsOrdered,
        orderedRevenue: round2(unitsOrdered * product.price),
      };
      rows.push(row);
    });
  }

  const campaignById = new Map(ads.campaigns.map((campaign) => [campaign.id, campaign]));
  const adGroupById = new Map(ads.adGroups.map((adGroup) => [adGroup.id, adGroup]));
  const productById = new Map(catalog.products.map((product) => [product.id, product]));
  const campaignTotals = new Map<string, AdMetricsDaily[]>();
  // Paused campaigns stop at the same day for all their targets.
  const campaignCutoff = new Map(
    ads.campaigns.map((campaign) => [campaign.id, campaign.state === "paused" ? dayCount - rng.int(10, 40) : dayCount]),
  );

  for (const target of ads.targets) {
    if (target.negative || target.bid === undefined) continue;
    const adGroup = adGroupById.get(target.adGroupId);
    const campaign = adGroup && campaignById.get(adGroup.campaignId);
    if (!adGroup || !campaign) continue;

    const prices = adGroup.productIds.map((id) => productById.get(id)?.price ?? 0);
    const averageOrderValue = (prices.reduce((sum, price) => sum + price, 0) / prices.length) * rng.float(1, 1.25);
    const { impressions: baseImpressions, ctr } = trafficProfile(ctx, target);
    const conversionRate = rng.weighted([
      { weight: 30, value: () => rng.float(0.12, 0.22) },
      { weight: 50, value: () => rng.float(0.06, 0.12) },
      { weight: 20, value: () => rng.float(0, 0.02) },
    ])();
    const costPerClick = target.bid * rng.float(0.55, 0.95);
    const targetCutoff = target.state === "paused" ? dayCount - rng.int(10, 40) : dayCount;
    const activeDays = Math.min(targetCutoff, campaignCutoff.get(campaign.id) ?? dayCount);

    let totals = campaignTotals.get(campaign.id);
    if (!totals) {
      totals = dates.map((date) => ({
        date,
        sellerAccountId: campaign.sellerAccountId,
        entityType: "campaign" as const,
        entityId: campaign.id,
        impressions: 0,
        clicks: 0,
        spend: 0,
        adSales: 0,
        adOrders: 0,
      }));
      campaignTotals.set(campaign.id, totals);
    }

    dates.forEach((date, i) => {
      const impressions = i < activeDays ? Math.round(baseImpressions * (dayFactors[i] ?? 1) * noise(0.3)) : 0;
      const clicks = Math.min(impressions, Math.round(impressions * ctr * noise(0.4)));
      const adOrders = Math.min(clicks, Math.round(clicks * conversionRate * noise(0.5)));
      const row: AdMetricsDaily = {
        date,
        sellerAccountId: campaign.sellerAccountId,
        entityType: "target",
        entityId: target.id,
        impressions,
        clicks,
        spend: round2(clicks * costPerClick * noise(0.1)),
        adSales: round2(adOrders * averageOrderValue),
        adOrders,
      };
      rows.push(row);

      const total = totals[i];
      if (total) {
        total.impressions += row.impressions;
        total.clicks += row.clicks;
        total.spend = round2(total.spend + row.spend);
        total.adSales = round2(total.adSales + row.adSales);
        total.adOrders += row.adOrders;
      }
    });
  }

  for (const campaign of ads.campaigns) {
    const totals = campaignTotals.get(campaign.id) ?? [];
    rows.push(...totals);

    // Most campaigns have headroom; about a quarter are budget-capped.
    const spends = totals.map((row) => row.spend).filter((spend) => spend > 0).sort((a, b) => a - b);
    const p75 = spends[Math.floor(spends.length * 0.75)] ?? 0;
    const headroom = rng.chance(0.25) ? rng.float(0.9, 1.0) : rng.float(1.3, 2.0);
    campaign.dailyBudget = p75 > 0 ? Math.max(5, Math.round(p75 * headroom)) : rng.int(10, 50);
  }

  return rows;
}

function trafficProfile(ctx: GeneratorContext, target: Target): { impressions: number; ctr: number } {
  const { rng } = ctx;
  switch (target.kind) {
    case "auto":
      return { impressions: rng.float(300, 2000), ctr: rng.float(0.002, 0.005) };
    case "product":
      return { impressions: rng.float(50, 500), ctr: rng.float(0.003, 0.008) };
    case "keyword":
      if (target.matchType === "exact") return { impressions: rng.float(40, 400), ctr: rng.float(0.004, 0.012) };
      if (target.matchType === "phrase") return { impressions: rng.float(100, 800), ctr: rng.float(0.003, 0.008) };
      return { impressions: rng.float(200, 1500), ctr: rng.float(0.003, 0.007) };
  }
}
