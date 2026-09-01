#!/usr/bin/env node
// FB-UI-1 CLI entry point. Owner-invoked only -- there is no HTTP route, no scheduled workflow, and
// no code path anywhere that calls runScreenshotEvidenceCapture automatically. Usage:
//
//   node scripts/ui-improvement-manager/screenshot-evidence/captureScreenshotEvidenceCli.mjs \
//     --base-url http://localhost:3000 --route home --route forge-financial-overview \
//     --output-dir ui-improvement-manager/evidence/<run-id>
//
// --base-url must classify as "local" or "preview" (hostAllowlist.mjs) or this refuses to run.
// An authenticated route (e.g. forge-financial-overview) additionally requires
// FB_UI_PREVIEW_STORAGE_STATE_PATH to point at a fresh (<=1h old) Playwright storageState.json for a
// seeded synthetic test user -- see previewSession.mjs. Never pass or store a real password.

import { runScreenshotEvidenceCapture } from "./captureScreenshotEvidence.mjs";

function parseArgs(argv) {
  const args = { routeIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--base-url") args.baseUrl = argv[++i];
    else if (flag === "--route") args.routeIds.push(argv[++i]);
    else if (flag === "--output-dir") args.outputDir = argv[++i];
    else if (flag === "--commit") args.commit = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl) {
    console.error("Usage: captureScreenshotEvidenceCli.mjs --base-url <url> [--route <routeId> ...] [--output-dir <dir>] [--commit <sha>]");
    process.exitCode = 1;
    return;
  }
  const commit = args.commit || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (!commit) {
    console.error("No --commit provided and no GITHUB_SHA/VERCEL_GIT_COMMIT_SHA env var found. Pass --commit <sha> explicitly.");
    process.exitCode = 1;
    return;
  }

  try {
    const manifest = await runScreenshotEvidenceCapture({
      baseUrl: args.baseUrl,
      routeIds: args.routeIds,
      outputDir: args.outputDir,
      commit,
    });
    console.log(`Captured ${manifest.entries.length} screenshot evidence entries.`);
    for (const entry of manifest.entries) {
      console.log(`  ${entry.routeId} / ${entry.viewport} / ${entry.kind}${entry.componentName ? ` (${entry.componentName})` : ""} -> ${entry.screenshotHash}`);
    }
  } catch (error) {
    console.error(`Screenshot evidence capture failed closed: ${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
