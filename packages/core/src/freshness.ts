import { z } from "zod";
import { IsoDateTimeSchema } from "./common";

/** Inputs an agent reads before it proposes something. */
export const FreshnessSourceSchema = z.enum(["ad_metrics", "search_terms", "live_listing", "product_facts"]);
export type FreshnessSource = z.infer<typeof FreshnessSourceSchema>;

/** How current one input was when the agent used it. */
export const DataFreshnessSchema = z.object({
  source: FreshnessSourceSchema,
  asOf: IsoDateTimeSchema,
});
export type DataFreshness = z.infer<typeof DataFreshnessSchema>;

/** Older than this when the proposal was made, the input counts as stale. */
export const FRESHNESS_MAX_AGE_HOURS: Record<FreshnessSource, number> = {
  ad_metrics: 36,
  search_terms: 48,
  live_listing: 24,
  product_facts: 365 * 24,
};

const HOUR_MS = 60 * 60 * 1000;

/** Hours between `entry.asOf` and `at` (an ISO timestamp), never negative. */
export function freshnessAgeHours(entry: DataFreshness, at: string): number {
  return Math.max(0, (Date.parse(at) - Date.parse(entry.asOf)) / HOUR_MS);
}

export function isStale(entry: DataFreshness, at: string): boolean {
  return freshnessAgeHours(entry, at) > FRESHNESS_MAX_AGE_HOURS[entry.source];
}
