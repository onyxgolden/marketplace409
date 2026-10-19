#!/usr/bin/env node
/**
 * run-manual.js — manual host launcher (NOT part of the scored path).
 * Reads explicitly registered fixtures and saves reports to an explicit
 * scratch directory. The agent itself receives no filesystem capability.
 *
 * Usage: SCHED_APPROVED_ROOT=<digest> node runner/run-manual.js <network> [outdir]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const { run, canonicalJson } = await import("../src/index.js");

const networkName = process.argv[2] ?? "fs-chain";
const outdir = process.argv[3] ?? "/tmp/scheduler-manual";
mkdirSync(outdir, { recursive: true });

const ref = store.bundleRefs[networkName];
if (!ref) {
  console.error(`unknown network: ${networkName}`);
  process.exit(1);
}
const key = `${ref.repo}|${ref.path}`;
const n = JSON.parse(store.sources[key].revisions[ref.commit].text).length;

const task = {
  schema_version: "1",
  task_id: `manual-${networkName}`,
  operation: "analyze",
  fixture_refs: { network_bundle: ref },
  options: {
    population: { declared_total: n, complete: true },
    anchors: { c1: "2026-01-05", c2: "2026-01-05" },
    horizon_days: 60,
    deadlines: {},
    constraints: [],
    claimed: {},
  },
};
const context = {
  clock: Date.now(),
  sources: { [key]: store.sources[key] },
  readGrants: [{ repo: ref.repo, path: ref.path }],
  principal: store.principals.jason,
  criteria: store.criteriaPresets.standard,
};

const result = run(task, context);
const out = join(outdir, `${networkName}-report.json`);
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`status=${result.status} report -> ${out}`);
