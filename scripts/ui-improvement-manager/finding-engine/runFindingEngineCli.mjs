#!/usr/bin/env node
// FB-UI-2 CLI entry point. Owner-invoked only, same as FB-UI-1's capture CLI. Usage:
//
//   node scripts/ui-improvement-manager/finding-engine/runFindingEngineCli.mjs \
//     --base-url http://localhost:3000 --evidence-dir ui-improvement-manager/evidence/<run-id> \
//     [--route <routeId> ...]
//
// Requires a screenshot-evidence manifest.json already produced by FB-UI-1's
// captureScreenshotEvidenceCli.mjs in the same --evidence-dir (for the screenshotHash each finding
// references as its evidence) -- run that CLI first. This CLI only ever reads that manifest and
// writes findings-manifest.json; it never edits an application file, never touches Git, and never
// authorizes commit/push/PR/merge/deployment/migration/Production access.
//
// `runCli` is exported separately from the `main()` auto-invocation (mirroring
// scripts/repair-controller/dryRunRepairAuthorityCli.mjs's own testability pattern) so a test can
// exercise its argument parsing, fail-closed checks, and manifest-cross-referencing logic against an
// injected `captureDiagnostics` function, without ever launching a real browser.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runDiagnosticsEvidenceCapture } from "./captureDiagnosticsEvidence.mjs";
import { runFindingEngine } from "./findingEngine.mjs";

export function parseArgs(argv) {
  const args = { routeIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--base-url") args.baseUrl = argv[++i];
    else if (flag === "--evidence-dir") args.evidenceDir = argv[++i];
    else if (flag === "--route") args.routeIds.push(argv[++i]);
    else if (flag === "--application") args.application = argv[++i];
  }
  return args;
}

export class FindingEngineCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "FindingEngineCliError";
  }
}

// `captureDiagnostics` defaults to the real Playwright-backed capture but is injectable so tests can
// supply a fixture-driven stand-in -- the same shape runDiagnosticsEvidenceCapture returns:
// [{ routeId, routePath, snapshots: { desktop, tablet, mobile } }, ...]. `citeSourceFiles` is passed
// straight through to runFindingEngine (findingEngine.mjs) -- omitted here, it falls back to
// findingEngine.mjs's own real Engineering Brain lookup; tests supply a fixture stand-in so a run
// doesn't depend on this repository's real, evolving index-manifest.json.
export async function runCli(argv, { captureDiagnostics = runDiagnosticsEvidenceCapture, citeSourceFiles } = {}) {
  const args = parseArgs(argv);
  if (!args.baseUrl || !args.evidenceDir) {
    throw new FindingEngineCliError("Usage: runFindingEngineCli.mjs --base-url <url> --evidence-dir <dir> [--route <routeId> ...] [--application <name>]");
  }

  const screenshotManifestPath = path.join(args.evidenceDir, "manifest.json");
  if (!existsSync(screenshotManifestPath)) {
    throw new FindingEngineCliError(`No screenshot-evidence manifest at "${screenshotManifestPath}". Run captureScreenshotEvidenceCli.mjs (FB-UI-1) against the same --evidence-dir first.`);
  }
  const screenshotManifest = JSON.parse(readFileSync(screenshotManifestPath, "utf8"));

  const diagnosticsByRoute = await captureDiagnostics({ baseUrl: args.baseUrl, routeIds: args.routeIds });

  const routeEvidenceList = diagnosticsByRoute.map((route) => {
    const screenshotHashes = {};
    for (const viewport of ["desktop", "tablet", "mobile"]) {
      const entry = screenshotManifest.entries.find((e) => e.routeId === route.routeId && e.viewport === viewport && e.kind === "full-page");
      if (!entry) throw new FindingEngineCliError(`No full-page screenshot evidence found for route "${route.routeId}" / viewport "${viewport}" in ${screenshotManifestPath}`);
      screenshotHashes[viewport] = entry.screenshotHash;
    }
    return {
      application: args.application || "409 Marketplace FORGE", routeId: route.routeId, routePath: route.routePath,
      snapshots: route.snapshots, screenshotHashes,
    };
  });

  const manifest = runFindingEngine(routeEvidenceList, citeSourceFiles ? { citeSourceFiles } : {});
  writeFileSync(path.join(args.evidenceDir, "findings-manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((manifest) => {
      console.log(`Wrote ${manifest.findings.length} findings to findings-manifest.json`);
      for (const finding of manifest.findings) {
        console.log(`  [${finding.severity}] ${finding.category} @ ${finding.routeId}/${finding.viewport} -> ${finding.affectedComponent || "(page-level)"}`);
      }
    })
    .catch((error) => {
      console.error(`Finding engine failed closed: ${error.name}: ${error.message}`);
      process.exitCode = 1;
    });
}
