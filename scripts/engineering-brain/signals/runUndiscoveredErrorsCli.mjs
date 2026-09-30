#!/usr/bin/env node
/**
 * runUndiscoveredErrorsCli.mjs — CLI for undiscovered-error detection from runtime signals.
 *
 * Pipeline:
 *   1. Collect signals (credentials at the edge, run separately):
 *        node scripts/engineering-brain/signals/fetchSupabaseSignals.mjs --out /tmp/signals-supabase.json
 *        python3 scripts/engineering-brain/signals/fetchGithubSignals.py --out /tmp/signals-github.json
 *   2. Merge the signal files if you use both fetchers (concatenate the `signals` arrays).
 *   3. Detect + report (pure, deterministic, no credentials):
 *        node scripts/engineering-brain/signals/runUndiscoveredErrorsCli.mjs --signals <signals.json> [--json]
 *
 * Usage:
 *   node scripts/engineering-brain/signals/runUndiscoveredErrorsCli.mjs \
 *     [--signals <runtime-signals.json>] [--manifest <index-manifest.json>] [--json]
 *
 * Exit codes: 0 = report written; 2 = bad arguments / unreadable inputs.
 */

import path from "node:path";
import { readFileSync } from "node:fs";

import { loadManifest } from "../query/loadManifest.mjs";
import { detectUndiscoveredErrors } from "./detectUndiscoveredErrors.mjs";

const DEFAULT_MANIFEST_PATH = path.join("engineering-brain", "index-manifest.json");
const DEFAULT_SIGNALS_PATH = path.join("engineering-brain", "runtime-signals.json");

function parseArgs(argv) {
  const args = { manifestPath: DEFAULT_MANIFEST_PATH, signalsPath: DEFAULT_SIGNALS_PATH, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") args.manifestPath = argv[++i];
    else if (arg === "--signals") args.signalsPath = argv[++i];
    else if (arg === "--json") args.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function loadSignals(signalsPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(signalsPath, "utf8"));
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed.signals) ? parsed.signals : [];
}

function renderText(report) {
  const lines = [];
  lines.push("Undiscovered errors from runtime signals");
  lines.push(`  signals scanned: ${report.signal_count}, distinct errors: ${report.error_count}`);
  lines.push("");
  if (report.error_count === 0) {
    lines.push("No runtime signals indicate an undiscovered error.");
    return lines.join("\n");
  }
  for (const error of report.errors) {
    lines.push(`[${error.severity.toUpperCase()}] ${error.title}  (x${error.signal_count})`);
    lines.push(`  first seen: ${error.first_seen || "unknown"}, last seen: ${error.last_seen || "unknown"}`);
    if (error.failure_reasons.length > 0) {
      lines.push(`  failure reasons: ${error.failure_reasons.join(" | ")}`);
    }
    if (error.implicated_code.length > 0) {
      lines.push("  implicated code:");
      for (const code of error.implicated_code) {
        const symbol = code.symbol_or_section ? ` (${code.symbol_or_section})` : "";
        lines.push(`    - ${code.source_path}${symbol}`);
      }
    }
    lines.push(`  investigate: npm run forge:diagnose -- "${error.diagnose_query}"`);
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }

  let manifest;
  try {
    manifest = loadManifest(args.manifestPath);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }

  const signals = loadSignals(args.signalsPath);
  const report = detectUndiscoveredErrors({ signals, manifestRecords: manifest.records });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderText(report));
  }
}

main();
