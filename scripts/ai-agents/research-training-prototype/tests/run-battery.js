#!/usr/bin/env node
/**
 * run-battery.js — OFFICIAL battery entrypoint (behind the trust
 * bootstrap; imported only after the manifest digest is
 * authenticated). Runs every corpus/battery.json case 3 times through
 * the guarded launcher (runGuarded), requires the three runs to be
 * byte-identical (determinism), and compares the observed outcome
 * against the frozen expected outcome:
 *
 *   status           envelope status
 *   quizzes          report.quizzes item ids, "q-" prefix stripped
 *   composites       report.composites item ids
 *   gaps             report.gaps topic ids
 *   rejected_codes   report.rejected_keys codes
 *   contradictions   report.contradiction_notes key labels
 *   quarantined      quarantined_sources record ids
 *   diagnostics      envelope diagnostic codes
 *
 * Well-formed case expectations were derived by corpus/oracle.js, the
 * INDEPENDENT reference implementation (it imports nothing from the
 * candidate); malformed/budget cases carry hard-coded expectations.
 *
 * Battery context is pure JSON data; the structural admission at the
 * launcher boundary rejects non-string transports before reflective
 * inspection, so no executable content can reach the runner.
 *
 * Exit 0: all cases pass x3 with byte-identical runs.
 * Exit 1: any case fails (details to stdout).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuarded } from "../runner/run-guarded.js";
import { canonicalJson } from "../src/canonical.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const batteryFile = JSON.parse(readFileSync(join(HERE, "..", "corpus", "battery.json"), "utf8"));
const battery = batteryFile.cases;

const diagCodesOf = (env) => (env.diagnostics ?? []).map((d) => d.code).sort();
const quizzesOf = (env) => (env.report?.quizzes ?? []).map((q) => q.item_id.replace(/^q-/, "")).sort();
const compositesOf = (env) => (env.report?.composites ?? []).map((c) => c.item_id).sort();
const gapsOf = (env) => (env.report?.gaps ?? []).map((g) => g.topic_id).sort();
const rejectedOf = (env) => (env.report?.rejected_keys ?? []).map((k) => k.code).sort();
const contradictionsOf = (env) => (env.report?.contradiction_notes ?? []).map((n) => n.key).sort();
const quarantinedOf = (env) => (env.quarantined_sources ?? []).map((q) => q.record_id).sort();
const setEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const cmp = (label, got, want, problems) => {
  const w = [...want].sort();
  if (!setEq(got, w)) problems.push(`${label}: got [${got.join(", ")}], want [${w.join(", ")}]`);
};

async function checkCase(c) {
  const taskJson = JSON.stringify(c.task);
  const contextJson = JSON.stringify(c.context);
  const runs = [];
  for (let i = 0; i < 3; i++) {
    runs.push(await runGuarded(taskJson, contextJson));
  }
  const serialized = runs.map((r) => canonicalJson(r));
  if (!(serialized[0] === serialized[1] && serialized[1] === serialized[2])) {
    return "non-deterministic across 3 runs";
  }
  const r = runs[0];
  const exp = c.expected;
  const problems = [];
  if (r.status !== exp.status) {
    problems.push(`status: got ${r.status}, want ${exp.status}`);
    return problems.join("; ");
  }
  if (exp.diagnostics !== undefined) cmp("diagnostics", diagCodesOf(r), exp.diagnostics, problems);
  if (exp.quizzes !== undefined) cmp("quizzes", quizzesOf(r), exp.quizzes, problems);
  if (exp.composites !== undefined) cmp("composites", compositesOf(r), exp.composites, problems);
  if (exp.gaps !== undefined) cmp("gaps", gapsOf(r), exp.gaps, problems);
  if (exp.rejected_codes !== undefined) cmp("rejected", rejectedOf(r), exp.rejected_codes, problems);
  if (exp.contradictions !== undefined) cmp("contradictions", contradictionsOf(r), exp.contradictions, problems);
  if (exp.quarantined !== undefined) cmp("quarantined", quarantinedOf(r), exp.quarantined, problems);
  return problems.length ? problems.join("; ") : null;
}

const failures = [];
for (const c of battery) {
  const problem = await checkCase(c);
  if (problem) failures.push(`${c.id} (${c.kind}): ${problem}`);
}

const perCategory = {};
for (const c of battery) perCategory[c.kind] = (perCategory[c.kind] ?? 0) + 1;
console.log(`battery: ${battery.length} cases (${Object.entries(perCategory).map(([k, v]) => `${k} ${v}`).join(", ")}), 3 runs each`);
if (failures.length === 0) {
  console.log(`BATTERY PASS: all ${battery.length} cases x3 byte-identical, outcomes match frozen expectations`);
} else {
  console.log(`BATTERY FAIL: ${failures.length} failures`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
