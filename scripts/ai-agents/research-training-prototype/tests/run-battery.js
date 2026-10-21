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
 * PER-008 round 2: the four hostile cases (H01..H04) carry a
 * {base, transform} reference instead of JSON task/context — native
 * Proxies and inherited getters cannot survive serialization. The
 * runner clones the base case in-process, applies the hostile
 * transform, and runs it through run() 3x (in-process only:
 * executable fixtures cannot cross the JSON guarded transport).
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
const byId = new Map(battery.map((c) => [c.id, c]));
const { run } = await import("../src/index.js");

/**
 * PER-008 round 2 hostile transforms. Each takes the CLONED base
 * task/context and an instrumented counters object, and installs one
 * hostile fixture IN-PROCESS (native Proxy or inherited getter).
 * These fixtures cannot cross the JSON guarded transport — so
 * hostile cases run through run() in-process, 3x, byte-identical.
 * Attempting to JSON-serialize them would fire the getters/traps in
 * the harness, which is exactly what the agent must never do.
 */
const HOSTILE = {
  "inherited-principal-getter"(task, context, counters) {
    const pid = context.principal.principal_id;
    const proto = { ...context.principal };
    Object.defineProperty(proto, "principal_id", {
      enumerable: true,
      get() { counters.getter_calls = (counters.getter_calls ?? 0) + 1; return pid; },
    });
    context.principal = Object.create(proto);
  },
  "inherited-revisions-getter"(task, context, counters) {
    const key = Object.keys(context.sources)[0];
    const entry = context.sources[key];
    const prot = {};
    Object.defineProperty(prot, "revisions", {
      enumerable: true,
      get() { counters.getter_calls = (counters.getter_calls ?? 0) + 1; return entry.revisions; },
    });
    context.sources[key] = Object.create(prot);
  },
  "nested-applies-to-proxy"(task, context, counters) {
    const key = Object.keys(context.provenance.sources)[0];
    const arr = context.provenance.sources[key].applies_to;
    context.provenance.sources[key].applies_to = new Proxy(arr, {
      get(t, k, r) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.get(t, k, r); },
      getOwnPropertyDescriptor(t, k) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.getOwnPropertyDescriptor(t, k); },
    });
  },
  "nested-pin-proxy"(task, context, counters) {
    const key = Object.keys(context.provenance.sources)[0];
    const pin = context.provenance.sources[key].applies_to[0];
    context.provenance.sources[key].applies_to[0] = new Proxy(pin, {
      get(t, k, r) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.get(t, k, r); },
      getOwnPropertyDescriptor(t, k) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.getOwnPropertyDescriptor(t, k); },
    });
  },
};

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
  // PER-008 round 2: hostile cases run in-process through run()
  // (3x, byte-identical). The base case is cloned fresh, the
  // hostile transform applied, and the instrumented counters must
  // stay at zero — proving no user code executed during admission.
  if (c.hostile) {
    const base = byId.get(c.hostile.base);
    const xf = HOSTILE[c.hostile.transform];
    if (!base || !base.task || !xf) return `hostile base/transform does not resolve: ${JSON.stringify(c.hostile)}`;
    const task = structuredClone(base.task);
    const context = structuredClone(base.context);
    const counters = {};
    xf(task, context, counters);
    const runs = [run(task, context), run(task, context), run(task, context)];
    const serialized = runs.map((r) => canonicalJson(r));
    if (!(serialized[0] === serialized[1] && serialized[1] === serialized[2])) {
      return "non-deterministic across 3 runs";
    }
    const r = runs[0];
    const problems = [];
    if (r.status !== c.expected.status) {
      return `status: got ${r.status}, want ${c.expected.status}`;
    }
    if (c.expected.diagnostics !== undefined) cmp("diagnostics", diagCodesOf(r), c.expected.diagnostics, problems);
    for (const k of c.hostile.expect_zero ?? []) {
      if ((counters[k] ?? 0) !== 0) problems.push(`instrumented counter '${k}' fired ${counters[k]}x (must stay zero)`);
    }
    return problems.length ? problems.join("; ") : null;
  }
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
