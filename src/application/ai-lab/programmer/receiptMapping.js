/**
 * receiptMapping.js — versioned mapping from a P3 qa-test-runner
 * receipt to the P5 verification state and job lifecycle.
 *
 * Read against the real P3 contract
 * (scripts/ai-agents/qa-test-runner/src/schemas.js + report.js +
 * classify.js + isolation.js + runner.js):
 * a receipt carries schema_version "1", agent "qa-test-runner",
 * status COMPLETED|REFUSED, verdict
 * ALL_SUITES_PASS|SUITES_FAILED|REFUSED, a checkout_head that the
 * runner refuses to produce unless it equals the job pin, an
 * isolation object (or null), and suites[] with closed statuses
 * PASS|FAIL|ERROR|TIMEOUT|SKIPPED_BUDGET plus test_counts and a
 * cleanup_failed flag. This module calls NOTHING — it only reads a
 * receipt object the caller supplies. No test execution happens in
 * this slice.
 *
 * Fail-closed rules (all explicit):
 * - missing receipt -> NOT_RUN (nothing was verified yet)
 * - refused receipt, job-id mismatch, stale/mismatched base pin,
 *   checkout_head that is not the pinned base, unproven isolation,
 *   missing or incoherent suite counts, inconsistent totals,
 *   cleanup failure, skipped suite, timeout, error, unknown suite,
 *   missing required profile -> BLOCKED (never VERIFIED)
 * - any required suite FAIL -> FAIL / FAILED_VERIFICATION
 * - NO VERIFIED FROM A BARE P3 V1 RECEIPT (P5-A rule, binding):
 *   the P3 v1 report carries NO candidate-tree digest, so no
 *   receipt can prove which candidate tree the suites actually ran
 *   against. A report for the same job/base attaches to a proposal
 *   with ANY candidate digest. Until P5-C provides an independent
 *   candidate-identity attestation — a versioned trusted adapter
 *   attestation whose fields and trust origin are defined there,
 *   verified against independently collected runner evidence (never
 *   a self-asserted digest from the proposal) — every all-PASS
 *   receipt maps to BLOCKED / CANDIDATE_IDENTITY_UNPROVEN. The
 *   evidence checks below still run first, so each evidence gap
 *   reports its own reason code; the identity gate is the last
 *   step before a VERIFIED outcome that P5-A never emits.
 *
 * Evidence rules validated against the actual v1 contract:
 * - checkout_head: runner.js refuses a run whose resolved checkout
 *   HEAD differs from the job head_pin, so a genuine COMPLETED
 *   report always has checkout_head === head_pin. The mapping
 *   requires checkout_head === proposal.source.base_sha exactly.
 * - isolation: isolation.js proves exactly two mechanisms,
 *   "bwrap" and "unshare", via a real boundary probe; the runner
 *   refuses before execution when neither proves itself. The
 *   mapping accepts ONLY those two mechanism values — descriptive
 *   text fields (network/environment/...) are never proof, and an
 *   empty, "none" or unknown mechanism is not attestation.
 * - test_counts: classify.js always derives counts for every
 *   suite (ZERO_COUNTS when nothing ran), with the invariant
 *   total === passed + failed + skipped + todo and
 *   pending === skipped + todo. A suite entry without test_counts,
 *   or with counts breaking that invariant, is not a v1 report.
 * - totals: report.js computeTotals always emits all ten fields;
 *   the mapping requires totals present and every field agreeing
 *   with the suite entries (suite counts by status, test sums from
 *   test_counts).
 * - cleanup: the v1 report carries cleanup_failed per suite and
 *   no job-level field; the job-level outcome is every suite
 *   reporting cleanup_failed === false (the runner forces ERROR
 *   on any cleanup failure). Any true value blocks.
 */
import { ALL_PROFILE_IDS, JobRefusal } from "./jobContracts.js";

export const RECEIPT_MAPPING_VERSION = "programmer-receipt-mapping@2";

/** Mechanisms isolation.js can actually prove (detectIsolation). */
export const ISOLATION_MECHANISMS = Object.freeze(["bwrap", "unshare"]);

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

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

/**
 * Validate one suite entry's test_counts against the v1 contract
 * (classify.js deriveCounts): every field a non-negative integer,
 * total === passed + failed + skipped + todo, and
 * pending === skipped + todo. Returns a BLOCKED outcome or null
 * when the counts are coherent.
 */
function checkSuiteCounts(suite) {
  const counts = suite.test_counts;
  if (counts === undefined || counts === null) {
    return blocked(["COUNTS_MISSING"], `suite '${suite.id}' carries no test_counts — a P3 v1 report always derives counts`);
  }
  if (!isPlainObject(counts)) {
    return blocked(["COUNTS_MISSING"], `suite '${suite.id}' test_counts is not an object`);
  }
  for (const f of ["total", "passed", "failed", "pending", "skipped", "todo"]) {
    if (!isNonNegativeInt(counts[f])) {
      return blocked(["COUNTS_MISSING"], `suite '${suite.id}' test_counts.${f} must be a non-negative integer`);
    }
  }
  if (counts.total !== counts.passed + counts.failed + counts.skipped + counts.todo) {
    return blocked(
      ["INCONSISTENT_CLASSIFICATION"],
      `suite '${suite.id}' test_counts do not cohere: total ${counts.total} !== passed ${counts.passed} + failed ${counts.failed} + skipped ${counts.skipped} + todo ${counts.todo}`,
    );
  }
  if (counts.pending !== counts.skipped + counts.todo) {
    return blocked(
      ["INCONSISTENT_CLASSIFICATION"],
      `suite '${suite.id}' test_counts do not cohere: pending ${counts.pending} !== skipped ${counts.skipped} + todo ${counts.todo}`,
    );
  }
  return null;
}

/**
 * Map a P3 receipt (or null) + proposal to the P5 verification
 * state. `proposal` must already have passed validateProposal;
 * malformed input refuses rather than mapping to a state.
 *
 * P5-A emits no VERIFIED outcome: a bare P3 v1 receipt cannot
 * prove candidate identity (see module header). The highest
 * evidence-backed state for an all-PASS receipt is BLOCKED with
 * CANDIDATE_IDENTITY_UNPROVEN.
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
  // The runner refuses a run whose resolved checkout HEAD differs
  // from the job pin, so a genuine COMPLETED report always has
  // checkout_head === head_pin. A receipt whose checkout disagrees
  // with the pinned base ran against the wrong tree — its suites
  // prove nothing about this proposal, whatever they claim.
  if (typeof receipt.checkout_head !== "string" || receipt.checkout_head !== proposal.source.base_sha) {
    return blocked(
      ["CHECKOUT_HEAD_MISMATCH"],
      `receipt checkout_head '${String(receipt.checkout_head)}' does not equal the pinned base ${proposal.source.base_sha}`,
    );
  }
  // Isolation is attested only by a mechanism isolation.js can
  // prove ("bwrap" or "unshare"). Descriptive text is never proof:
  // an empty string, "none", or any other mechanism value is not
  // an attested isolation result.
  if (
    !isPlainObject(receipt.isolation) ||
    typeof receipt.isolation.mechanism !== "string" ||
    !ISOLATION_MECHANISMS.includes(receipt.isolation.mechanism)
  ) {
    return blocked(
      ["ISOLATION_FAILURE"],
      "receipt carries no attested isolation mechanism (only the proven 'bwrap' / 'unshare' mechanisms count as isolation evidence)",
    );
  }
  if (!Array.isArray(receipt.suites)) {
    return blocked(["RECEIPT_MALFORMED"], "receipt suites must be an array");
  }

  // Every suite entry must be a known profile with v1-shaped
  // evidence: an unrecognized suite id is evidence the fixed
  // registry was not used; a missing or incoherent test_counts is
  // not a v1 report; any cleanup failure blocks at the job level.
  const byId = new Map();
  for (const s of receipt.suites) {
    if (!isPlainObject(s) || typeof s.id !== "string") {
      return blocked(["RECEIPT_MALFORMED"], "receipt suite entry is malformed");
    }
    if (!ALL_PROFILE_IDS.includes(s.id)) {
      return blocked(["UNKNOWN_SUITE"], `receipt suite '${s.id}' is not a fixed P5 test profile`);
    }
    if (byId.has(s.id)) {
      return blocked(["INCONSISTENT_CLASSIFICATION"], `receipt repeats suite '${s.id}'`);
    }
    if (typeof s.cleanup_failed !== "boolean") {
      return blocked(["RECEIPT_MALFORMED"], `suite '${s.id}' cleanup_failed must be a boolean`);
    }
    if (s.cleanup_failed === true) {
      return blocked(["CLEANUP_FAILED"], `suite '${s.id}' reports a cleanup failure`);
    }
    const countsOutcome = checkSuiteCounts(s);
    if (countsOutcome) return countsOutcome;
    byId.set(s.id, s);
  }

  // Totals must be present (report.js always emits all ten fields)
  // and agree with the suite entries — suite counts by status and
  // test sums from test_counts. A missing or disagreeing totals
  // object is not a coherent v1 report.
  const totals = receipt.totals;
  if (!isPlainObject(totals)) {
    return blocked(["RECEIPT_MALFORMED"], "receipt carries no totals object — a P3 v1 report always emits totals");
  }
  const expectedTotals = {
    suites_total: receipt.suites.length,
    suites_passed: receipt.suites.filter((s) => s.status === "PASS").length,
    suites_failed: receipt.suites.filter((s) => s.status === "FAIL").length,
    suites_error: receipt.suites.filter((s) => s.status === "ERROR").length,
    suites_timeout: receipt.suites.filter((s) => s.status === "TIMEOUT").length,
    suites_skipped_budget: receipt.suites.filter((s) => s.status === "SKIPPED_BUDGET").length,
    tests_total: receipt.suites.reduce((n, s) => n + s.test_counts.total, 0),
    tests_passed: receipt.suites.reduce((n, s) => n + s.test_counts.passed, 0),
    tests_failed: receipt.suites.reduce((n, s) => n + s.test_counts.failed, 0),
    tests_pending: receipt.suites.reduce((n, s) => n + s.test_counts.pending, 0),
  };
  for (const [field, expected] of Object.entries(expectedTotals)) {
    if (totals[field] !== expected) {
      return blocked(
        ["INCONSISTENT_CLASSIFICATION"],
        `receipt totals.${field} is ${String(totals[field])} but the suite entries say ${expected}`,
      );
    }
  }

  const reasons = [];
  for (const profile of required) {
    const suite = byId.get(profile);
    if (!suite) {
      return blocked(["MISSING_REQUIRED_SUITE"], `required profile '${profile}' has no suite entry`);
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
      // Counts were already proven coherent above; a PASS suite
      // must additionally have run at least one passing test and
      // list no failing tests.
      if (suite.test_counts.failed > 0) {
        return blocked(["INCONSISTENT_CLASSIFICATION"], `suite '${profile}' claims PASS with failed tests in its counts`);
      }
      if (suite.test_counts.passed === 0) {
        return blocked(["INCONSISTENT_CLASSIFICATION"], `suite '${profile}' claims PASS having passed zero tests`);
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
  // Candidate-identity gate (P5-A, binding): the P3 v1 report
  // carries no candidate-tree digest, so this receipt cannot prove
  // the suites ran against the proposal's candidate tree — the
  // digest in the proposal is self-asserted display data, never
  // runner evidence. No VERIFIED from a bare P3 v1 receipt. P5-C
  // must supply an independent candidate-identity attestation
  // before any VERIFIED outcome exists.
  return blocked(
    ["CANDIDATE_IDENTITY_UNPROVEN"],
    "P3 report v1 carries no candidate-tree digest, so the candidate the suites ran against is unproven; P5-A never maps a bare P3 v1 receipt to VERIFIED",
  );
}
