/**
 * report-bounds.js — central final-envelope byte bound (Q665-005A).
 *
 * Every public outcome of runJob — completed, refused, or error —
 * passes through enforceReportBytes before it leaves the API, against
 * the ADMITTED max_report_bytes budget. The CLI no longer owns a
 * separate enforcement with different semantics; its final guard is a
 * defensive assert over the same bound.
 *
 * Out-of-band contract for tiny caps: admission validates
 * max_report_bytes >= MIN_REPORT_BYTES (schemas.js) — a smaller cap
 * cannot fit any report envelope, so the job is refused at admission
 * (INVALID_BUDGET) rather than producing an unbounded or empty
 * report. If a sub-minimum cap ever reaches this module anyway, the
 * minimal envelope below is unconditionally bounded and always fits.
 */

import { MIN_REPORT_BYTES } from "./schemas.js";
import { Buffer } from "node:buffer";
import { canonicalJson, AGENT_ID, SCHEMA_VERSION } from "./report.js";

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

/**
 * The minimal envelope: identity + outcome + one truncation diagnostic.
 * No suites, no bulk. Its canonical size is the floor every admitted
 * max_report_bytes must clear (asserted by the test suite).
 */
export function minimalEnvelope(report) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    advisory: true,
    job_id: null,
    target: null,
    head_pin: null,
    checkout_head: null,
    status: report?.status ?? "REFUSED",
    verdict: report?.verdict ?? "REFUSED",
    reason_code: report?.reason_code ?? "REPORT_TRUNCATED",
    diagnostics: [
      {
        code: "REPORT_TRUNCATED",
        path: "$",
        message: "serialized report exceeded its byte budget; body replaced by this minimal envelope",
      },
    ],
    isolation: null,
    suites: [],
    totals: { ...ZERO_TOTALS },
  };
}

/**
 * Shrink a report to its outcome skeleton: identity fields, the
 * outcome (status/verdict/reason_code preserved exactly), a single
 * REPORT_TRUNCATED diagnostic, per-suite id/status/reason/counts, and
 * totals. Deterministic: the same over-budget report always shrinks to
 * the same bytes.
 */
function shrinkReport(report, maxBytes) {
  return {
    schema_version: report.schema_version,
    agent: report.agent,
    advisory: true,
    job_id: report.job_id,
    target: report.target,
    head_pin: report.head_pin,
    checkout_head: report.checkout_head,
    status: report.status,
    verdict: report.verdict,
    reason_code: report.reason_code,
    diagnostics: [
      {
        code: "REPORT_TRUNCATED",
        path: "$",
        message: `serialized report exceeded the ${maxBytes}-byte report budget; diagnostics and failing-test detail truncated to this envelope`,
      },
    ],
    isolation: report.isolation,
    suites: (report.suites ?? []).map((s) => ({
      id: s.id,
      status: s.status,
      reason_code: s.reason_code,
      test_counts: s.test_counts,
      failing_tests_total: s.failing_tests_total,
    })),
    totals: report.totals,
  };
}

export function reportBytes(report) {
  return Buffer.byteLength(canonicalJson(report), "utf8");
}

/**
 * Enforce the final-envelope bound centrally. Returns
 * {report, truncated}: `report` is the original object untouched when
 * it fits (byte-identical passthrough), otherwise the shrunk envelope
 * (outcome preserved, truncation explicit), otherwise the minimal
 * envelope. The returned report always satisfies the byte bound —
 * provided maxBytes >= MIN_REPORT_BYTES, which admission guarantees.
 */
export function enforceReportBytes(report, maxBytes) {
  if (reportBytes(report) <= maxBytes) return { report, truncated: false };
  const shrunk = shrinkReport(report, maxBytes);
  if (reportBytes(shrunk) <= maxBytes) return { report: shrunk, truncated: true };
  return { report: minimalEnvelope(report), truncated: true };
}

/** The admission floor: no admitted cap may be smaller. */
export { MIN_REPORT_BYTES };
