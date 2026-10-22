/**
 * markdown.test.js — the Markdown renderer is a smoke-checked, faithful
 * rendering of the canonical report: verdict, pin, per-suite status and
 * failing tests all trace to report fields.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reportToMarkdown } from "../src/index.js";
import { completedReport, refusalReport } from "../src/report.js";

const PIN = "c".repeat(40);

function completedFixture() {
  return completedReport(
    { job_id: "job-md", target: "/tmp/checkout", head_pin: PIN },
    PIN,
    [
      {
        id: "unit",
        patterns: ["src/beta.test.js"],
        timeout_ms: 60_000,
        status: "FAIL",
        exit_code: 1,
        signal: null,
        reason_code: null,
        reason: null,
        test_counts: { total: 4, passed: 3, failed: 1, pending: 0 },
        failing_tests: [{ name: "beta divides numbers", file: "/fixture-checkout/src/beta.test.js" }],
      },
      {
        id: "smoke",
        patterns: ["src/alpha.test.js"],
        timeout_ms: 60_000,
        status: "PASS",
        exit_code: 0,
        signal: null,
        reason_code: null,
        reason: null,
        test_counts: { total: 2, passed: 2, failed: 0, pending: 0 },
        failing_tests: [],
      },
    ]
  );
}

describe("markdown rendering", () => {
  it("renders verdict, pin, suite statuses, totals and failing tests", () => {
    const md = reportToMarkdown(completedFixture());
    assert.match(md, /# QA test-runner report `job-md`/);
    assert.match(md, new RegExp(`head pin: \`${PIN}\``));
    assert.match(md, /verdict: \*\*SUITES_FAILED\*\*/);
    assert.match(md, /### unit — FAIL/);
    assert.match(md, /### smoke — PASS/);
    assert.match(md, /beta divides numbers/);
    assert.match(md, /\/fixture-checkout\/src\/beta\.test\.js/);
    assert.match(md, /tests: 6 total, 5 passed, 1 failed/);
    assert.match(md, /Advisory evidence only/);
  });

  it("renders ALL_SUITES_PASS only for a fully passing report", () => {
    const pass = completedReport({ job_id: "j", target: "/t", head_pin: PIN }, PIN, [
      {
        id: "unit",
        patterns: ["a"],
        timeout_ms: 1,
        status: "PASS",
        exit_code: 0,
        signal: null,
        reason_code: null,
        reason: null,
        test_counts: { total: 1, passed: 1, failed: 0, pending: 0 },
        failing_tests: [],
      },
    ]);
    assert.equal(pass.verdict, "ALL_SUITES_PASS");
    assert.match(reportToMarkdown(pass), /verdict: \*\*ALL_SUITES_PASS\*\*/);
    // The failing fixture must never render the pass verdict.
    assert.doesNotMatch(reportToMarkdown(completedFixture()), /ALL_SUITES_PASS/);
  });

  it("renders a refusal with its reason code and diagnostics", () => {
    const refusal = refusalReport(
      { job_id: "job-md", target: "/tmp/checkout", head_pin: PIN, suites: [{ id: "unit", patterns: ["a"] }] },
      "HEAD_MISMATCH",
      [{ code: "HEAD_MISMATCH", path: "$.head_pin", message: "checkout HEAD differs; nothing executed" }],
      "d".repeat(40)
    );
    const md = reportToMarkdown(refusal);
    assert.match(md, /status: \*\*REFUSED\*\*/);
    assert.match(md, /reason: `HEAD_MISMATCH`/);
    assert.match(md, /\[HEAD_MISMATCH\]/);
    assert.match(md, /### unit — SKIPPED_BUDGET/);
  });
});
