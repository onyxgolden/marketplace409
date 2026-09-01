// FB-UI-3/4 rule 8: "Before/after screenshots must use identical routes, fixtures, viewports, and
// readiness conditions." Achieved structurally, not by convention: both the "before" and "after"
// capture passes call the exact same FB-UI-1/FB-UI-2 pipeline (routeAllowlist.mjs's own route
// definitions, viewportPresets.mjs's three presets, readinessWait.mjs's same plan-builder) against
// two different base URLs -- there is no separate code path or separate config for "before" vs.
// "after" that could quietly drift apart.
//
// Doubles as the "accessibility_check" validation step (validatePatch.mjs): FB-UI-2's finding engine
// runs against both the before and after diagnostics snapshots, and the comparison reports which
// findings were resolved, which are new, and which are unchanged -- reusing the existing deterministic
// rule engine rather than building a second one for this checkpoint.

import { runScreenshotEvidenceCapture } from "../screenshot-evidence/captureScreenshotEvidence.mjs";
import { runDiagnosticsEvidenceCapture } from "../finding-engine/captureDiagnosticsEvidence.mjs";
import { runFindingEngine } from "../finding-engine/findingEngine.mjs";

function findingKey(finding) {
  return `${finding.category}:${finding.routeId}:${finding.viewport}:${finding.affectedComponent || ""}`;
}

// Compares two already-run finding sets by their stable content key (category+route+viewport+
// component -- not findingId, since findingId also depends on ruleId and both sides ran the same
// rules, but comparing by the human-meaningful key is what actually answers "is this the same defect
// or a different one" for the resolved/new/unchanged breakdown below).
export function comparePatchFindings(beforeFindings, afterFindings) {
  const beforeKeys = new Set(beforeFindings.map(findingKey));
  const afterKeys = new Set(afterFindings.map(findingKey));
  return Object.freeze({
    resolved: Object.freeze(beforeFindings.filter((f) => !afterKeys.has(findingKey(f)))),
    newlyIntroduced: Object.freeze(afterFindings.filter((f) => !beforeKeys.has(findingKey(f)))),
    stillPresent: Object.freeze(afterFindings.filter((f) => beforeKeys.has(findingKey(f)))),
  });
}

export async function capturePatchPreview({
  beforeBaseUrl, afterBaseUrl, routeIds, commit, env = process.env, now = Date.now(), launchChromium, application = "409 Marketplace FORGE",
}) {
  const chromiumOption = launchChromium ? { launchChromium } : {};

  const [beforeScreenshots, afterScreenshots] = await Promise.all([
    runScreenshotEvidenceCapture({ baseUrl: beforeBaseUrl, routeIds, commit, env, now, ...chromiumOption }),
    runScreenshotEvidenceCapture({ baseUrl: afterBaseUrl, routeIds, commit, env, now, ...chromiumOption }),
  ]);
  const [beforeDiagnosticsByRoute, afterDiagnosticsByRoute] = await Promise.all([
    runDiagnosticsEvidenceCapture({ baseUrl: beforeBaseUrl, routeIds, env, now, ...chromiumOption }),
    runDiagnosticsEvidenceCapture({ baseUrl: afterBaseUrl, routeIds, env, now, ...chromiumOption }),
  ]);

  function toRouteEvidence(diagnosticsByRoute, screenshotManifest) {
    return diagnosticsByRoute.map((route) => {
      const screenshotHashes = {};
      for (const viewport of ["desktop", "tablet", "mobile"]) {
        const entry = screenshotManifest.entries.find((e) => e.routeId === route.routeId && e.viewport === viewport && e.kind === "full-page");
        screenshotHashes[viewport] = entry ? entry.screenshotHash : null;
      }
      return { application, routeId: route.routeId, routePath: route.routePath, snapshots: route.snapshots, screenshotHashes };
    });
  }

  const beforeManifest = runFindingEngine(toRouteEvidence(beforeDiagnosticsByRoute, beforeScreenshots), { citeSourceFiles: () => [] });
  const afterManifest = runFindingEngine(toRouteEvidence(afterDiagnosticsByRoute, afterScreenshots), { citeSourceFiles: () => [] });

  const comparison = comparePatchFindings(beforeManifest.findings, afterManifest.findings);

  return Object.freeze({
    beforeScreenshots, afterScreenshots, beforeFindings: beforeManifest.findings, afterFindings: afterManifest.findings, comparison,
  });
}

// The real accessibility-check step validatePatch.mjs's `runAccessibilityCheck` option should be set
// to, once both a "before" and "after" server are actually running (owner-provided base URLs -- this
// module has no server-lifecycle capability of its own, matching FB-UI-1/FB-UI-2's own established
// "capture against an already-running URL" boundary). Fails the step if any NEW finding appeared that
// wasn't present before the patch -- a patch that introduces a fresh defect while fixing another one
// must not pass validation.
export function accessibilityCheckStepFromComparison(comparison) {
  const passed = comparison.newlyIntroduced.length === 0;
  return Object.freeze({
    step: "accessibility_check", passed, redacted: true,
    summary: `${comparison.resolved.length} resolved, ${comparison.newlyIntroduced.length} newly introduced, ${comparison.stillPresent.length} still present`,
  });
}
