// Lighthouse smoke checks (scope §2.4): unauthenticated surfaces ONLY.
// Authenticated pages carry tenant data and a signed-in session; auditing
// them would need a logged-in Chrome profile and would mix tenant fixtures
// into a performance audit. The signed-out portal card and /auth are the
// public surfaces, and they are the ones audited here.
//
// Accessibility and best-practices gate at 90 (env-overridable); performance
// is reported, never gated — a phone-width performance number on a shared
// CI runner is too noisy to fail a smoke run.
import { test, expect, chromium } from "@playwright/test";
import { readRunState } from "../helpers/fixtures.js";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const MIN_SCORE = Number(process.env.E2E_LIGHTHOUSE_MIN || 90);

test.describe("lighthouse unauthenticated surfaces", () => {
  let baseUrl;

  test.beforeAll(() => {
    baseUrl = readRunState().baseUrl;
  });

  async function audit(path, testInfo) {
    const chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const result = await lighthouse(`${baseUrl}${path}`, {
        port: chrome.port,
        output: "json",
        onlyCategories: ["accessibility", "best-practices", "performance"],
        formFactor: "mobile",
        screenEmulation: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      });
      const categories = result.lhr.categories;
      const scores = {
        accessibility: Math.round(categories.accessibility.score * 100),
        bestPractices: Math.round(categories["best-practices"].score * 100),
        performance: Math.round(categories.performance.score * 100),
      };
      // Performance is reported, never gated.
      await testInfo.attach(`lighthouse ${path}`, {
        body: JSON.stringify({ path, ...scores }, null, 2),
        contentType: "application/json",
      });
      console.log(`lighthouse ${path}: ${JSON.stringify(scores)}`);
      expect(scores.accessibility).toBeGreaterThanOrEqual(MIN_SCORE);
      expect(scores.bestPractices).toBeGreaterThanOrEqual(MIN_SCORE);
      return scores;
    } finally {
      await chrome.kill();
    }
  }

  test("signed-out portal card clears the accessibility and best-practices gates", async ({}, testInfo) => {
    await audit("/forge/rental/portal", testInfo);
  });

  test("sign-in page clears the accessibility and best-practices gates", async ({}, testInfo) => {
    await audit("/auth", testInfo);
  });
});
