import type { DataSource } from "./data-source";
import { mockDataSource } from "./mock/mock-data-source";

export type { DataSource } from "./data-source";
export { mockDataSource } from "./mock/mock-data-source";

/** Phase 1: always the mock. Swap the implementation here when real backends land. */
export function getDataSource(): DataSource {
  return mockDataSource;
}
