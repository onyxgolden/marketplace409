#!/usr/bin/env node
/**
 * run-battery.js — standalone battery runner: `npm run battery`.
 * Runs all 120 frozen cases through the agent and compares structural
 * output against the independently-derived expectations. Every case is
 * executed three times; the three outputs must be byte-identical.
 * Exits nonzero on any mismatch.
 * Requires SCHED_APPROVED_ROOT (same trust gate as run-tests.js).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { normalize } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.SCHED_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing SCHED_APPROVED_ROOT — refusing to run");
  process.exit(3);
}

// S648A-005: authenticate ALL manifest-listed file BYTES (not just the
// manifest metadata) before importing src/index.js or reading the battery.
// Uses only node:fs / node:crypto — no untrusted code executes first.
{
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let bad = null;
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  } catch {
    bad = "corpus/manifest.json unreadable";
  }
  const files = manifest?.files ?? [];
  const seen = new Set();
  if (!bad) {
    for (const e of files) {
      const p = e?.path;
      if (
        typeof p !== "string" || p.length === 0 || p.startsWith("/") || p.includes("\\") ||
        normalize(p) !== p || p.startsWith("..") || p.includes("../") || seen.has(p)
      ) { bad = `bad manifest entry: ${String(p)}`; break; }
      seen.add(p);
      let bytes;
      try { bytes = readFileSync(join(ROOT, p)); } catch { bad = `missing pinned file: ${p}`; break; }
      if (sha(bytes) !== e.sha256) { bad = `hash mismatch: ${p}`; break; }
    }
  }
  if (!bad) {
    const walk = (dir, out = []) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
      }
      return out;
    };
    for (const sub of ["src", "tests", "runner", "fixtures", "corpus"]) {
      for (const p of walk(join(ROOT, sub))) {
        const rel = p.slice(ROOT.length + 1).replace(/\\/g, "/");
        if (rel === "corpus/manifest.json" || rel === "corpus/corpus_digest.txt") continue;
        if (!seen.has(rel)) { bad = `unlisted file: ${rel}`; break; }
      }
      if (bad) break;
    }
    for (const f of ["package.json", "README.md"]) {
      if (!seen.has(f)) { bad = `unlisted file: ${f}`; break; }
    }
  }
  if (!bad) {
    const digest = sha(JSON.stringify(manifest));
    if (digest !== APPROVED_ROOT) bad = `corpus digest mismatch: recomputed ${digest.slice(0, 16)}… vs approved ${APPROVED_ROOT.slice(0, 16)}…`;
  }
  if (bad) {
    console.error(`bootstrap: trust authentication failed — ${bad}`);
    process.exit(3);
  }
  console.log("bootstrap: trust authentication OK");
}

const { run, canonicalJson } = await import("../src/index.js");
// S648A-006: the official battery host routes through the guarded
// execution path, not synchronous run() directly.
const { runGuarded } = await import("../runner/run-guarded.js");
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
  // Three consecutive runs must be byte-identical. Each runs under the
  // external watchdog; a hung case settles as EXECUTION_TIMEOUT, not a
  // hung battery.
  const runs = [await runGuarded(c.task, c.context), await runGuarded(c.task, c.context), await runGuarded(c.task, c.context)];
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
