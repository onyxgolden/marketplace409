#!/usr/bin/env node
/**
 * run-battery.js — OFFICIAL battery entrypoint (behind the trust
 * bootstrap; imported only after the manifest digest is
 * authenticated). Runs every corpus/battery.json case 3 times through
 * the guarded launcher (runGuarded), requires the three runs to be
 * byte-identical (determinism), and compares the observed outcome
 * against the frozen expected outcome.
 *
 * Battery context is pure JSON data; the structural admission at the
 * launcher boundary rejects non-string transports before reflective
 * inspection, so no executable content can reach the runner.
 *
 * Exit 0: all 120 cases pass x3 with byte-identical runs.
 * Exit 1: any case fails (details to stdout).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuarded } from "../runner/run-guarded.js";
import { canonicalJson } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const battery = JSON.parse(readFileSync(join(HERE, "..", "corpus", "battery.json"), "utf8"));

const codesOf = (env) => (env.diagnostics ?? []).map((d) => d.code).sort();
const mismatchesOf = (env) => (env.report?.claim_comparisons ?? []).filter((c) => c.match === false).map((c) => c.name).sort();
const quarantinedOf = (env) => (env.quarantined_sources ?? []).map((q) => q.record_id).sort();
const setEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function checkCase(c) {
  const taskJson = JSON.stringify(c.task);
  const contextJson = JSON.stringify(c.context);
  const runs = [];
  for (let i = 0; i < 3; i++) {
    runs.push(await runGuarded(taskJson, contextJson));
  }
  const serialized = runs.map((r) => canonicalJson(r));
  if (!(serialized[0] === serialized[1] && serialized[1] === serialized[2])) {
    return `non-deterministic across 3 runs`;
  }
  const r = runs[0];
  const exp = c.expected;
  const problems = [];
  if (r.status !== exp.status) {
    problems.push(`status: got ${r.status}, want ${exp.status}`);
    return problems.join("; ");
  }
  if (r.report === null) {
    if (exp.classification !== undefined && exp.classification !== null) {
      problems.push(`report null but expected classification ${exp.classification}`);
    }
  } else {
    if (exp.classification !== undefined && r.report.test_result.classification !== exp.classification) {
      problems.push(`classification: got ${r.report.test_result.classification}, want ${exp.classification}`);
    }
    if (exp.verified_by !== undefined && r.report.provenance.verified_by !== exp.verified_by) {
      problems.push(`verified_by: got ${r.report.provenance.verified_by}, want ${exp.verified_by}`);
    }
  }
  if (exp.diagnostic_codes !== undefined && !setEq(codesOf(r), [...exp.diagnostic_codes].sort())) {
    problems.push(`diagnostics: got [${codesOf(r)}], want [${[...exp.diagnostic_codes].sort()}]`);
  }
  if (exp.mismatch_names !== undefined && !setEq(mismatchesOf(r), [...exp.mismatch_names].sort())) {
    problems.push(`mismatches: got [${mismatchesOf(r)}], want [${[...exp.mismatch_names].sort()}]`);
  }
  if (exp.quarantined_ids !== undefined && !setEq(quarantinedOf(r), [...exp.quarantined_ids].sort())) {
    problems.push(`quarantined: got [${quarantinedOf(r)}], want [${[...exp.quarantined_ids].sort()}]`);
  }
  return problems.length ? problems.join("; ") : null;
}

const failures = [];
for (const c of battery) {
  const problem = await checkCase(c);
  if (problem) failures.push(`${c.case_id} (${c.category}): ${problem}`);
}

const perCategory = {};
for (const c of battery) perCategory[c.category] = (perCategory[c.category] ?? 0) + 1;
console.log(`battery: ${battery.length} cases (${Object.entries(perCategory).map(([k, v]) => `${k} ${v}`).join(", ")}), 3 runs each`);
if (failures.length === 0) {
  console.log("BATTERY PASS: all 120 cases x3 byte-identical, outcomes match frozen expectations");
} else {
  console.log(`BATTERY FAIL: ${failures.length} failures`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
