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

test("58 records fit exactly at the 64-object cap", () => {
  const r = run(taskFor("boundary-58", 58), ctxFor("boundary-58"));
  assert.equal(r.status, "REPORT_READY");
});

test("59th record refuses before inspection (sentinel: invalid tail never decoded)", () => {
  const r = run(taskFor("sentinel-59", 59), ctxFor("sentinel-59"));
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
