// Lighthouse runs for the smoke suite — unauthenticated surfaces ONLY.
//
// Lighthouse cannot cleanly reuse an authenticated Playwright session, so
// the signed-in pages are covered by axe instead (scope §5). This helper
// launches Chrome from the Playwright chromium executable, audits at a ~390px
// mobile viewport, gates accessibility and best-practices at 90, and reports
// performance without gating it (preview-deploy timing is too noisy to gate
// merges on). Thresholds are env-overridable for the first-baseline run;
// lowering them is a deliberate, documented decision, never a silent edit.
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

export const LIGHTHOUSE_DEFAULTS = Object.freeze({
  minAccessibility: 90,
  minBestPractices: 90,
});

export function lighthouseThresholds(env = process.env) {
  const accessibility = Number.parseInt(env.E2E_LH_MIN_ACCESSIBILITY || "", 10);
  const bestPractices = Number.parseInt(env.E2E_LH_MIN_BEST_PRACTICES || "", 10);
  return {
    minAccessibility: Number.isSafeInteger(accessibility) ? accessibility : LIGHTHOUSE_DEFAULTS.minAccessibility,
    minBestPractices: Number.isSafeInteger(bestPractices) ? bestPractices : LIGHTHOUSE_DEFAULTS.minBestPractices,
  };
}

export async function runLighthouse(url, executablePath, thresholds = lighthouseThresholds()) {
  const chrome = await launch({
    chromePath: executablePath,
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  try {
    const result = await lighthouse(
      url,
      {
        port: chrome.port,
        formFactor: "mobile",
        screenEmulation: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
        throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
        onlyCategories: ["accessibility", "best-practices", "performance"],
      },
      { extends: "lighthouse:default" },
    );
    const categories = result.lhr.categories;
    const scores = {
      accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((categories["best-practices"]?.score ?? 0) * 100),
      performance: Math.round((categories.performance?.score ?? 0) * 100),
    };
    return { scores, thresholds };
  } finally {
    await chrome.kill();
  }
}

export function assertLighthouseThresholds(scores, thresholds, label) {
  const failures = [];
  if (scores.accessibility < thresholds.minAccessibility) {
    failures.push(`accessibility ${scores.accessibility} < ${thresholds.minAccessibility}`);
  }
  if (scores.bestPractices < thresholds.minBestPractices) {
    failures.push(`best-practices ${scores.bestPractices} < ${thresholds.minBestPractices}`);
  }
  if (failures.length > 0) {
    throw new Error(`${label}: Lighthouse thresholds not met: ${failures.join("; ")} (performance ${scores.performance}, reported only)`);
  }
}
