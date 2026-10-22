/**
 * report.js — the deterministic advisory report shape.
 *
 * The canonical body carries no timestamps and no wall-clock durations:
 * the same job on the same head with the same suite outcomes produces
 * byte-identical canonical JSON. `generated_at` is deliberately omitted
 * (permitted by the brief) so determinism is total rather than partial.
 *
 * The report is advisory evidence for the panel. It merges nothing,
 * approves nothing, and carries no authority.
 */

export const AGENT_ID = "qa-test-runner";
export const SCHEMA_VERSION = "1";

export function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonicalize(v[k]);
    return o;
  }
  return v;
}

export const canonicalJson = (v) => JSON.stringify(canonicalize(v));

const ZERO_TOTALS = Object.freeze({
  suites_total: 0,
  suites_passed: 0,
  suites_failed: 0,
  suites_error: 0,
  suites_timeout: 0,
  suites_skipped_budget: 0,
  tests_total: 0,
  tests_passed: 0,
  tests_failed: 0,
  tests_pending: 0,
});

export function emptySuiteEntry(suite, status, reasonCode, reason) {
  return {
    id: typeof suite?.id === "string" ? suite.id : null,
    patterns: Array.isArray(suite?.patterns) ? suite.patterns.filter((p) => typeof p === "string") : [],
    timeout_ms: Number.isInteger(suite?.timeout_ms) ? suite.timeout_ms : null,
    status,
    exit_code: null,
    signal: null,
    reason_code: reasonCode,
    reason,
    test_counts: { total: 0, passed: 0, failed: 0, pending: 0 },
    failing_tests: [],
  };
}

export function computeTotals(suiteEntries) {
  const t = { ...ZERO_TOTALS };
  t.suites_total = suiteEntries.length;
  for (const s of suiteEntries) {
    if (s.status === "PASS") t.suites_passed += 1;
    else if (s.status === "FAIL") t.suites_failed += 1;
    else if (s.status === "ERROR") t.suites_error += 1;
    else if (s.status === "TIMEOUT") t.suites_timeout += 1;
    else if (s.status === "SKIPPED_BUDGET") t.suites_skipped_budget += 1;
    t.tests_total += s.test_counts.total;
    t.tests_passed += s.test_counts.passed;
    t.tests_failed += s.test_counts.failed;
    t.tests_pending += s.test_counts.pending;
  }
  return t;
}

function baseReport(job) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    advisory: true,
    job_id: typeof job?.job_id === "string" ? job.job_id : null,
    target: typeof job?.target === "string" ? job.target : null,
    head_pin: typeof job?.head_pin === "string" ? job.head_pin : null,
    checkout_head: null,
    status: "REFUSED",
    verdict: "REFUSED",
    reason_code: null,
    diagnostics: [],
    suites: [],
    totals: { ...ZERO_TOTALS },
  };
}

/**
 * A refusal: nothing executed. Every named suite is reported as
 * SKIPPED_BUDGET-shaped evidence of non-execution — here with status
 * SKIPPED_BUDGET so a panel reader sees the suites were not run.
 */
export function refusalReport(job, reasonCode, diagnostics, checkoutHead = null) {
  const r = baseReport(job);
  r.reason_code = reasonCode;
  r.checkout_head = checkoutHead;
  r.diagnostics = diagnostics;
  const suites = Array.isArray(job?.suites) ? job.suites : [];
  r.suites = suites.map((s) => emptySuiteEntry(s, "SKIPPED_BUDGET", reasonCode, `not executed: ${reasonCode}`));
  r.totals = computeTotals(r.suites);
  return r;
}

/** A completed run (suites were executed, whatever their outcomes). */
export function completedReport(job, checkoutHead, suiteEntries) {
  const r = baseReport(job);
  r.checkout_head = checkoutHead;
  r.status = "COMPLETED";
  r.suites = suiteEntries;
  r.totals = computeTotals(suiteEntries);
  // The advisory verdict is ALL_SUITES_PASS only when every suite in the
  // job actually ran and passed — an empty or partial run never earns it.
  r.verdict =
    suiteEntries.length > 0 && suiteEntries.every((s) => s.status === "PASS") ? "ALL_SUITES_PASS" : "SUITES_FAILED";
  return r;
}
