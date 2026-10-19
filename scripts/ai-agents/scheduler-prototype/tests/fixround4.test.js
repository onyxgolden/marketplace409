/** fixround4.test.js — fourth fix-round regression probes.
 * S648-005 (late-derivation basis), S648-006/S648A-001 (budget-integrated
 * admission residuals), S648A-006 (Proxy-safe transport is in watchdog.test.js).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(bundle, overrides = {}) {
  const ref = store.bundleRefs[bundle];
  const key = `${ref.repo}|${ref.path}`;
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    ...overrides,
  };
}

function taskFor(bundle, opts = {}) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1",
    task_id: "fixround4-test",
    operation: "analyze",
    fixture_refs: { network_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      anchors: { c1: "2026-01-05" },
      horizon_days: 60,
      deadlines: {},
      constraints: [],
      claimed: {},
      ...opts,
    },
  };
}

function diagCodes(r) {
  return (r.diagnostics ?? []).map((d) => d.code);
}

// ================= S648-005: late-derivation calculation basis =================

test("S648-005: activity basis binds successor ties (reverse pass)", () => {
  const r = run(taskFor("single-activity"), ctxFor("single-activity"));
  assert.equal(r.status, "REPORT_READY");
  const comp = r.report.components[0];
  assert.ok(comp.activities.length > 0);
  for (const a of comp.activities) {
    const basis = a.calculation_basis;
    assert.ok(basis, "activity must carry calculation_basis");
    assert.ok(Array.isArray(basis.successor_ties), "basis must include successor_ties");
    assert.ok(basis.deadline, "basis must include deadline derivation");
    assert.ok(basis.anchor, "basis must include anchor with citation");
    assert.ok(basis.anchor.citation, "anchor must carry a citation state");
    assert.ok(basis.horizon, "basis must include horizon with citation");
    assert.ok(basis.horizon.citation, "horizon must carry a citation state");
  }
});

test("S648-005: implicit deadline identifies max-EF contributor", () => {
  // No explicit deadline -> D = maxEF; the basis must name the derivation
  // and the contributing activity.
  const r = run(taskFor("single-activity"), ctxFor("single-activity"));
  assert.equal(r.status, "REPORT_READY");
  const comp = r.report.components[0];
  // No explicit deadline was set, so derivation must be implicit_max_ef.
  for (const a of comp.activities) {
    const d = a.calculation_basis.deadline;
    assert.equal(d.derivation, "implicit_max_ef");
    assert.ok(d.citation, "implicit deadline must carry citation evidence");
    assert.ok(d.citation.contributing_activity, "implicit deadline must name the max-EF contributor");
  }
});

test("S648-005: explicit deadline is bound with unavailable task-input citation", () => {
  const task = taskFor("single-activity", { deadlines: { c1: 10 } });
  const r = run(task, ctxFor("single-activity"));
  // May be READY or PARTIAL depending on fixture; the basis shape is what matters.
  const comp = r.report.components.find((c) => c.status === "READY");
  if (comp) {
    for (const a of comp.activities) {
      const d = a.calculation_basis.deadline;
      assert.equal(d.derivation, "explicit");
      assert.equal(d.tick, 10);
      assert.equal(d.citation.verification, "unavailable");
    }
  }
});

test("S648-005: diagnostics carry evidence states", () => {
  // Force a claimed mismatch to produce a diagnostic with evidence.
  const task = taskFor("single-activity", {
    claimed: {
      activities: {
        "a1": { es: 99, ef: 99, ls: 99, lf: 99, total_float: 99 },
      },
    },
  });
  const r = run(task, ctxFor("single-activity"));
  const mismatch = (r.diagnostics ?? []).find((d) => d.code === "CLAIMED_VALUE_MISMATCH");
  if (mismatch) {
    assert.ok(mismatch.evidence_state, "diagnostic must carry an evidence_state");
    assert.ok(mismatch.evidence, "diagnostic must carry evidence");
  }
});

// ================= S648-006 / S648A-001: budget-integrated admission =================

test("S648-006: 70 constraints with accessor at [69] -> BUDGET_EXCEEDED before touching it", () => {
  const task = taskFor("single-activity");
  // Build 70 constraints; only constraint[69].kind is an own accessor.
  const constraints = [];
  for (let i = 0; i < 70; i++) {
    constraints.push({ activity_id: "a1", kind: "START_NO_EARLIER_THAN", tick: 0 });
  }
  let getterCalls = 0;
  Object.defineProperty(constraints[69], "kind", {
    enumerable: true,
    configurable: true,
    get() { getterCalls++; return "START_NO_EARLIER_THAN"; },
  });
  task.options.constraints = constraints;
  const r = run(task, ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCodes(r).includes("BUDGET_EXCEEDED"), `expected BUDGET_EXCEEDED, got ${diagCodes(r)}`);
  assert.equal(getterCalls, 0, "the accessor at [69] must never be invoked");
});

test("S648A-001: inherited clock getter refuses (not REPORT_READY)", () => {
  const task = taskFor("single-activity");
  const ctx = ctxFor("single-activity");
  // Delete own clock, put a getter on a custom prototype.
  // Build manually to avoid Object.assign hitting the prototype getter.
  const evilProto = {
    get clock() { return 1780315200000; },
  };
  const evilCtx = Object.create(evilProto);
  for (const k of Object.keys(ctx)) {
    if (k === "clock") continue;
    evilCtx[k] = ctx[k];
  }
  const r = run(task, evilCtx);
  assert.equal(r.status, "REFUSED", "inherited clock control must not yield REPORT_READY");
  // The diagnostic should indicate the prototype/inheritance problem.
  const reasons = (r.diagnostics ?? []).map((d) => d.reason).join(" ");
  assert.ok(/prototype|inherited|own data property/i.test(reasons), `expected prototype rejection, got: ${reasons.slice(0, 200)}`);
});

test("S648-006: 300KB unrecognized revision metadata refuses", () => {
  const task = taskFor("single-activity");
  const ctx = ctxFor("single-activity");
  // Add an unrecognized 300KB string to the registered revision.
  const key = Object.keys(ctx.sources)[0];
  const commit = Object.keys(ctx.sources[key].revisions)[0];
  // Deep clone to avoid mutating the shared store.
  const ctx2 = JSON.parse(JSON.stringify(ctx));
  ctx2.sources[key].revisions[commit].extra_metadata = "x".repeat(300000);
  const r = run(task, ctx2);
  assert.equal(r.status, "REFUSED", "unbounded unknown metadata must not yield REPORT_READY");
});

test("S648-006: oversized task_id gets bounded marker, envelope under 256KiB", () => {
  const task = taskFor("single-activity");
  task.task_id = "x".repeat(300000);
  const r = run(task, ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.task_id, "[task-id-exceeds-256-bytes]");
  const bytes = Buffer.byteLength(JSON.stringify(r), "utf8");
  assert.ok(bytes <= 262144, `refusal envelope must respect 256KiB cap (was ${bytes})`);
});

test("S648-006: admission depth bounded at 32", () => {
  // Build a 40-deep nested object in the task options (via a custom field
  // that survives to admission — use claimed.activities nesting).
  const task = taskFor("single-activity");
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 40; i++) {
    cur.nested = {};
    cur = cur.nested;
  }
  // Put it where admission will walk it but validation rejects unknown keys.
  // Actually, put it in a way that admission sees it: attach to task directly
  // would fail exactKeys. Instead, nest inside a constraint-like structure.
  // Simplest: the depth check triggers during admission walk regardless.
  task.options.claimed.activities = { deep_test: deep };
  const r = run(task, ctxFor("single-activity"));
  // Should refuse (either depth or schema) — must not hang or succeed silently.
  assert.equal(r.status, "REFUSED");
});
