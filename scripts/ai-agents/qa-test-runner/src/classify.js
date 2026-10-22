/**
 * classify.js — turn one suite's raw execution outcome into an exact
 * classification: PASS / FAIL / ERROR / TIMEOUT.
 *
 * Pure functions over recorded shapes (exit code, signal, timeout flag,
 * spawn error, and the parsed vitest JSON report). A suite whose vitest
 * output is missing or unparseable is ERROR — never PASS. PASS requires
 * exit code 0 AND a parsed report with success === true AND zero failed
 * tests AND zero failed test suites.
 */

/**
 * Parse vitest JSON reporter text. Returns the parsed object, or null
 * when the text is absent, empty, or not a vitest-shaped report.
 */
export function parseVitestJson(text) {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  if (!Array.isArray(v.testResults)) return null;
  return v;
}

function countFrom(json, key, fallback) {
  return Number.isInteger(json[key]) && json[key] >= 0 ? json[key] : fallback;
}

/** Test counts for a parsed report, cross-checked against its results. */
export function extractTestCounts(json) {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const tr of json.testResults) {
    for (const ar of tr.assertionResults ?? []) {
      if (ar.status === "passed") passed += 1;
      else if (ar.status === "failed") failed += 1;
      else pending += 1;
    }
  }
  const total = passed + failed + pending;
  return {
    total: countFrom(json, "numTotalTests", total),
    passed: countFrom(json, "numPassedTests", passed),
    failed: countFrom(json, "numFailedTests", failed),
    pending: countFrom(json, "numPendingTests", pending),
  };
}

/**
 * Failing tests as {name, file} pairs, sorted by (file, name) so the
 * report is deterministic regardless of vitest's emission order. A test
 * file that failed at suite level (load/parse error, no failed
 * assertions) contributes one entry naming the file and its error.
 */
export function extractFailingTests(json) {
  const out = [];
  for (const tr of json.testResults) {
    const file = typeof tr.name === "string" ? tr.name : "";
    let hasFailedAssertion = false;
    for (const ar of tr.assertionResults ?? []) {
      if (ar.status === "failed") {
        hasFailedAssertion = true;
        const name = typeof ar.fullName === "string" && ar.fullName.length > 0 ? ar.fullName : String(ar.title ?? "");
        out.push({ name, file });
      }
    }
    if (!hasFailedAssertion && tr.status === "failed") {
      const msg = typeof tr.message === "string" && tr.message.length > 0 ? tr.message.split("\n")[0] : "suite failed to run";
      out.push({ name: `${file} (suite error: ${msg})`, file });
    }
  }
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

const ZERO_COUNTS = Object.freeze({ total: 0, passed: 0, failed: 0, pending: 0 });

/**
 * Classify one executed suite.
 * input: {exitCode, signal, timedOut, outputExceeded, spawnError, json}
 *   exitCode: number|null, signal: string|null,
 *   spawnError: string|null (e.g. npx itself could not be spawned),
 *   json: parsed vitest report or null.
 * Returns {status, reason_code, reason, test_counts, failing_tests}.
 */
export function classifySuiteResult(input) {
  const { exitCode = null, timedOut = false, outputExceeded = false, spawnError = null, json = null } = input ?? {};
  const counts = json ? extractTestCounts(json) : { ...ZERO_COUNTS };
  const failing = json ? extractFailingTests(json) : [];

  if (timedOut) {
    return {
      status: "TIMEOUT",
      reason_code: "SUITE_TIMEOUT",
      reason: "suite exceeded its timeout and was killed",
      test_counts: counts,
      failing_tests: failing,
    };
  }
  if (spawnError) {
    return {
      status: "ERROR",
      reason_code: "SPAWN_FAILED",
      reason: `test process could not be spawned: ${spawnError}`,
      test_counts: { ...ZERO_COUNTS },
      failing_tests: [],
    };
  }
  if (outputExceeded) {
    return {
      status: "ERROR",
      reason_code: "OUTPUT_CAP_EXCEEDED",
      reason: "captured output exceeded the per-suite byte cap and the suite was killed",
      test_counts: counts,
      failing_tests: failing,
    };
  }
  if (json === null) {
    return {
      status: "ERROR",
      reason_code: "VITEST_OUTPUT_UNPARSEABLE",
      reason: `vitest JSON output missing or unparseable (exit code ${exitCode === null ? "none" : exitCode}) — never counted as a pass`,
      test_counts: { ...ZERO_COUNTS },
      failing_tests: [],
    };
  }
  if (counts.failed > 0) {
    return {
      status: "FAIL",
      reason_code: null,
      reason: null,
      test_counts: counts,
      failing_tests: failing,
    };
  }
  const failedSuites = countFrom(json, "numFailedTestSuites", 0);
  const suiteErrors = json.testResults.filter((tr) => tr.status === "failed");
  if (exitCode === 0 && json.success === true && failedSuites === 0 && suiteErrors.length === 0) {
    return {
      status: "PASS",
      reason_code: null,
      reason: null,
      test_counts: counts,
      failing_tests: [],
    };
  }
  if (suiteErrors.length > 0 || failedSuites > 0) {
    return {
      status: "ERROR",
      reason_code: "SUITE_LOAD_ERROR",
      reason: "one or more test files failed to run (suite-level error, no failing assertions)",
      test_counts: counts,
      failing_tests: failing,
    };
  }
  return {
    status: "ERROR",
    reason_code: "VITEST_EXIT_NONZERO",
    reason: `vitest exited ${exitCode === null ? "without a code" : `with code ${exitCode}`} without a passing report`,
    test_counts: counts,
    failing_tests: failing,
  };
}
