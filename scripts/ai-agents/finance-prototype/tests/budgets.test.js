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

test("budget: 46 transactions succeeds (16 ctx + 2 resolve + 46 = 64)", () => {
  const r = run(taskFor("boundary-46", 46), ctxFor("boundary-46"));
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.transaction_results.length, 46);
});

test("budget: 47 transactions refuses (65 > 64)", () => {
  const r = run(taskFor("boundary-47", 47), ctxFor("boundary-47"));
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
  // FIN-002: the 47th transaction (and the 48th after it) are structurally
  // valid JSON but schema-invalid (missing amount_minor). Had any
  // over-budget candidate been decoded, the refusal would be
  // INVALID_INPUT — BUDGET_EXCEEDED proves they were never touched.
  const r = run(taskFor("boundary-47-sentinel", 48), ctxFor("boundary-47-sentinel"));
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"));
  assert.ok(!r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.equal(r.complete, false);
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

test("FIN-001: chart entries are charged candidates — first over-budget entry unread", () => {
  // 60-entry chart: entries 0..55 fill the budget (8 ctx + 56 = 64);
  // entry 56 is charge 65. Entries 56..59 are INVALID (bad code and bad
  // class). Had any over-budget entry been read, validateCriteria would
  // throw INVALID_INPUT — BUDGET_EXCEEDED proves they were never touched.
  const ctx = ctxFor("single-income");
  const chart = {};
  for (let i = 0; i < 56; i++) chart[`ACC${String(i).padStart(3, "0")}`] = i % 2 === 0 ? "INCOME" : "EXPENSE";
  chart["bad code!"] = "INCOME"; // index 56: invalid code — must never be read
  chart["ACC057"] = "NOPE"; // index 57: invalid class — must never be read
  chart["ACC058"] = "INCOME";
  chart["ACC059"] = "EXPENSE";
  ctx.criteria = { ...ctx.criteria, chart };
  const r = run(taskFor("single-income", 1), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"));
  assert.ok(!r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.equal(r.complete, false);
});

test("FIN-001 round 2: getter on first over-budget chart entry is never invoked", () => {
  // Same budget shape as the FIN-001 test above: 56 valid entries fill the
  // budget (8 ctx + 56 = 64); index 56 is charge 65. The entry at index 56
  // is an accessor whose getter records access and returns a VALID class —
  // so the only signal of premature evaluation is the access flag itself.
  // With the old Object.entries() implementation the getter fired while the
  // entries array was built, before any charge; the fixed implementation
  // enumerates keys only and refuses on the charge before reading the value.
  const ctx = ctxFor("single-income");
  const chart = {};
  for (let i = 0; i < 56; i++) chart[`ACC${String(i).padStart(3, "0")}`] = i % 2 === 0 ? "INCOME" : "EXPENSE";
  let getterFired = false;
  Object.defineProperty(chart, "ACC056", {
    enumerable: true,
    configurable: true,
    get() {
      getterFired = true;
      return "INCOME";
    },
  });
  ctx.criteria = { ...ctx.criteria, chart };
  const r = run(taskFor("single-income", 1), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"));
  assert.ok(!r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.equal(r.complete, false);
  assert.equal(getterFired, false, "over-budget chart entry getter was invoked before its charge");
});

test("FIN-003: unknown account blocks the ready summary and nulls affected aggregates", () => {
  // one known + one unknown account row
  const r = run(taskFor("unknown-account", 2), ctxFor("unknown-account"));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.summary, null);
  assert.equal(r.report.income_expense.net_income_minor, null);
  assert.equal(r.report.income_expense.evidence_state, "unavailable");
  assert.ok(r.diagnostics.some((d) => d.code === "MEASURE_UNAVAILABLE"));
  assert.ok(r.report.anomalies.some((a) => a.code === "UNKNOWN_ACCOUNT"));
});

test("FIN-003: mixed currency blocks the ready summary and nulls affected aggregates", () => {
  // one USD + one EUR row
  const r = run(taskFor("wrong-currency", 2), ctxFor("wrong-currency"));
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.report.summary, null);
  assert.equal(r.report.income_expense.net_income_minor, null);
  assert.equal(r.report.cash.movement_minor, null);
  assert.equal(r.report.cash.closing_derived_minor, null);
  assert.ok(r.diagnostics.some((d) => d.code === "MEASURE_UNAVAILABLE"));
  assert.ok(r.diagnostics.some((d) => d.code === "CURRENCY_UNVERIFIABLE"));
});
