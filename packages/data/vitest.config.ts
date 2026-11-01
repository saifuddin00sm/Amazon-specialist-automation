import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Supabase suites share one database, so test files run one at a time.
    fileParallelism: false,
    // Supabase tests reset tables between write tests.
    testTimeout: 30_000,
  },
});
