import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Sandbox calls go over the network and wait out the rate limiter.
    testTimeout: 30_000,
  },
});
