/**
 * qa-test-runner — public entry.
 * Pure Node 24 ESM, zero runtime dependencies.
 */
export { validateJob, isHex40, BUDGET_LIMITS, BUDGET_DEFAULTS, suiteTimeoutMs } from "./schemas.js";
export { parseVitestJson, extractTestCounts, extractFailingTests, classifySuiteResult } from "./classify.js";
export { runJob, resolveHead, vitestResolvable } from "./runner.js";
export { canonicalize, canonicalJson, AGENT_ID, SCHEMA_VERSION } from "./report.js";
export { reportToMarkdown } from "./markdown.js";
