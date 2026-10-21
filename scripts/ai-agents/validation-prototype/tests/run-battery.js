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
 * PER-008 round 2: the three hostile_admission cases (H01..H03)
 * carry a {base, transform} reference instead of JSON task/context —
 * native Proxies and inherited getters cannot survive serialization.
 * The runner clones the base case in-process, applies the hostile
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
import { canonicalJson } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const battery = JSON.parse(readFileSync(join(HERE, "..", "corpus", "battery.json"), "utf8"));
const byId = new Map(battery.map((c) => [c.case_id, c]));
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
  "nested-pin-proxy"(task, context, counters) {
    const key = Object.keys(context.provenance_registry)[0];
    const pin = context.provenance_registry[key].implementation_ref;
    context.provenance_registry[key].implementation_ref = new Proxy(pin, {
      get(t, k, r) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.get(t, k, r); },
      getOwnPropertyDescriptor(t, k) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.getOwnPropertyDescriptor(t, k); },
    });
  },
};

const codesOf = (env) => (env.diagnostics ?? []).map((d) => d.code).sort();
const mismatchesOf = (env) => (env.report?.claim_comparisons ?? []).filter((c) => c.match === false).map((c) => c.name).sort();
const quarantinedOf = (env) => (env.quarantined_sources ?? []).map((q) => q.record_id).sort();
const setEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

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
      return `non-deterministic across 3 runs`;
    }
    const r = runs[0];
    const problems = [];
    if (r.status !== c.expected.status) {
      return `status: got ${r.status}, want ${c.expected.status}`;
    }
    if (c.expected.diagnostic_codes !== undefined && !setEq(codesOf(r), [...c.expected.diagnostic_codes].sort())) {
      problems.push(`diagnostics: got [${codesOf(r)}], want [${[...c.expected.diagnostic_codes].sort()}]`);
    }
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
  console.log(`BATTERY PASS: all ${battery.length} cases x3 byte-identical, outcomes match frozen expectations`);
} else {
  console.log(`BATTERY FAIL: ${failures.length} failures`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
