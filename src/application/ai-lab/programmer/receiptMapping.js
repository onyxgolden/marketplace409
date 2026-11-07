/**
 * receiptMapping.js — versioned mapping from a P3 qa-test-runner
 * receipt to the P5 verification state and job lifecycle.
 *
 * Read against the real P3 contract
 * (scripts/ai-agents/qa-test-runner/src/schemas.js + report.js):
 * a receipt carries schema_version "1", agent "qa-test-runner",
 * status COMPLETED|REFUSED, verdict
 * ALL_SUITES_PASS|SUITES_FAILED|REFUSED, an isolation object (or
 * null), and suites[] with closed statuses
 * PASS|FAIL|ERROR|TIMEOUT|SKIPPED_BUDGET plus test_counts and a
 * cleanup_failed flag. This module calls NOTHING — it only reads a
 * receipt object the caller supplies. No test execution happens in
 * this slice.
 *
 * Fail-closed rules (all explicit, no optimistic VERIFIED anywhere):
 * - missing receipt -> NOT_RUN (nothing was verified yet)
 * - refused receipt, job-id mismatch, stale/mismatched base pin,
 *   missing or unproven isolation, cleanup failure, skipped suite,
 *   timeout, error, unknown suite, inconsistent counts, missing
 *   required profile -> BLOCKED (never VERIFIED)
 * - any required suite FAIL -> FAIL / FAILED_VERIFICATION
 * - VERIFIED requires every required profile actually executed and
 *   passing on the same pinned base, with valid isolation, intact
 *   provenance and successful cleanup.
 *
 * Binding note (P5-C gap, recorded honestly): the P3 report shape
 * carries no candidate-tree digest field, so this mapping binds the
 * receipt to the proposal through receipt.job_id ===
 * proposal.job_id and receipt.head_pin === proposal.source.base_sha.
 * The P5-C adapter MUST pass the proposal job_id through as the P3
 * job_id; until then a mismatch refuses here. The candidate tree
 * digest is displayed, never silently assumed to match the run.
 */
import { ALL_PROFILE_IDS, JobRefusal } from "./jobContracts.js";

export const RECEIPT_MAPPING_VERSION = "programmer-receipt-mapping@1";

export const VERIFICATION_STATES = Object.freeze(["NOT_RUN", "PASS", "FAIL", "BLOCKED"]);

/** Which profiles a VERIFIED mapping requires to have actually run and passed. */
export function requiredProfilesForVerification(proposal) {
  // A proposal may name fewer profiles, but VERIFIED always demands
  // the full fixed set: syntax + baseline + candidate. A proposal
  // that ran fewer profiles can never be VERIFIED, only BLOCKED.
  void proposal;
  return [...ALL_PROFILE_IDS];
}

function blocked(reasonCodes, detail) {
  return { verification_state: "BLOCKED", lifecycle: "BLOCKED", reason_codes: reasonCodes, detail };
}

/**
 * Map a P3 receipt (or null) + proposal to the P5 verification
 * state. `proposal` must already have passed validateProposal;
 * malformed input refuses rather than mapping to a state.
 */
export function mapReceiptToVerification({ proposal, receipt, requiredProfiles } = {}) {
  if (!proposal || typeof proposal !== "object" || !proposal.source || !proposal.plan || !proposal.job_id) {
    throw new JobRefusal("BAD_PROPOSAL", "mapReceiptToVerification requires a validated proposal");
  }
  const required = requiredProfiles ?? requiredProfilesForVerification(proposal);
  for (const p of required) {
    if (!ALL_PROFILE_IDS.includes(p)) {
      throw new JobRefusal("BAD_PROPOSAL", `unknown required profile '${String(p)}'`);
    }
  }

  if (receipt === null || receipt === undefined) {
    return { verification_state: "NOT_RUN", lifecycle: "PROPOSED", reason_codes: ["RECEIPT_MISSING"], detail: "no P3 verification receipt is attached yet" };
  }
  if (receipt.agent !== "qa-test-runner" || receipt.schema_version !== "1") {
    return blocked(["RECEIPT_MALFORMED"], "receipt is not a P3 qa-test-runner report v1");
  }
  if (receipt.status === "REFUSED" || receipt.verdict === "REFUSED") {
    return blocked(["RECEIPT_REFUSED"], `P3 runner refused the job${receipt.reason_code ? `: ${receipt.reason_code}` : ""}`);
  }
  if (receipt.status !== "COMPLETED") {
    return blocked(["RECEIPT_MALFORMED"], `receipt status '${String(receipt.status)}' is not COMPLETED`);
  }
  if (receipt.job_id !== proposal.job_id) {
    return blocked(["RECEIPT_JOB_MISMATCH"], "receipt job_id does not match the proposal job_id");
  }
  if (receipt.head_pin !== proposal.source.base_sha) {
    return blocked(["STALE_BASE_DIGEST"], "receipt head_pin does not match the proposal base SHA");
  }
  if (!receipt.isolation || typeof receipt.isolation !== "object" || typeof receipt.isolation.mechanism !== "string") {
    return blocked(["ISOLATION_FAILURE"], "receipt carries no proven isolation mechanism");
  }
  if (!Array.isArray(receipt.suites)) {
    return blocked(["RECEIPT_MALFORMED"], "receipt suites must be an array");
  }

  // Every suite entry must be a known profile: an unrecognized
  // suite id is evidence the fixed registry was not used.
  const byId = new Map();
  for (const s of receipt.suites) {
    if (!s || typeof s !== "object" || typeof s.id !== "string") {
      return blocked(["RECEIPT_MALFORMED"], "receipt suite entry is malformed");
    }
    if (!ALL_PROFILE_IDS.includes(s.id)) {
      return blocked(["UNKNOWN_SUITE"], `receipt suite '${s.id}' is not a fixed P5 test profile`);
    }
    if (byId.has(s.id)) {
      return blocked(["INCONSISTENT_CLASSIFICATION"], `receipt repeats suite '${s.id}'`);
    }
    byId.set(s.id, s);
  }

  // Totals must agree with the suite entries; a PASS suite with
  // failed tests is an inconsistent classification, never a pass.
  const totals = receipt.totals;
  if (totals && typeof totals === "object") {
    const passed = receipt.suites.filter((s) => s.status === "PASS").length;
    const failed = receipt.suites.filter((s) => s.status === "FAIL").length;
    if (totals.suites_total !== receipt.suites.length || totals.suites_passed !== passed || totals.suites_failed !== failed) {
      return blocked(["INCONSISTENT_CLASSIFICATION"], "receipt totals disagree with the suite entries");
    }
  }

  const reasons = [];
  for (const profile of required) {
    const suite = byId.get(profile);
    if (!suite) {
      return blocked(["MISSING_REQUIRED_SUITE"], `required profile '${profile}' has no suite entry`);
    }
    if (suite.cleanup_failed === true) {
      return blocked(["CLEANUP_FAILED"], `suite '${profile}' reports a cleanup failure`);
    }
    if (suite.status === "SKIPPED_BUDGET") {
      return blocked(["SUITE_SKIPPED_BUDGET"], `suite '${profile}' was skipped on budget`);
    }
    if (suite.status === "TIMEOUT") {
      return blocked(["SUITE_TIMEOUT"], `suite '${profile}' timed out`);
    }
    if (suite.status === "ERROR") {
      return blocked(["SUITE_ERROR"], `suite '${profile}' errored (${suite.reason_code ?? "no reason code"})`);
    }
    if (suite.status === "FAIL") {
      reasons.push("SUITE_FAILED");
      continue;
    }
    if (suite.status === "PASS") {
      const counts = suite.test_counts;
      if (counts && typeof counts === "object" && (counts.failed > 0 || counts.total < counts.passed)) {
        return blocked(["INCONSISTENT_CLASSIFICATION"], `suite '${profile}' claims PASS with failed tests in its counts`);
      }
      if (Array.isArray(suite.failing_tests) && suite.failing_tests.length > 0) {
        return blocked(["INCONSISTENT_CLASSIFICATION"], `suite '${profile}' claims PASS while listing failing tests`);
      }
      continue;
    }
    return blocked(["RECEIPT_MALFORMED"], `suite '${profile}' has an unknown status '${String(suite.status)}'`);
  }

  if (reasons.length > 0) {
    return {
      verification_state: "FAIL",
      lifecycle: "FAILED_VERIFICATION",
      reason_codes: [...new Set(reasons)],
      detail: "one or more required suites failed",
    };
  }
  if (receipt.verdict !== "ALL_SUITES_PASS") {
    return blocked(["INCONSISTENT_CLASSIFICATION"], `receipt verdict '${String(receipt.verdict)}' does not agree with all required suites passing`);
  }
  return {
    verification_state: "PASS",
    lifecycle: "VERIFIED",
    reason_codes: ["OK"],
    detail: "every required profile executed and passed on the pinned base with valid isolation and successful cleanup",
  };
}
