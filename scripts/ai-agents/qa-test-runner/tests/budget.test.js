/**
 * budget.test.js — budgets are charged BEFORE any candidate is validated
 * in detail and before anything executes.
 *
 * Sentinel discipline: an invalid entry sitting PAST a budget limit must
 * die on BUDGET_EXCEEDED — never on a validation error for its unexamined
 * contents, and never by running. Each sentinel asserts the returned
 * error set is exactly [BUDGET_EXCEEDED].
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { validateJob, runJob } from "../src/index.js";
import { makeStubCheckout, loadFixtureJson } from "./helpers.js";

const PIN = "b".repeat(40);

function jobWith(suites, budgets) {
  const j = { target: "/tmp/some-checkout", head_pin: PIN, suites };
  if (budgets) j.budgets = budgets;
  return j;
}

const suite = (id, extra = {}) => ({ id, patterns: [`src/${id}.test.js`], ...extra });

describe("budget charging", () => {
  it("accepts a job exactly at the suite limit", () => {
    const r = validateJob(jobWith([suite("s1"), suite("s2")], { max_suites: 2 }));
    assert.equal(r.ok, true);
  });

  it("refuses limit+1 suites with BUDGET_EXCEEDED", () => {
    const r = validateJob(jobWith([suite("s1"), suite("s2"), suite("s3")], { max_suites: 2 }));
    assert.equal(r.ok, false);
    assert.equal(r.budgetExceeded, true);
    assert.deepEqual(r.errors.map((e) => e.code), ["BUDGET_EXCEEDED"]);
  });

  it("SENTINEL: an invalid suite past the limit dies on BUDGET_EXCEEDED, never validation", () => {
    // The third suite is multiply invalid: numeric id, non-array
    // patterns, an unknown property, and a duplicate id. None of that
    // may be reported — the candidate is past the charge limit and its
    // contents are never examined.
    const bad = { id: 42, patterns: "not-an-array", command: "rm -rf /" };
    const r = validateJob(jobWith([suite("s1"), suite("s2"), bad], { max_suites: 2 }));
    assert.equal(r.ok, false);
    assert.equal(r.budgetExceeded, true);
    assert.deepEqual(r.errors.map((e) => e.code), ["BUDGET_EXCEEDED"]);
  });

  it("SENTINEL: an invalid pattern past the pattern limit dies on BUDGET_EXCEEDED", () => {
    const s = { id: "s1", patterns: ["src/ok.test.js", 42] };
    const r = validateJob(jobWith([s], { max_patterns_per_suite: 1 }));
    assert.equal(r.ok, false);
    assert.equal(r.budgetExceeded, true);
    assert.deepEqual(r.errors.map((e) => e.code), ["BUDGET_EXCEEDED"]);
  });

  it("SENTINEL: an invalid suite whose timeout charge busts the per-job budget dies on BUDGET_EXCEEDED", () => {
    const s2 = { id: "s2", patterns: ["src/s2.test.js"], timeout_ms: 100, bogus_field: true };
    const r = validateJob(
      jobWith([suite("s1", { timeout_ms: 100 }), s2], { per_job_timeout_ms: 150, per_suite_timeout_ms: 1000 })
    );
    assert.equal(r.ok, false);
    assert.equal(r.budgetExceeded, true);
    assert.deepEqual(r.errors.map((e) => e.code), ["BUDGET_EXCEEDED"]);
  });

  it("refuses a per-suite timeout above the effective per-suite budget", () => {
    const r = validateJob(jobWith([suite("s1", { timeout_ms: 5000 })], { per_suite_timeout_ms: 1000 }));
    assert.equal(r.ok, false);
    assert.equal(r.budgetExceeded, true);
    assert.deepEqual(r.errors.map((e) => e.code), ["BUDGET_EXCEEDED"]);
  });

  it("refuses a requested budget above the hard cap as BUDGET_EXCEEDED", () => {
    const r = validateJob(jobWith([suite("s1")], { max_suites: 9999 }));
    assert.equal(r.ok, false);
    assert.equal(r.budgetExceeded, true);
    assert.deepEqual(r.errors.map((e) => e.code), ["BUDGET_EXCEEDED"]);
  });

  it("an in-budget invalid suite is still a validation error, not a budget error", () => {
    const r = validateJob(jobWith([suite("s1"), { id: "s1", patterns: ["x"] }], { max_suites: 4 }));
    assert.equal(r.ok, false);
    assert.equal(r.budgetExceeded, false);
    assert.ok(r.errors.map((e) => e.code).includes("DUPLICATE_ID"));
  });

  it("runJob: an over-budget job is REFUSED/BUDGET_EXCEEDED and executes nothing", async (t) => {
    const { dir, head, markerPath } = makeStubCheckout(t, { json: loadFixtureJson("vitest-pass.json"), exitCode: 0 });
    const job = {
      job_id: "job-budget",
      target: dir,
      head_pin: head,
      budgets: { max_suites: 1 },
      suites: [suite("s1"), suite("s2")],
    };
    const report = await runJob(job);
    assert.equal(report.status, "REFUSED");
    assert.equal(report.verdict, "REFUSED");
    assert.equal(report.reason_code, "BUDGET_EXCEEDED");
    assert.equal(existsSync(markerPath), false, "no suite may execute for an over-budget job");
  });
});
