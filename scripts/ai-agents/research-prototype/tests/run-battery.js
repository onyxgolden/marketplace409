#!/usr/bin/env node
/**
 * run-battery.js — standalone battery runner: `npm run battery`.
 * Runs all 124 frozen cases through the agent and compares structural
 * output against the independently-derived expectations. Every case is
 * executed three times; the three outputs must be byte-identical.
 * Exits nonzero on any mismatch.
 * Requires RESEARCH_APPROVED_ROOT (same trust gate as run-tests.js).
 *
 * PER-008 round 2: the four hostile_admission cases (hst-001..004)
 * carry a {base, transform} reference instead of JSON task/context —
 * native Proxies and inherited getters cannot survive serialization.
 * The runner clones the base case in-process, applies the hostile
 * transform, and runs it through run() 3x (in-process only:
 * executable fixtures cannot cross the JSON guarded transport).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { normalize } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.RESEARCH_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing RESEARCH_APPROVED_ROOT — refusing to run");
  process.exit(3);
}

// Authenticate ALL manifest-listed file BYTES (not just the manifest
// metadata) before importing src/index.js or reading the battery.
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

const { canonicalJson } = await import("../src/index.js");
// The official battery host routes through the guarded execution path,
// not synchronous run() directly.
const { runGuarded } = await import("../runner/run-guarded.js");
const { run } = await import("../src/index.js");
const CASES = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
const byId = new Map(CASES.map((c) => [c.case_id, c]));

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
    const key = Object.keys(context.provenance_registry)[0];
    const arr = context.provenance_registry[key].applies_to;
    context.provenance_registry[key].applies_to = new Proxy(arr, {
      get(t, k, r) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.get(t, k, r); },
      getOwnPropertyDescriptor(t, k) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.getOwnPropertyDescriptor(t, k); },
    });
  },
  "nested-derivation-link-proxy"(task, context, counters) {
    const key = Object.keys(context.provenance_registry).find((k) => (context.provenance_registry[k].derivation_links ?? []).length > 0)
      ?? Object.keys(context.provenance_registry)[0];
    const arr = context.provenance_registry[key].derivation_links ?? [];
    context.provenance_registry[key].derivation_links = new Proxy(arr, {
      get(t, k, r) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.get(t, k, r); },
      getOwnPropertyDescriptor(t, k) { counters.traps = (counters.traps ?? 0) + 1; return Reflect.getOwnPropertyDescriptor(t, k); },
    });
  },
};

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

for (const c of CASES) {
  const exp = c.expected;
  let result;
  let ok = true;
  if (c.hostile) {
    // PER-008 round 2: hostile cases run in-process through run()
    // (3x, byte-identical). The base case is cloned fresh, the
    // hostile transform applied, and the instrumented counters must
    // stay at zero — proving no user code executed during admission.
    const base = byId.get(c.hostile.base);
    if (!base || !base.task || !HOSTILE[c.hostile.transform]) {
      check(c.case_id, false, "hostile base/transform resolves", c.hostile);
      continue;
    }
    const task = structuredClone(base.task);
    const context = structuredClone(base.context);
    const counters = {};
    HOSTILE[c.hostile.transform](task, context, counters);
    const runs = [run(task, context), run(task, context), run(task, context)];
    const bytes = runs.map((r) => canonicalJson(r));
    ok = check(c.case_id, bytes[0] === bytes[1] && bytes[1] === bytes[2], "three runs byte-identical", false) && ok;
    result = runs[0];
    for (const k of c.hostile.expect_zero ?? []) {
      ok = check(c.case_id, (counters[k] ?? 0) === 0, `instrumented counter '${k}' stays zero`, counters[k] ?? 0) && ok;
    }
  } else {
    // Three consecutive runs must be byte-identical. Each runs under the
    // external watchdog; a hung case settles as EXECUTION_TIMEOUT, not a
    // hung battery. The guarded transport takes serialized JSON strings
    // (inert); stringify once per case.
    const taskJson = JSON.stringify(c.task);
    const contextJson = JSON.stringify(c.context);
    const runs = [await runGuarded(taskJson, contextJson), await runGuarded(taskJson, contextJson), await runGuarded(taskJson, contextJson)];
    const bytes = runs.map((r) => canonicalJson(r));
    ok = check(c.case_id, bytes[0] === bytes[1] && bytes[1] === bytes[2], "three runs byte-identical", false);
    result = runs[0];
  }

  ok = check(c.case_id, result.status === exp.status, `status expected ${exp.status}`, result.status) && ok;

  const codes = new Set((result.diagnostics ?? []).map((d) => d.code));
  for (const want of exp.diagnostic_codes ?? []) {
    ok = check(c.case_id, codes.has(want), `diagnostic ${want}`, [...codes]) && ok;
  }

  const actualStatuses = (result.report?.claims ?? []).map((x) => x.research_status);
  ok = check(c.case_id, JSON.stringify(actualStatuses) === JSON.stringify(exp.claim_statuses ?? []), `claim statuses ${JSON.stringify(exp.claim_statuses ?? [])}`, actualStatuses) && ok;

  const actualQ = new Set((result.quarantined_sources ?? []).map((x) => x.record_id));
  const expQ = new Set(exp.quarantined_ids ?? []);
  ok = check(c.case_id, actualQ.size === expQ.size && [...expQ].every((x) => actualQ.has(x)), `quarantined ${JSON.stringify([...expQ])}`, [...actualQ]) && ok;

  ok = check(c.case_id, result.report?.coverage?.state === exp.coverage_state || (result.report === null && exp.coverage_state === "UNKNOWN"), `coverage ${exp.coverage_state}`, result.report?.coverage?.state) && ok;

  if (ok) pass++;
}

console.log(`battery: ${pass}/${CASES.length} pass, ${fail} assertion failures`);
if (failures.length > 0) {
  console.log("failures:");
  for (const f of failures.slice(0, 30)) console.log(`  ${f}`);
  process.exit(1);
}
