// Playwright config for the Slice-7 confirmation-placement viewport
// suite (brief 2026-11-15, §4A). Separate from the tenant-portal smoke
// suite (e2e/playwright.config.js): these specs run the real components
// in a static harness (e2e/placement/) with a mocked API, at desktop
// 1280x800 and phone 390x844, and assert the confirmation's bounding
// rectangle is in the viewport immediately after each save.
//
// Run: npx playwright test --config=e2e/playwright.placement.config.js
// The spec builds the harness in beforeAll, so every run tests the
// current source. Specs are named *.placement.e2e.js (not *.spec.js) so
// vitest never picks them up, and they live under e2e/placement/ (not
// e2e/specs) so the smoke config never picks them up.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./placement",
  testMatch: "**/*.placement.e2e.js",
  timeout: 90000,
  expect: { timeout: 20000 },
  // No retries: a placement suite that retries its way green hides flakes.
  retries: 0,
  reporter: [["list"]],
  outputDir: "./test-results-placement",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "chromium-phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
