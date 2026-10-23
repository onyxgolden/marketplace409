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
import { canonicalJson, AGENT_ID, SCHEMA_VERSION, computeTotals } from "./report.js";

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
 * The minimal envelope: an explicit nonpassing truncation refusal
 * (Q665-005A.1). It claims no identity and no evidence — no head pin,
 * no checkout head, no suites, zero totals — and it never carries a
 * green verdict: a minimal envelope is REFUSED/REPORT_TRUNCATED, not
 * a detached ALL_SUITES_PASS receipt over invented zero counters.
 * Its canonical size is the floor every admitted max_report_bytes
 * must clear (asserted by the test suite).
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
    status: "REFUSED",
    verdict: "REFUSED",
    reason_code: "REPORT_TRUNCATED",
    diagnostics: [
      {
        code: "REPORT_TRUNCATED",
        path: "$",
        message: "serialized report exceeded its byte budget; the report body could not be preserved, so no outcome is claimed — this is an explicit truncation refusal, not an executed result",
      },
    ],
    isolation: null,
    suites: [],
    totals: { ...ZERO_TOTALS },
  };
}

/**
 * Shrink a report to its outcome skeleton: identity fields, the
 * outcome (status preserved exactly; the verdict is RECOMPUTED from
 * the kept per-suite records for completed runs, so a green verdict
 * can never survive on a body that no longer earns it — Q665-005A.1),
 * a single REPORT_TRUNCATED diagnostic, per-suite id/status/reason/
 * true counts, and the true totals (never invented zeros; displayed-
 * record counts stay separate from true counts via failing_tests_total
 * / the per-suite test_counts).
 * Deterministic: the same over-budget report always shrinks to the
 * same bytes.
 */
function shrinkReport(report, maxBytes) {
  const suites = (report.suites ?? []).map((s) => ({
    id: s.id,
    status: s.status,
    reason_code: s.reason_code,
    test_counts: s.test_counts,
    failing_tests_total: s.failing_tests_total,
  }));
  const verdict =
    report.status === "COMPLETED"
      ? suites.length > 0 && suites.every((s) => s.status === "PASS")
        ? "ALL_SUITES_PASS"
        : "SUITES_FAILED"
      : report.verdict;
  return {
    schema_version: report.schema_version,
    agent: report.agent,
    advisory: true,
    job_id: report.job_id,
    target: report.target,
    head_pin: report.head_pin,
    checkout_head: report.checkout_head,
    status: report.status,
    verdict,
    reason_code: report.reason_code,
    diagnostics: [
      {
        code: "REPORT_TRUNCATED",
        path: "$",
        message: `serialized report exceeded the ${maxBytes}-byte report budget; diagnostics and failing-test detail truncated to this envelope`,
      },
    ],
    isolation: report.isolation,
    suites,
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

/**
 * Q665-005A.1: the reduced-envelope contract. Every reduced or
 * minimal form is validated against the report contract:
 *  - a green verdict is only valid on a body that earns it: at least
 *    one recorded suite, every recorded suite PASS;
 *  - totals reconcile with the kept suite records (true counts, never
 *    invented zeros);
 *  - a truncation refusal claims no identity: null pins, no green
 *    verdict.
 * Returns null when the envelope satisfies the contract, else a
 * reason string.
 */
export function validateReducedEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") return "envelope is not an object";
  if (envelope.verdict === "ALL_SUITES_PASS") {
    const suites = Array.isArray(envelope.suites) ? envelope.suites : [];
    if (suites.length === 0) return "ALL_SUITES_PASS on an envelope with no suite records";
    const nonPass = suites.find((s) => !s || s.status !== "PASS");
    if (nonPass) return `ALL_SUITES_PASS with a non-PASS suite record (${nonPass && nonPass.id ? nonPass.id : "?"})`;
  }
  if (Array.isArray(envelope.suites) && envelope.totals && typeof envelope.totals === "object") {
    const expected = computeTotals(
      envelope.suites.map((s) => ({ status: s.status, test_counts: s.test_counts ?? { total: 0, passed: 0, failed: 0, pending: 0 } }))
    );
    for (const k of Object.keys(expected)) {
      if (envelope.totals[k] !== expected[k]) {
        return `totals.${k}=${envelope.totals[k]} does not reconcile with the kept suite records (${expected[k]})`;
      }
    }
  }
  if (envelope.status === "REFUSED" && envelope.reason_code === "REPORT_TRUNCATED") {
    if (envelope.head_pin !== null || envelope.checkout_head !== null) {
      return "truncation refusal claims identity pins";
    }
  }
  return null;
}

/** The admission floor: no admitted cap may be smaller. */
export { MIN_REPORT_BYTES };
