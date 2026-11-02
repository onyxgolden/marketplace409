// Playwright config for the tenant-portal smoke suite.
//
// Specs are named *.e2e.js (not *.spec.js) so the repo's vitest job never
// picks them up; the pure target-gate unit tests live in
// e2e/helpers/target.test.js and DO run under vitest. The suite is
// non-blocking by design: it reports on every PR and on main, and is
// promoted to a required check only after 10 consecutive green runs, on
// Jason's word (see e2e/docs/e2e-smoke-run.md).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  testMatch: "**/*.e2e.js",
  globalSetup: "./global.setup.js",
  globalTeardown: "./global.teardown.js",
  timeout: 90000,
  expect: { timeout: 20000 },
  // No retries: a smoke suite that retries its way green hides flakes.
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
  outputDir: "./test-results",
  use: {
    // Validated by global setup before any test runs; the localhost fallback
    // only ever produces failures (no backend), never false greens.
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
