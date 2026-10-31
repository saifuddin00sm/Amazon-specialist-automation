import { z } from "zod";
import { IdSchema, IsoDateSchema, MoneySchema } from "./common";

const count = z.number().int().nonnegative();

const metricsBase = {
  date: IsoDateSchema,
  sellerAccountId: IdSchema,
};

/** Advertising metrics; reported for campaigns and targets. */
const adMetrics = {
  impressions: count,
  clicks: count,
  spend: MoneySchema,
  /** Sales attributed to ads. */
  adSales: MoneySchema,
  adOrders: count,
};

/** One entity's numbers for one day. Campaign rows are the sum of their target rows. */
export const MetricsDailySchema = z
  .discriminatedUnion("entityType", [
    z.object({
      ...metricsBase,
      entityType: z.literal("product"),
      entityId: IdSchema,
      sessions: count,
      pageViews: count,
      unitsOrdered: count,
      orderedRevenue: MoneySchema,
    }),
    z.object({ ...metricsBase, entityType: z.literal("campaign"), entityId: IdSchema, ...adMetrics }),
    z.object({ ...metricsBase, entityType: z.literal("target"), entityId: IdSchema, ...adMetrics }),
  ])
  .refine((row) => row.entityType === "product" || row.clicks <= row.impressions, {
    message: "clicks cannot exceed impressions",
    path: ["clicks"],
  })
  .refine((row) => row.entityType === "product" || row.adOrders <= row.clicks, {
    message: "adOrders cannot exceed clicks",
    path: ["adOrders"],
  })
  .refine((row) => row.entityType !== "product" || row.pageViews >= row.sessions, {
    message: "pageViews cannot be lower than sessions",
    path: ["pageViews"],
  });
export type MetricsDaily = z.infer<typeof MetricsDailySchema>;
export type MetricsEntityType = MetricsDaily["entityType"];
export type ProductMetricsDaily = Extract<MetricsDaily, { entityType: "product" }>;
export type AdMetricsDaily = Extract<MetricsDaily, { entityType: "campaign" | "target" }>;
