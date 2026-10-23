/**
 * qa-test-runner — public entry.
 * Pure Node 24 ESM, zero runtime dependencies.
 */
export { validateJob, isHex40, BUDGET_LIMITS, BUDGET_DEFAULTS, MIN_REPORT_BYTES, suiteTimeoutMs } from "./schemas.js";
export { admitValue, ADMISSION_LIMITS } from "./admit.js";
export {
  parseVitestJson,
  validateReportShape,
  deriveCounts,
  reconcileHeader,
  extractTestCounts,
  extractFailingTests,
  extractFailingTestsBounded,
  classifySuiteResult,
  MAX_FAILING_TESTS,
} from "./classify.js";
export { runJob, resolveHead, snapshotWorkingTree, vitestResolvable, isolationAvailable } from "./runner.js";
export { detectIsolation, buildIsolatedSpawn, scrubbedEnv } from "./isolation.js";
export { canonicalize, canonicalJson, AGENT_ID, SCHEMA_VERSION } from "./report.js";
export { refusalReport, completedReport, emptySuiteEntry, computeTotals } from "./report.js";
export { enforceReportBytes, minimalEnvelope, reportBytes, validateReducedEnvelope } from "./report-bounds.js";
export { reportToMarkdown } from "./markdown.js";
