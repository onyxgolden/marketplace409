// FB-UI-1's capture orchestrator. Wires together every other module in this directory into one
// deterministic pipeline: host/route authorization -> auth resolution -> browser launch -> readiness
// wait -> redaction (applied + verified) -> full-page and named-component screenshots -> hashing ->
// manifest entry construction. Every fail-closed gate from requirement 8 (authentication, readiness,
// route authorization, redaction) is a hard throw here, before any screenshot is written to disk --
// there is no partial/best-effort evidence path.
//
// Chromium is the only browser this module launches (requirement: "using Playwright with Chromium").
// `chromium` is imported directly from the `playwright` package rather than received as an injected
// parameter, matching this repository's established convention of mocking imported modules with
// `vi.mock(...)` in tests rather than threading dependency-injection parameters through call sites.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { APPROVED_ROUTES, assertRouteApproved } from "./routeAllowlist.mjs";
import { VIEWPORT_NAMES, getViewportPreset } from "./viewportPresets.mjs";
import { assertHostPermitted } from "./hostAllowlist.mjs";
import { resolveAuthModeForRoute } from "./previewSession.mjs";
import { buildReadinessPlan, waitForReadiness } from "./readinessWait.mjs";
import { applyAndVerifyRedaction } from "./redaction.mjs";
import { hashScreenshotBuffer } from "./screenshotHash.mjs";
import { assertEvidenceObjectClean } from "./evidenceTextScan.mjs";
import { CAPTURE_ENVIRONMENT, CAPTURE_KIND, validateScreenshotManifest, validateScreenshotManifestEntry } from "./screenshotManifestContracts.mjs";
import { classifyHost } from "./hostAllowlist.mjs";

// Captures every configured shot (full-page, then each named component in the route's declared
// order) for exactly one route+viewport combination against an already-navigated, already-ready,
// already-redacted `page`. Returns validated manifest entries -- never raw, unvalidated objects --
// so a caller cannot accidentally persist an entry that skipped contract validation.
export async function captureRouteViewportShots({ page, route, viewportName, baseUrl, commit, environment, authMode, browserVersion, capturedAt, redactionResult, readinessEvidence, writeScreenshot }) {
  const entries = [];

  const fullPageBuffer = await page.screenshot({ fullPage: true });
  const fullPageEntryDraft = {
    entryId: randomUUID(), routeId: route.routeId, routePath: route.path, viewport: viewportName,
    kind: CAPTURE_KIND.FULL_PAGE, componentName: null, environment, commit, capturedAt, browserVersion,
    screenshotHash: hashScreenshotBuffer(fullPageBuffer), readinessEvidence, redaction: redactionResult, authMode,
  };
  assertEvidenceObjectClean(fullPageEntryDraft);
  const fullPageEntry = validateScreenshotManifestEntry(fullPageEntryDraft);
  await writeScreenshot(fullPageEntry, fullPageBuffer);
  entries.push(fullPageEntry);

  for (const component of route.components || []) {
    const locator = page.locator(component.selector);
    const componentBuffer = await locator.screenshot();
    const componentEntryDraft = {
      entryId: randomUUID(), routeId: route.routeId, routePath: route.path, viewport: viewportName,
      kind: CAPTURE_KIND.COMPONENT, componentName: component.name, environment, commit, capturedAt, browserVersion,
      screenshotHash: hashScreenshotBuffer(componentBuffer), readinessEvidence, redaction: redactionResult, authMode,
    };
    assertEvidenceObjectClean(componentEntryDraft);
    const componentEntry = validateScreenshotManifestEntry(componentEntryDraft);
    await writeScreenshot(componentEntry, componentBuffer);
    entries.push(componentEntry);
  }

  return entries;
}

function defaultWriteScreenshot(outputDir) {
  return async (entry, buffer) => {
    mkdirSync(outputDir, { recursive: true });
    const filename = `${entry.routeId}--${entry.viewport}--${entry.kind}${entry.componentName ? `--${entry.componentName}` : ""}.png`;
    writeFileSync(path.join(outputDir, filename), buffer);
  };
}

// Top-level entry point. `routeIds` defaults to every approved route; an explicit subset must still be
// a subset of APPROVED_ROUTES (assertRouteApproved rejects anything else). Nothing here silently skips
// a fail-closed gate -- a single route/viewport failure aborts the whole run rather than producing a
// partial manifest, since a manifest that looks complete but silently dropped one entry would be worse
// than no manifest at all.
export async function runScreenshotEvidenceCapture({ baseUrl, routeIds, outputDir, commit, env = process.env, now = Date.now(), launchChromium = () => chromium.launch(), writeScreenshot } = {}) {
  if (!baseUrl) throw new Error("runScreenshotEvidenceCapture requires baseUrl");
  if (!commit) throw new Error("runScreenshotEvidenceCapture requires commit");
  const hostResult = assertHostPermitted(baseUrl);

  const routes = (routeIds && routeIds.length > 0)
    ? routeIds.map((routeId) => {
        const route = APPROVED_ROUTES.find((candidate) => candidate.routeId === routeId);
        if (!route) throw new Error(`Route id "${routeId}" is not on the FB-UI approved route list`);
        return route;
      })
    : APPROVED_ROUTES;

  const browser = await launchChromium();
  const browserVersion = browser.version();
  const persistScreenshot = writeScreenshot || defaultWriteScreenshot(outputDir);
  const entries = [];

  try {
    for (const route of routes) {
      assertRouteApproved(route.path);
      const { authMode, storageStatePath } = resolveAuthModeForRoute(route, { env, now });

      for (const viewportName of VIEWPORT_NAMES) {
        const viewport = getViewportPreset(viewportName);
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.deviceScaleFactor,
          ...(storageStatePath ? { storageState: storageStatePath } : {}),
        });
        const page = await context.newPage();
        try {
          await page.goto(new URL(route.path, baseUrl).toString());
          const plan = buildReadinessPlan(route);
          const readinessEvidence = await waitForReadiness(page, plan);
          await applyAndVerifyRedaction(page);
          // rulesApplied is deliberately empty here, not omitted: applyAndVerifyRedaction proves the
          // masking script ran and set its verification attribute (the fail-closed guarantee this
          // checkpoint requires), but retrieving *which* individual rules actually matched anything on
          // this specific page would need a second evaluate() round-trip this foundation doesn't yet
          // make -- deferred, not silently assumed complete. See the FB-UI-1 report.
          const redactionResult = { verified: true, rulesApplied: [] };

          const routeEntries = await captureRouteViewportShots({
            page, route, viewportName, baseUrl, commit,
            environment: hostResult.classification === "local" ? CAPTURE_ENVIRONMENT.LOCAL : CAPTURE_ENVIRONMENT.PREVIEW,
            authMode, browserVersion, capturedAt: new Date(now).toISOString(),
            redactionResult, readinessEvidence, writeScreenshot: persistScreenshot,
          });
          entries.push(...routeEntries);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const manifest = validateScreenshotManifest({ schemaVersion: "1.0", entries });
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  return manifest;
}

export { classifyHost };
