// Captures a UiDiagnosticsSnapshot per approved route/viewport -- the data findingEngine.mjs's rules
// run against. A deliberately separate pass from screenshot-evidence/captureScreenshotEvidence.mjs
// (FB-UI-1), reusing every one of FB-UI-1's building blocks (host/route allowlisting, readiness
// waiting, redaction, preview-session auth) unchanged rather than modifying that already-reviewed,
// already-merged module. The tradeoff is a second browser visit per route/viewport instead of one;
// the benefit is FB-UI-1's contract and test suite stay exactly as approved.
//
// Diagnostics are captured AFTER redaction is applied and verified, for the same reason
// screenshot-evidence hashes the post-redaction screenshot buffer: any real text this snapshot reads
// (accessible names, status text) has already been masked, so a diagnostics JSON can never carry real
// PII even though it is metadata, not a screenshot.

import { chromium } from "playwright";
import { APPROVED_ROUTES, assertRouteApproved } from "../screenshot-evidence/routeAllowlist.mjs";
import { VIEWPORT_NAMES, getViewportPreset } from "../screenshot-evidence/viewportPresets.mjs";
import { assertHostPermitted } from "../screenshot-evidence/hostAllowlist.mjs";
import { resolveAuthModeForRoute } from "../screenshot-evidence/previewSession.mjs";
import { buildReadinessPlan, waitForReadiness } from "../screenshot-evidence/readinessWait.mjs";
import { applyAndVerifyRedaction } from "../screenshot-evidence/redaction.mjs";
import { buildDiagnosticsCaptureScript } from "./diagnosticsSnapshotScript.mjs";
import { validateDiagnosticsSnapshot } from "./diagnosticsContracts.mjs";

// Captures diagnostics for one already-ready, already-redacted `page`. Exported separately from the
// browser-lifecycle orchestrator below so a test can exercise it against a mock `page` without any
// Playwright/Chromium dependency at all.
export async function captureDiagnosticsForPage(page) {
  const raw = await page.evaluate(buildDiagnosticsCaptureScript());
  return validateDiagnosticsSnapshot(raw);
}

// Top-level entry point, structurally identical to captureScreenshotEvidence.mjs's
// runScreenshotEvidenceCapture: same fail-closed gate order (host -> route -> auth), same
// `launchChromium` injection point for tests, same per-route/per-viewport isolated browser context.
export async function runDiagnosticsEvidenceCapture({ baseUrl, routeIds, env = process.env, now = Date.now(), launchChromium = () => chromium.launch() } = {}) {
  if (!baseUrl) throw new Error("runDiagnosticsEvidenceCapture requires baseUrl");
  assertHostPermitted(baseUrl);

  const routes = (routeIds && routeIds.length > 0)
    ? routeIds.map((routeId) => {
        const route = APPROVED_ROUTES.find((candidate) => candidate.routeId === routeId);
        if (!route) throw new Error(`Route id "${routeId}" is not on the FB-UI approved route list`);
        return route;
      })
    : APPROVED_ROUTES;

  const browser = await launchChromium();
  const results = [];

  try {
    for (const route of routes) {
      assertRouteApproved(route.path);
      const { storageStatePath } = resolveAuthModeForRoute(route, { env, now });
      const snapshotsByViewport = {};

      for (const viewportName of VIEWPORT_NAMES) {
        const viewport = getViewportPreset(viewportName);
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor,
          ...(storageStatePath ? { storageState: storageStatePath } : {}),
        });
        const page = await context.newPage();
        try {
          await page.goto(new URL(route.path, baseUrl).toString());
          await waitForReadiness(page, buildReadinessPlan(route));
          await applyAndVerifyRedaction(page);
          snapshotsByViewport[viewportName] = await captureDiagnosticsForPage(page);
        } finally {
          await context.close();
        }
      }

      results.push({ routeId: route.routeId, routePath: route.path, snapshots: snapshotsByViewport });
    }
  } finally {
    await browser.close();
  }

  return results;
}
