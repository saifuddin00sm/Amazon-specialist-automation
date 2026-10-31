import type { DataSource } from "./data-source";
import { getMockDataSource } from "./mock/mock-data-source";

export { AgentRunError } from "./data-source";
export type {
  ActivityQuery,
  AgentRunErrorCode,
  AgentRunQuery,
  ApproveProposalInput,
  DataSource,
  DateRange,
  MetricsQuery,
  ProductQuery,
  ProposalQuery,
  RejectProposalInput,
  SnoozeProposalInput,
  StartListingOptimizerInput,
} from "./data-source";
export {
  MOCK_ANCHOR_DATE,
  MOCK_METRIC_DAYS,
  MOCK_SEED,
  generateMockDataset,
  type GenerateOptions,
  type MockDataset,
} from "./mock/generate";
export { createMockDataSource, type MockDataSourceOptions } from "./mock/mock-data-source";
export { ProposalWriteError, type ProposalWriteErrorCode } from "./proposal-writes";

/** Phase 1: always the mock. Swap the implementation here when real backends land. */
export function getDataSource(): DataSource {
  return getMockDataSource();
}
