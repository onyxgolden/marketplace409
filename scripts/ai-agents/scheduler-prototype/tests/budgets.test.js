/** budgets.test.js — budget sentinel behavior through run(). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, canonicalJson, makeBudget, BUDGET_LIMITS } from "../src/index.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(bundle) {
  const ref = store.bundleRefs[bundle];
  const key = `${ref.repo}|${ref.path}`;
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
  };
}
function taskFor(bundle, n) {
  const ref = store.bundleRefs[bundle];
  return {
    schema_version: "1", task_id: "bud-test", operation: "analyze",
    fixture_refs: { network_bundle: ref },
    options: {
      population: { declared_total: n, complete: true },
      anchors: { c1: "2026-01-05" }, horizon_days: 60,
      deadlines: {}, constraints: [], claimed: {},
    },
  };
}
function diagCode(r) {
  return (r.diagnostics ?? []).map((d) => d.code);
}

test("100-record bundle refuses BUDGET_EXCEEDED (no truncation)", () => {
  const r = run(taskFor("over-budget-100", 101), ctxFor("over-budget-100"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCode(r).includes("BUDGET_EXCEEDED"));
  assert.equal(r.complete, false);
  assert.deepEqual(r.report.components, []);
});

test("45 records fit exactly at the 64-object cap (new taxonomy)", () => {
  // S648-006: complete candidate taxonomy.
  // Task(11): task, fixture_refs, fixture_refs.network_bundle, options,
  //   population, anchors, anchors[c1], deadlines, claimed,
  //   claimed.activities, claimed.critical_paths
  // Context(7): context, sources, sources[key], sources[key]@commit,
  //   readGrants[0], principal, criteria
  // Resolve(1) + 45 records = 64
  const r = run(taskFor("boundary-45", 45), ctxFor("boundary-45"));
  assert.equal(r.status, "REPORT_READY");
});

test("54 records refuse over budget with container charges", () => {
  // 11 + 7 + 1 + 54 = 73 > 64 -> BUDGET_EXCEEDED
  const r = run(taskFor("boundary-54", 54), ctxFor("boundary-54"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCode(r).includes("BUDGET_EXCEEDED"));
});

test("55th record refuses before inspection (sentinel: invalid tail never decoded)", () => {
  const r = run(taskFor("sentinel-55", 55), ctxFor("sentinel-55"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCode(r).includes("BUDGET_EXCEEDED"));
  assert.ok(!diagCode(r).includes("INVALID_INPUT"), "must not report INVALID_INPUT for the uninspected tail");
});

test("budget object cap is exactly 64", () => {
  assert.equal(BUDGET_LIMITS.maxObjects, 64);
  assert.equal(BUDGET_LIMITS.maxSpans, 512);
  assert.equal(BUDGET_LIMITS.maxPayloadBytes, 262144);
});

test("span budget primitive refuses at 513", () => {
  const b = makeBudget();
  for (let i = 0; i < 512; i++) b.countSpan(`s${i}`);
  assert.throws(() => b.countSpan("s512"), (e) => e instanceof Error && e.code === "BUDGET_EXCEEDED");
});

// ---- S648-001: task-side candidates are budget-charged before inspection.

function taskWithConstraints(n, { invalidFrom = -1 } = {}) {
  const ref = store.bundleRefs["single-activity"];
  const constraints = [];
  for (let i = 0; i < n; i++) {
    if (invalidFrom >= 0 && i >= invalidFrom) {
      // Sentinel: schema-invalid; must never be inspected.
      constraints.push({ activity_id: "BAD ID !!!", kind: "NOPE", tick: "nan" });
    } else {
      constraints.push({ activity_id: "A", kind: "START_NO_EARLIER_THAN", tick: i % 10 });
    }
  }
  return {
    schema_version: "1", task_id: "bud-task-side", operation: "analyze",
    fixture_refs: { network_bundle: ref },
    options: {
      population: { declared_total: 2, complete: true },
      anchors: { c1: "2026-01-05" }, horizon_days: 60,
      deadlines: {}, constraints, claimed: {},
    },
  };
}

test("task-side: 43 constraints fit exactly via full run (new taxonomy)", () => {
  // S648-006: task(11 + 43 constraints) + context(7) + resolve(1) + 2 records = 64
  // Task: task, fixture_refs, fixture_refs.network_bundle, options,
  //   population, anchors, anchors[c1], deadlines, claimed,
  //   claimed.activities, claimed.critical_paths (11) + 43 constraints
  const r = run(taskWithConstraints(43), ctxFor("single-activity"));
  assert.equal(r.status, "REPORT_READY");
});

test("task-side: 61st constraint refuses BEFORE inspection (sentinels untouched)", () => {
  // 61 constraints; the 61st (index 60) is an invalid sentinel. Task base
  // is 4, so charging constraint[60] is attempt 65 -> BUDGET_EXCEEDED
  // during validateTask, before the sentinel's fields are ever read.
  const r = run(taskWithConstraints(61, { invalidFrom: 60 }), ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCode(r).includes("BUDGET_EXCEEDED"));
  assert.ok(!diagCode(r).includes("INVALID_INPUT"), "sentinel constraints must not be inspected");
});

test("task-side: claimed activities are charged before inspection", () => {
  const ref = store.bundleRefs["single-activity"];
  const claimed = {};
  for (let i = 0; i < 60; i++) claimed[`c${i}`] = { es: 0, ef: 1, ls: 0, lf: 1, total_float: 0 };
  // 61st claimed activity is an invalid sentinel (bad id + bad fields).
  claimed["BAD ID !!!"] = { es: "nan" };
  const task = {
    schema_version: "1", task_id: "bud-claim-side", operation: "analyze",
    fixture_refs: { network_bundle: ref },
    options: {
      population: { declared_total: 2, complete: true },
      anchors: { c1: "2026-01-05" }, horizon_days: 60,
      deadlines: {}, constraints: [],
      claimed: { activities: claimed },
    },
  };
  const r = run(task, ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCode(r).includes("BUDGET_EXCEEDED"));
  assert.ok(!diagCode(r).includes("INVALID_INPUT"), "sentinel claimed activity must not be inspected");
});

test("task-side: claimed critical paths are charged before inspection", () => {
  const ref = store.bundleRefs["single-activity"];
  const paths = {};
  for (let i = 0; i < 60; i++) paths[`c${i}`] = ["A"];
  // 61st path is an invalid sentinel (empty path).
  paths["c-bad"] = [];
  const task = {
    schema_version: "1", task_id: "bud-path-side", operation: "analyze",
    fixture_refs: { network_bundle: ref },
    options: {
      population: { declared_total: 2, complete: true },
      anchors: { c1: "2026-01-05" }, horizon_days: 60,
      deadlines: {}, constraints: [],
      claimed: { activities: {}, critical_paths: paths },
    },
  };
  const r = run(task, ctxFor("single-activity"));
  assert.equal(r.status, "REFUSED");
  assert.ok(diagCode(r).includes("BUDGET_EXCEEDED"));
  assert.ok(!diagCode(r).includes("INVALID_INPUT"), "sentinel claimed path must not be inspected");
});
