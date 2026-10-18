#!/usr/bin/env node
/**
 * run-manual.js — manual host launcher (NOT part of the scored path).
 * Reads explicitly registered fixtures and saves reports to an explicit
 * scratch directory. The agent itself receives no filesystem capability.
 *
 * Usage: FIN_APPROVED_ROOT=<digest> node runner/run-manual.js <bundle> [outdir]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const { run, canonicalJson } = await import("../src/index.js");

const bundleName = process.argv[2] ?? "mixed-period";
const outdir = process.argv[3] ?? "/tmp/finance-manual";
mkdirSync(outdir, { recursive: true });

const ref = store.bundleRefs[bundleName];
if (!ref) {
  console.error(`unknown bundle: ${bundleName}`);
  process.exit(1);
}
const key = `${ref.repo}|${ref.path}`;
const chartKey = "fin-sources|chart/finance-chart-v1.md";
const n = JSON.parse(store.sources[key].revisions[ref.commit].text).length;

const task = {
  schema_version: "1",
  task_id: `manual-${bundleName}`,
  operation: "analyze",
  fixture_refs: { transaction_bundle: ref },
  options: {
    population: { declared_total: n, complete: true },
    period: { start_date: "2026-01-01", end_date: "2026-01-31", opening_balance_minor: "0", currency: "USD" },
    header_claims: {},
  },
};
const context = {
  clock: Date.now(),
  sources: { [chartKey]: store.sources[chartKey], [key]: store.sources[key] },
  readGrants: [
    { repo: "fin-sources", path: "chart/finance-chart-v1.md" },
    { repo: ref.repo, path: ref.path },
  ],
  principal: store.principals.jason,
  criteria: store.criteriaPresets.standard,
};

const result = run(task, context);
const out = join(outdir, `${bundleName}-report.json`);
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`status=${result.status} report -> ${out}`);
