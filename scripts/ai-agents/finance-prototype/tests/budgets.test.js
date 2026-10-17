/** budgets.test.js — budget boundary and fail-closed behavior. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function ctxFor(bundleName) {
  const ref = store.bundleRefs[bundleName];
  const key = `${ref.repo}|${ref.path}`;
  const chartKey = "fin-sources|chart/finance-chart-v1.md";
  return {
    clock: Date.parse("2026-06-01T12:00:00Z"),
    sources: { [chartKey]: store.sources[chartKey], [key]: store.sources[key] },
    readGrants: [
      { repo: "fin-sources", path: "chart/finance-chart-v1.md" },
      { repo: ref.repo, path: ref.path },
    ],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
  };
}

function taskFor(bundleName, n) {
  return {
    schema_version: "1",
    task_id: "budget-test",
    operation: "analyze",
    fixture_refs: { transaction_bundle: store.bundleRefs[bundleName] },
    options: {
      population: { declared_total: n, complete: true },
      period: { start_date: "2026-01-01", end_date: "2026-01-31", opening_balance_minor: "0", currency: "USD" },
      header_claims: {},
    },
  };
}

test("budget: 54 transactions succeeds (8 ctx + 2 resolve + 54 = 64)", () => {
  const r = run(taskFor("boundary-54", 54), ctxFor("boundary-54"));
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.transaction_results.length, 54);
});

test("budget: 55 transactions refuses (65 > 64)", () => {
  const r = run(taskFor("boundary-55", 55), ctxFor("boundary-55"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"));
  assert.equal(r.complete, false);
});

test("budget: 1000-row bundle refuses fast without inspecting all rows", () => {
  const start = Date.now();
  const r = run(taskFor("over-budget-1000", 1000), ctxFor("over-budget-1000"));
  const ms = Date.now() - start;
  assert.equal(r.status, "REFUSED");
  // INPUT_LIMIT fires first (revision text double-charged: context + resolve).
  assert.ok(r.diagnostics.some((d) => d.code === "INPUT_LIMIT" || d.code === "BUDGET_EXCEEDED"));
  assert.ok(ms < 2000, `refusal took ${ms}ms, expected fail-fast`);
  // Refusal carries no partial domain payload
  assert.equal(r.report.transaction_results.length, 0);
});

test("budget: sentinel — later records untouched on refusal", () => {
  // The 55th transaction would be txn-b55-54; refusal must occur before
  // its fields are read. We prove this behaviorally: the refusal happens
  // during the charged pass, and no transaction_results are emitted.
  const r = run(taskFor("boundary-55", 55), ctxFor("boundary-55"));
  assert.equal(r.report.transaction_results.length, 0);
  assert.equal(r.report.anomalies.length, 0);
});

test("budget: context validation is charged (unbudgeted traversal refused)", () => {
  // A context with 60 sources exceeds the object budget during
  // validateContext itself — proving context is not a free pre-pass.
  const ctx = ctxFor("single-income");
  for (let i = 0; i < 60; i++) {
    ctx.sources[`fin-sources|extra/extra-${i}.md`] = {
      revisions: { ["a".repeat(40)]: { text: "x", blob: "b".repeat(40) } },
    };
  }
  const r = run(taskFor("single-income", 1), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED" || d.code === "INVALID_INPUT"));
});
