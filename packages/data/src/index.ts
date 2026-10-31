import type { DataSource } from "./data-source";
import { getMockDataSource } from "./mock/mock-data-source";

export type { ActivityQuery, DataSource, DateRange, MetricsQuery, ProductQuery, ProposalQuery } from "./data-source";
export {
  MOCK_ANCHOR_DATE,
  MOCK_METRIC_DAYS,
  MOCK_SEED,
  generateMockDataset,
  type GenerateOptions,
  type MockDataset,
} from "./mock/generate";
export { createMockDataSource } from "./mock/mock-data-source";

/** Phase 1: always the mock. Swap the implementation here when real backends land. */
export function getDataSource(): DataSource {
  return getMockDataSource();
}
