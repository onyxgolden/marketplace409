// Orchestrates every rule module in this directory against a route's diagnostics snapshots and
// produces a validated, deterministic findings manifest. "Deterministic" here means two things at
// once: every individual rule only reports a measurable DOM/CSSOM fact (never a vision-model guess),
// and re-running the engine against the *same* evidence always produces the *same* finding IDs --
// content-derived, not random -- so the review UI's per-finding status (reviewed/rejected/etc.,
// tracked by proposalStore.mjs) survives a re-run instead of spawning duplicate "new" findings for
// something the owner already decided on.

import { hashContent } from "../../engineering-brain/hashContent.mjs";
import { validateDiagnosticsSnapshot } from "./diagnosticsContracts.mjs";
import { validateFindingsManifest, validateUiFinding, FINDING_CONTRACT_SCHEMA_VERSION } from "./findingContracts.mjs";
import { findClippedOrTruncatedControls, findHorizontalOverflow, findInconsistentSpacing, findOverlappingContent } from "./layoutRules.mjs";
import { findContrastIssues, findKeyboardFocusVisibilityIssues, findMissingAccessibleNames, findUndersizedTouchTargets } from "./accessibilityRules.mjs";
import { findEmptyStateLayoutDefects, findMisleadingCharts, findStatusCommunicationIssues } from "./contentStateRules.mjs";
import { findBreakpointRegressions } from "./breakpointRules.mjs";
import { citeProbableSourceFiles, loadEngineeringBrainManifest } from "./citeProbableSourceFiles.mjs";

// Per-viewport rules: run once for each of desktop/tablet/mobile independently.
const PER_VIEWPORT_RULES = Object.freeze([
  findHorizontalOverflow, findClippedOrTruncatedControls, findOverlappingContent, findInconsistentSpacing,
  findContrastIssues, findUndersizedTouchTargets, findMissingAccessibleNames, findKeyboardFocusVisibilityIssues,
  findEmptyStateLayoutDefects, findStatusCommunicationIssues, findMisleadingCharts,
]);

// Cross-viewport rules: run once per route, given all three viewports' snapshots at once.
const CROSS_VIEWPORT_RULES = Object.freeze([findBreakpointRegressions]);

function findingId(draft) {
  const key = JSON.stringify({
    ruleId: draft.ruleId, routeId: draft.routeId, viewport: draft.viewport, affectedComponent: draft.affectedComponent,
  });
  return `finding_${hashContent(key).slice(0, 16)}`;
}

// Default citation resolver: reuses the Engineering Brain's existing runQuery/authority-ranking
// pipeline unchanged (citeProbableSourceFiles.mjs), scoped to one finding's route path plus its
// affected component/selector as the query text. Best-effort and never fatal -- see
// citeProbableSourceFiles.mjs's own header for why this stays read-only/non-fail-closed. The manifest
// is loaded once per defaultCiteSourceFiles closure, not once per finding, so a run over many findings
// doesn't re-read disk repeatedly.
function defaultCiteSourceFiles() {
  const manifest = loadEngineeringBrainManifest();
  return (queryText) => citeProbableSourceFiles({ manifest, queryText });
}

// `routeEvidence` shape: { application, routeId, routePath, snapshots: {desktop, tablet, mobile} (raw,
// unvalidated), screenshotHashes: {desktop, tablet, mobile} }. Validates every snapshot before any rule
// sees it -- a malformed snapshot for one viewport fails the whole route closed rather than silently
// running rules against partial/wrong data.
//
// `citeSourceFiles` is injectable (a `(queryText) => string[]` function) specifically so tests can
// supply a fixture-driven stand-in instead of touching a real engineering-brain/index-manifest.json --
// defaults to a real lookup against the Engineering Brain's own index.
export function runFindingEngineForRoute(routeEvidence, { now = new Date().toISOString(), citeSourceFiles = defaultCiteSourceFiles() } = {}) {
  const snapshotsByViewport = {};
  for (const viewport of ["desktop", "tablet", "mobile"]) {
    snapshotsByViewport[viewport] = validateDiagnosticsSnapshot(routeEvidence.snapshots[viewport]);
  }

  const drafts = [];
  for (const viewport of ["desktop", "tablet", "mobile"]) {
    const context = {
      application: routeEvidence.application, routeId: routeEvidence.routeId, routePath: routeEvidence.routePath,
      viewport, screenshotHash: routeEvidence.screenshotHashes[viewport], snapshot: snapshotsByViewport[viewport],
    };
    for (const rule of PER_VIEWPORT_RULES) drafts.push(...rule(context));
  }

  const crossViewportContext = {
    application: routeEvidence.application, routeId: routeEvidence.routeId, routePath: routeEvidence.routePath,
    snapshotsByViewport, screenshotHashByViewport: routeEvidence.screenshotHashes,
  };
  for (const rule of CROSS_VIEWPORT_RULES) drafts.push(...rule(crossViewportContext));

  return drafts.map((draft) => {
    // Real Engineering Brain citations replace the rule's own generic "(inspect the component
    // rendering ...)" guess whenever the index actually has a ranked match; the guess remains as a
    // fallback when it doesn't -- a finding is never blocked or weakened by an empty/missing index.
    const queryText = [draft.routePath, draft.affectedComponent].filter(Boolean).join(" ");
    const citations = citeSourceFiles(queryText);
    return validateUiFinding({
      ...draft, findingId: findingId(draft), detectedAt: now,
      probableSourceFiles: citations.length > 0 ? citations : draft.probableSourceFiles,
      affectedComponent: draft.affectedComponent ?? null,
    });
  });
}

// Runs the engine across every route in the evidence set and returns one validated, deterministically
// sorted findings manifest -- the shape runFindingEngineCli.mjs writes to disk. The citation manifest
// is loaded once here (not once per route) and threaded through -- a multi-route run still only reads
// engineering-brain/index-manifest.json from disk a single time.
export function runFindingEngine(routeEvidenceList, options = {}) {
  const citeSourceFiles = options.citeSourceFiles || defaultCiteSourceFiles();
  const findings = routeEvidenceList.flatMap((routeEvidence) => runFindingEngineForRoute(routeEvidence, { ...options, citeSourceFiles }));
  return validateFindingsManifest({ schemaVersion: FINDING_CONTRACT_SCHEMA_VERSION, findings });
}
