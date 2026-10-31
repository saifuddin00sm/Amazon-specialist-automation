import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * Key flows against a production build. Writes go to the server's in-memory mock, so specs run
 * one at a time and pick their proposals from whatever is still pending.
 */
export default defineConfig({
  testDir: "./e2e",
  // `*.e2e.ts` keeps these out of Vitest's default `*.test.ts` / `*.spec.ts` match.
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Locally, use the installed Chrome so no browser download is needed; CI installs Chromium.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel: process.env.CI ? undefined : "chrome" },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/approvals`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
