/**
 * classify.js — turn one suite's raw execution outcome into an exact
 * classification: PASS / FAIL / ERROR / TIMEOUT.
 *
 * Pure functions over recorded shapes (exit code, signal, timeout flag,
 * spawn error, and the parsed vitest JSON report). Evidence discipline:
 *
 * - Counts are DERIVED from the assertion/file records, never taken
 *   from the header. Header totals are cross-checked against the
 *   derived values; any disagreement is INCONSISTENT_REPORT (ERROR) —
 *   header truth never overrides observed results.
 * - Any observed failed assertion or failed file precludes PASS,
 *   independently of header totals and of `success`.
 * - Malformed reporter structure (wrong types in load-bearing fields)
 *   is MALFORMED_REPORT (ERROR), and every function here is bounded
 *   and total: no shape of input can make classification throw.
 * - Extracted failing-test records are bounded: at most
 *   MAX_FAILING_TESTS entries, each name/file truncated, with the true
 *   total and a truncation flag reported alongside.
 */

export const MAX_FAILING_TESTS = 100;
const MAX_FIELD_CHARS = 512;

function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function truncStr(v) {
  return v.length > MAX_FIELD_CHARS ? v.slice(0, MAX_FIELD_CHARS) : v;
}

/**
 * Parse vitest JSON reporter text. Returns the parsed object, or null
 * when the text is absent, empty, or not a vitest-shaped report.
 * (Deep structural validation happens in validateReportShape.)
 */
export function parseVitestJson(text) {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  if (!Array.isArray(v.testResults)) return null;
  return v;
}

const COUNT_FIELDS = Object.freeze([
  "numTotalTests",
  "numPassedTests",
  "numFailedTests",
  "numPendingTests",
  "numTotalTestSuites",
  "numFailedTestSuites",
]);

/**
 * Structural validation of a parsed report. Returns null when the
 * shape is sound, or a short reason string when it is malformed.
 * Bounded: iterates the records once, checks types only.
 */
export function validateReportShape(json) {
  if (!isRecord(json)) return "report is not an object";
  if (!Array.isArray(json.testResults)) return "testResults is not an array";
  for (const k of COUNT_FIELDS) {
    if (json[k] !== undefined && !(Number.isInteger(json[k]) && json[k] >= 0)) {
      return `header field ${k} is not a non-negative integer`;
    }
  }
  if (json.success !== undefined && typeof json.success !== "boolean") {
    return "header field success is not a boolean";
  }
  for (const tr of json.testResults) {
    if (!isRecord(tr)) return "a testResults entry is not an object";
    if (tr.name !== undefined && typeof tr.name !== "string") return "a test result name is not a string";
    if (tr.status !== undefined && typeof tr.status !== "string") return "a test result status is not a string";
    if (tr.assertionResults !== undefined) {
      if (!Array.isArray(tr.assertionResults)) return "assertionResults is not an array";
      for (const ar of tr.assertionResults) {
        if (!isRecord(ar)) return "an assertionResults entry is not an object";
        if (typeof ar.status !== "string") return "an assertion result has no string status";
      }
    }
  }
  return null;
}

/** Counts derived from the records themselves — the ground truth. */
export function deriveCounts(json) {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let failedFiles = 0;
  for (const tr of json.testResults) {
    if (tr.status === "failed") failedFiles += 1;
    for (const ar of tr.assertionResults ?? []) {
      if (ar.status === "passed") passed += 1;
      else if (ar.status === "failed") failed += 1;
      else pending += 1;
    }
  }
  return {
    counts: { total: passed + failed + pending, passed, failed, pending },
    failedFiles,
    totalFiles: json.testResults.length,
  };
}

/** Test counts for a parsed report — DERIVED, never header-copied. */
export function extractTestCounts(json) {
  return deriveCounts(json).counts;
}

/**
 * Failing tests as {name, file} pairs, sorted by (file, name) so the
 * report is deterministic regardless of vitest's emission order. A test
 * file that failed at suite level (load/parse error, no failed
 * assertions) contributes one entry naming the file and its error.
 * Bounded: at most MAX_FAILING_TESTS entries; `total` is the true
 * count and `truncated` says whether entries were dropped.
 */
export function extractFailingTestsBounded(json) {
  const all = [];
  for (const tr of json.testResults) {
    const file = typeof tr.name === "string" ? truncStr(tr.name) : "";
    let hasFailedAssertion = false;
    for (const ar of tr.assertionResults ?? []) {
      if (ar.status === "failed") {
        hasFailedAssertion = true;
        const raw = typeof ar.fullName === "string" && ar.fullName.length > 0 ? ar.fullName : String(ar.title ?? "");
        all.push({ name: truncStr(raw), file });
      }
    }
    if (!hasFailedAssertion && tr.status === "failed") {
      const msg = typeof tr.message === "string" && tr.message.length > 0 ? tr.message.split("\n")[0] : "suite failed to run";
      all.push({ name: truncStr(`${file} (suite error: ${msg})`), file });
    }
  }
  all.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    tests: all.slice(0, MAX_FAILING_TESTS),
    total: all.length,
    truncated: all.length > MAX_FAILING_TESTS,
  };
}

/** Back-compatible list form (bounded to MAX_FAILING_TESTS entries). */
export function extractFailingTests(json) {
  return extractFailingTestsBounded(json).tests;
}

/**
 * Cross-check header totals against derived counts. Returns null when
 * every present header field agrees with the records, or a reason
 * string naming the first disagreement. `success` coherence is checked
 * by the caller (it interacts with the exit code).
 *
 * Only the TEST counters are reconciled: vitest defines them over the
 * same units the records enumerate (one assertionResult per test).
 * The SUITE counters are deliberately NOT reconciled — real vitest
 * counts describe blocks in numTotalTestSuites/numPassedTestSuites
 * while testResults is per-file (a one-file, one-describe pass reports
 * numTotalTestSuites=2 against a single testResults entry; verified
 * against vitest 4.1.9 in the PR #665 exact-head receipt run). Failed
 * FILES are taken from the records directly (deriveCounts), never
 * from numFailedTestSuites.
 */
export function reconcileHeader(json, derived) {
  const pairs = [
    ["numTotalTests", derived.counts.total],
    ["numPassedTests", derived.counts.passed],
    ["numFailedTests", derived.counts.failed],
    ["numPendingTests", derived.counts.pending],
  ];
  for (const [key, derivedValue] of pairs) {
    if (json[key] !== undefined && json[key] !== derivedValue) {
      return `header ${key}=${json[key]} disagrees with derived count ${derivedValue}`;
    }
  }
  return null;
}

const ZERO_COUNTS = Object.freeze({ total: 0, passed: 0, failed: 0, pending: 0 });

function result({ status, reason_code = null, reason = null, test_counts, failing }) {
  return {
    status,
    reason_code,
    reason,
    test_counts,
    failing_tests: failing ? failing.tests : [],
    failing_tests_total: failing ? failing.total : 0,
    failing_tests_truncated: failing ? failing.truncated : false,
  };
}

/**
 * Classify one executed suite.
 * input: {exitCode, signal, timedOut, outputExceeded, reporterExceeded,
 *         spawnError, json}
 *   exitCode: number|null, signal: string|null,
 *   spawnError: string|null (e.g. npx itself could not be spawned),
 *   reporterExceeded: boolean (reporter file over its byte budget —
 *         the file was never read, so json is null),
 *   json: parsed vitest report or null.
 * Returns {status, reason_code, reason, test_counts, failing_tests,
 *          failing_tests_total, failing_tests_truncated}.
 * Never throws, whatever the report shape.
 */
export function classifySuiteResult(input) {
  try {
    return classifyInner(input ?? {});
  } catch {
    return result({
      status: "ERROR",
      reason_code: "MALFORMED_REPORT",
      reason: "vitest report could not be structurally validated",
      test_counts: { ...ZERO_COUNTS },
      failing: null,
    });
  }
}

function classifyInner(input) {
  const {
    exitCode = null,
    timedOut = false,
    outputExceeded = false,
    reporterExceeded = false,
    spawnError = null,
    json = null,
  } = input;

  if (timedOut) {
    const shaped = json && !validateReportShape(json);
    const derived = shaped ? deriveCounts(json) : null;
    return result({
      status: "TIMEOUT",
      reason_code: "SUITE_TIMEOUT",
      reason: "suite exceeded its timeout and was killed",
      test_counts: derived ? derived.counts : { ...ZERO_COUNTS },
      failing: shaped ? extractFailingTestsBounded(json) : null,
    });
  }
  if (spawnError) {
    return result({
      status: "ERROR",
      reason_code: "SPAWN_FAILED",
      reason: `test process could not be spawned: ${spawnError}`,
      test_counts: { ...ZERO_COUNTS },
      failing: null,
    });
  }
  if (outputExceeded) {
    return result({
      status: "ERROR",
      reason_code: "OUTPUT_CAP_EXCEEDED",
      reason: "captured stdout/stderr exceeded the per-suite byte cap and the suite was killed",
      test_counts: { ...ZERO_COUNTS },
      failing: null,
    });
  }
  if (reporterExceeded) {
    return result({
      status: "ERROR",
      reason_code: "REPORTER_CAP_EXCEEDED",
      reason: "vitest JSON reporter file exceeded the per-suite reporter byte budget; it was not read or parsed",
      test_counts: { ...ZERO_COUNTS },
      failing: null,
    });
  }
  if (json === null) {
    return result({
      status: "ERROR",
      reason_code: "VITEST_OUTPUT_UNPARSEABLE",
      reason: `vitest JSON output missing or unparseable (exit code ${exitCode === null ? "none" : exitCode}) — never counted as a pass`,
      test_counts: { ...ZERO_COUNTS },
      failing: null,
    });
  }

  const malformed = validateReportShape(json);
  if (malformed) {
    return result({
      status: "ERROR",
      reason_code: "MALFORMED_REPORT",
      reason: `vitest report is malformed: ${malformed}`,
      test_counts: { ...ZERO_COUNTS },
      failing: null,
    });
  }

  const derived = deriveCounts(json);
  const failing = extractFailingTestsBounded(json);
  const observedFailure = derived.counts.failed > 0 || derived.failedFiles > 0;

  const inconsistent = reconcileHeader(json, derived);
  if (inconsistent) {
    return result({
      status: "ERROR",
      reason_code: "INCONSISTENT_REPORT",
      reason: `vitest report is internally inconsistent: ${inconsistent}`,
      test_counts: derived.counts,
      failing,
    });
  }
  if (json.success === true && observedFailure) {
    return result({
      status: "ERROR",
      reason_code: "INCONSISTENT_REPORT",
      reason: "vitest report claims success=true while its records contain failures",
      test_counts: derived.counts,
      failing,
    });
  }

  // Any observed failed assertion precludes PASS, header or not.
  if (derived.counts.failed > 0) {
    return result({ status: "FAIL", test_counts: derived.counts, failing });
  }
  // Failed files with no failed assertions: the suite(s) failed to run.
  if (derived.failedFiles > 0) {
    return result({
      status: "ERROR",
      reason_code: "SUITE_LOAD_ERROR",
      reason: "one or more test files failed to run (suite-level error, no failing assertions)",
      test_counts: derived.counts,
      failing,
    });
  }
  if (exitCode === 0 && json.success === true) {
    return result({ status: "PASS", test_counts: derived.counts, failing: { tests: [], total: 0, truncated: false } });
  }
  if (exitCode === 0 && json.success === false) {
    return result({
      status: "ERROR",
      reason_code: "INCONSISTENT_REPORT",
      reason: "vitest report claims success=false while every recorded test passed",
      test_counts: derived.counts,
      failing,
    });
  }
  return result({
    status: "ERROR",
    reason_code: "VITEST_EXIT_NONZERO",
    reason: `vitest exited ${exitCode === null ? "without a code" : `with code ${exitCode}`} without a passing report`,
    test_counts: derived.counts,
    failing,
  });
}
