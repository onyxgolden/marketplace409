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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runDiagnosticsEvidenceCapture } from "./captureDiagnosticsEvidence.mjs";
import { runFindingEngine } from "./findingEngine.mjs";

function parseArgs(argv) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl || !args.evidenceDir) {
    console.error("Usage: runFindingEngineCli.mjs --base-url <url> --evidence-dir <dir> [--route <routeId> ...] [--application <name>]");
    process.exitCode = 1;
    return;
  }

  const screenshotManifestPath = path.join(args.evidenceDir, "manifest.json");
  if (!existsSync(screenshotManifestPath)) {
    console.error(`No screenshot-evidence manifest at "${screenshotManifestPath}". Run captureScreenshotEvidenceCli.mjs (FB-UI-1) against the same --evidence-dir first.`);
    process.exitCode = 1;
    return;
  }
  const screenshotManifest = JSON.parse(readFileSync(screenshotManifestPath, "utf8"));

  try {
    const diagnosticsByRoute = await runDiagnosticsEvidenceCapture({ baseUrl: args.baseUrl, routeIds: args.routeIds });

    const routeEvidenceList = diagnosticsByRoute.map((route) => {
      const screenshotHashes = {};
      for (const viewport of ["desktop", "tablet", "mobile"]) {
        const entry = screenshotManifest.entries.find((e) => e.routeId === route.routeId && e.viewport === viewport && e.kind === "full-page");
        if (!entry) throw new Error(`No full-page screenshot evidence found for route "${route.routeId}" / viewport "${viewport}" in ${screenshotManifestPath}`);
        screenshotHashes[viewport] = entry.screenshotHash;
      }
      return {
        application: args.application || "409 Marketplace FORGE", routeId: route.routeId, routePath: route.routePath,
        snapshots: route.snapshots, screenshotHashes,
      };
    });

    const manifest = runFindingEngine(routeEvidenceList);
    writeFileSync(path.join(args.evidenceDir, "findings-manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`Wrote ${manifest.findings.length} findings to ${args.evidenceDir}/findings-manifest.json`);
    for (const finding of manifest.findings) {
      console.log(`  [${finding.severity}] ${finding.category} @ ${finding.routeId}/${finding.viewport} -> ${finding.affectedComponent || "(page-level)"}`);
    }
  } catch (error) {
    console.error(`Finding engine failed closed: ${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
