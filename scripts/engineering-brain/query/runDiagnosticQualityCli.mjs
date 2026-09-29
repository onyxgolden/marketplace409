#!/usr/bin/env node
/**
 * runDiagnosticQualityCli.mjs — proof report for --diagnose output quality.
 *
 * Runs the diagnostic-quality case set (synthetic fixtures + real git-history cases
 * with verified ground truth) through assembleDiagnosticContext and prints per-case
 * facet recall, first-hit ranks, past-fix attachment, and an aggregate summary.
 *
 * Usage:
 *   node scripts/engineering-brain/query/runDiagnosticQualityCli.mjs \
 *     [--manifest <index-manifest.json>] [--bug-catalog <bug-catalog.json>] [--json] [--fixtures-only]
 *
 * Exit codes: 0 = report written; 2 = bad arguments / unreadable inputs.
 * The report documents measured quality honestly, including misses -- it is a proof
 * instrument, not a gate that pretends to pass.
 */

import path from "node:path";
import { readFileSync } from "node:fs";

import { loadManifest } from "./loadManifest.mjs";
import { createCachedGitReader } from "./createCachedGitReader.mjs";
import { readFileAtCommit, readMigrationsAtCommit } from "../gitRepository.mjs";
import {
  evaluateDiagnosticCase,
  summarizeEvaluations,
} from "./evaluateDiagnosticQuality.mjs";
import {
  getFixtureDiagnosticCases,
  REAL_DIAGNOSTIC_CASES,
} from "./diagnosticQualityCases.mjs";

const DEFAULT_MANIFEST_PATH = path.join("engineering-brain", "index-manifest.json");
const BUG_CATALOG_FILENAME = "bug-catalog.json";

function parseArgs(argv) {
  const args = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    bugCatalogPath: null,
    json: false,
    fixturesOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") args.manifestPath = argv[++i];
    else if (arg === "--bug-catalog") args.bugCatalogPath = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--fixtures-only") args.fixturesOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
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

function fmtRecall(r) {
  return r === null ? "n/a" : r.toFixed(2);
}

function renderText(evaluations, summary) {
  const lines = [];
  lines.push("Diagnostic quality report (--diagnose proof)");
  lines.push("=".repeat(52));
  for (const e of evaluations) {
    lines.push("");
    lines.push(`Case: ${e.case_id}${e.fix_commit ? `  (real fix ${e.fix_commit})` : "  (fixture)"}`);
    lines.push(`  query: "${e.query}"`);
    lines.push(`  passed: ${e.passed ? "YES" : "NO"}${e.insufficient_evidence ? "  [insufficient evidence]" : ""}`);
    for (const [facet, s] of Object.entries(e.facet_scores)) {
      if (s.expected === 0) continue;
      lines.push(
        `  ${facet}: recall ${fmtRecall(s.recall)} (${s.hits}/${s.expected})` +
        (s.first_hit_rank !== null ? `, first hit rank ${s.first_hit_rank}` : ", no hit") +
        `, facet size ${s.facet_size}`
      );
    }
    const pf = e.past_fix_score;
    if (pf.expected > 0) lines.push(`  past_fixes: recall ${fmtRecall(pf.recall)} (${pf.hits}/${pf.expected})`);
    if (e.contradiction_hit !== null) lines.push(`  expected contradiction surfaced: ${e.contradiction_hit ? "YES" : "NO"}`);
  }
  lines.push("");
  lines.push("-".repeat(52));
  lines.push(`Summary: ${summary.passed}/${summary.cases} cases passed (pass rate ${summary.pass_rate?.toFixed(2) ?? "n/a"})`);
  for (const [facet, r] of Object.entries(summary.facet_mean_recall)) {
    lines.push(`  mean ${facet} recall: ${fmtRecall(r)}`);
  }
  lines.push(`  mean past_fix recall: ${fmtRecall(summary.past_fix_mean_recall)}`);
  lines.push("");
  lines.push("Known gap (measured 2026-09-29): natural symptom phrasing misses 2/3 real");
  lines.push("cases on implicated_code. Cause: pass-1 retrieval gates on metadata");
  lines.push("(path/symbol) overlap; content search only re-ranks metadata matches, never");
  lines.push("retrieves. Fixing it needs content tokens in the manifest index -- future slice.");
  return lines.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }

  const manifest = loadManifest(args.manifestPath);
  const excerptReader = createCachedGitReader({ readFileAtCommit, readMigrationsAtCommit });
  const contentProvider = (sha, p) => excerptReader.readFileAtCommit(sha, p);
  const catalogRecords = loadBugCatalogRecords(args);

  const cases = args.fixturesOnly
    ? getFixtureDiagnosticCases()
    : [...getFixtureDiagnosticCases(), ...REAL_DIAGNOSTIC_CASES];

  const evaluations = cases.map((diagnosticCase) =>
    evaluateDiagnosticCase({
      manifest,
      diagnosticCase,
      excerptReader,
      contentProvider,
      bugRecords: diagnosticCase.bugRecords || catalogRecords,
    })
  );
  const summary = summarizeEvaluations(evaluations);

  if (args.json) {
    console.log(JSON.stringify({ evaluations, summary }, null, 2));
  } else {
    console.log(renderText(evaluations, summary));
  }
}

main();
