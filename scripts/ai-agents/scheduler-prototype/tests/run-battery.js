#!/usr/bin/env node
/**
 * run-battery.js — standalone battery runner: `npm run battery`.
 * Runs all 120 frozen cases through the agent and compares structural
 * output against the independently-derived expectations. Every case is
 * executed three times; the three outputs must be byte-identical.
 * Exits nonzero on any mismatch.
 * Requires SCHED_APPROVED_ROOT (same trust gate as run-tests.js).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.SCHED_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing SCHED_APPROVED_ROOT — refusing to run");
  process.exit(3);
}
{
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  if (digest !== APPROVED_ROOT) {
    console.error("bootstrap: corpus digest mismatch — refusing to run");
    process.exit(3);
  }
}

const { run, canonicalJson } = await import("../src/index.js");
const CASES = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));

let pass = 0;
let fail = 0;
const failures = [];

function check(caseId, cond, label, actual) {
  if (!cond) {
    fail++;
    failures.push(`${caseId}: ${label} (actual: ${JSON.stringify(actual)?.slice(0, 300)})`);
    return false;
  }
  return true;
}

const ACT_FIELDS = ["id", "es", "ef", "ls", "lf", "total_float", "critical", "civil_start", "civil_finish_boundary"];
function actKey(a) {
  return ACT_FIELDS.map((f) => `${f}=${JSON.stringify(a[f])}`).join("|");
}

for (const c of CASES) {
  const exp = c.expected;
  // Three consecutive runs must be byte-identical.
  const runs = [run(c.task, c.context), run(c.task, c.context), run(c.task, c.context)];
  const bytes = runs.map((r) => canonicalJson(r));
  let ok = check(c.case_id, bytes[0] === bytes[1] && bytes[1] === bytes[2], "three runs byte-identical", false);
  const result = runs[0];

  ok = check(c.case_id, result.status === exp.status, `status expected ${exp.status}`, result.status) && ok;

  const codes = new Set((result.diagnostics ?? []).map((d) => d.code));
  for (const want of exp.diagnostic_codes ?? []) {
    ok = check(c.case_id, codes.has(want), `diagnostic ${want}`, [...codes]) && ok;
  }

  const actualComps = result.report?.components ?? [];
  ok = check(c.case_id, actualComps.length === (exp.components ?? []).length, `component count ${(exp.components ?? []).length}`, actualComps.length) && ok;
  for (let i = 0; i < (exp.components ?? []).length && i < actualComps.length; i++) {
    const e = exp.components[i];
    const a = actualComps[i];
    ok = check(c.case_id, a.component_id === e.component_id, `component[${i}] id ${e.component_id}`, a.component_id) && ok;
    ok = check(c.case_id, a.status === e.status, `component ${e.component_id} status ${e.status}`, a.status) && ok;
    const eActs = e.activities ?? [];
    const aActs = a.activities ?? [];
    ok = check(c.case_id, aActs.length === eActs.length, `component ${e.component_id} activity count ${eActs.length}`, aActs.length) && ok;
    for (let j = 0; j < eActs.length && j < aActs.length; j++) {
      ok = check(c.case_id, actKey(aActs[j]) === actKey(eActs[j]), `activity ${eActs[j].id}`, actKey(aActs[j])) && ok;
    }
    ok = check(c.case_id, JSON.stringify(a.critical_subgraph.activities) === JSON.stringify(e.critical_activities ?? []), `critical activities`, a.critical_subgraph.activities) && ok;
    ok = check(c.case_id, JSON.stringify(a.critical_subgraph.edges) === JSON.stringify(e.critical_edges ?? []), `critical edges`, a.critical_subgraph.edges) && ok;
  }

  const actualClaims = (result.report?.claimed_comparisons ?? []).map((x) => x.evidence_state);
  ok = check(c.case_id, JSON.stringify(actualClaims) === JSON.stringify(exp.claimed_states ?? []), `claimed states ${JSON.stringify(exp.claimed_states ?? [])}`, actualClaims) && ok;

  const actualQ = new Set((result.quarantined_sources ?? []).map((x) => x.record_id));
  const expQ = new Set(exp.quarantined_ids ?? []);
  ok = check(c.case_id, actualQ.size === expQ.size && [...expQ].every((x) => actualQ.has(x)), `quarantined ${JSON.stringify([...expQ])}`, [...actualQ]) && ok;

  ok = check(c.case_id, result.report?.coverage?.state === exp.coverage_state, `coverage ${exp.coverage_state}`, result.report?.coverage?.state) && ok;

  if (ok) pass++;
}

console.log(`battery: ${pass}/${CASES.length} pass, ${fail} assertion failures`);
if (failures.length > 0) {
  console.log("failures:");
  for (const f of failures.slice(0, 30)) console.log(`  ${f}`);
  process.exit(1);
}
