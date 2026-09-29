#!/usr/bin/env node
/**
 * runUndiscoveredRisksCli.mjs — CLI for the undiscovered-error scan.
 *
 * Usage:
 *   node scripts/engineering-brain/query/runUndiscoveredRisksCli.mjs \
 *     [--manifest <index-manifest.json>] [--bug-catalog <bug-catalog.json>] \
 *     [--top-hotspots <n>] [--json]
 *
 * Exit codes: 0 = report written; 2 = bad arguments / unreadable inputs.
 */

import path from "node:path";
import { readFileSync } from "node:fs";

import { loadManifest } from "./loadManifest.mjs";
import { findUndiscoveredRisks } from "./findUndiscoveredRisks.mjs";

const DEFAULT_MANIFEST_PATH = path.join("engineering-brain", "index-manifest.json");
const BUG_CATALOG_FILENAME = "bug-catalog.json";

function parseArgs(argv) {
  const args = { manifestPath: DEFAULT_MANIFEST_PATH, bugCatalogPath: null, topHotspots: 20, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") args.manifestPath = argv[++i];
    else if (arg === "--bug-catalog") args.bugCatalogPath = argv[++i];
    else if (arg === "--top-hotspots") args.topHotspots = Number(argv[++i]);
    else if (arg === "--json") args.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.topHotspots) || args.topHotspots < 0) {
    throw new Error("--top-hotspots must be a non-negative number");
  }
  return args;
}

function loadBugCatalogRecords({ manifestPath, bugCatalogPath }) {
  const catalogPath = bugCatalogPath || path.join(path.dirname(manifestPath), BUG_CATALOG_FILENAME);
  try {
    const parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function renderText(report) {
  const lines = [];
  lines.push("Undiscovered-risk scan");
  lines.push(`  manifest records: ${report.counts.manifestRecords}, bug records: ${report.counts.bugRecords}`);
  lines.push("");
  lines.push(`Fix hotspots (${report.hotspots.length}):`);
  for (const hotspot of report.hotspots) {
    lines.push(`  ${hotspot.fixCount}x  ${hotspot.path}  (latest ${String(hotspot.latestFix).slice(0, 10)})`);
    for (const subject of hotspot.recentSubjects) {
      lines.push(`      - ${subject}`);
    }
  }
  lines.push("");
  lines.push(`Untested sources (${report.untestedSources.length}):`);
  for (const source of report.untestedSources.slice(0, 50)) {
    lines.push(`  ${source.symbolCount} symbols  ${source.path}`);
  }
  if (report.untestedSources.length > 50) {
    lines.push(`  ... and ${report.untestedSources.length - 50} more (see --json)`);
  }
  lines.push("");
  lines.push(`Latent conflicts (${report.latentConflicts.length}):`);
  for (const conflict of report.latentConflicts) {
    lines.push(`  ${conflict.subject}: ${conflict.winner.authority_level} wins (${conflict.winner.source_path})`);
    for (const outranked of conflict.outranked) {
      lines.push(`      outranked: ${outranked.authority_level} (${outranked.source_path})`);
    }
  }
  return lines.join("\n");
}

export function runRisksCli(argv, { cwd = process.cwd() } = {}) {
  const args = parseArgs(argv);
  const manifestPath = path.isAbsolute(args.manifestPath) ? args.manifestPath : path.join(cwd, args.manifestPath);
  const manifest = loadManifest(manifestPath);
  const bugCatalogPath = args.bugCatalogPath
    || path.join(path.dirname(manifestPath), BUG_CATALOG_FILENAME);
  const bugRecords = loadBugCatalogRecords({ manifestPath, bugCatalogPath });
  const report = findUndiscoveredRisks({
    manifestRecords: manifest.records,
    bugRecords,
    topHotspots: args.topHotspots,
  });
  return args.json ? JSON.stringify(report, null, 2) : renderText(report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(runRisksCli(process.argv.slice(2)));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 2;
  }
}
