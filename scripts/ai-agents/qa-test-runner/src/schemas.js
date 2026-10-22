/**
 * schemas.js — strict job-spec validation + budget charging for the
 * QA test-runner.
 *
 * Strict by design (sibling conventions): unknown properties are rejected
 * in control-bearing objects, duplicate suite ids are rejected, pins must
 * be full 40-hex lowercase Git object IDs, and every count is bounded.
 * Free-form shell commands are refused structurally: a suite carries only
 * an id + vitest test-path patterns (+ optional timeout); the runner
 * constructs argv itself, never from the job.
 *
 * Budget discipline (house rule): budgets are CHARGED BEFORE any suite is
 * validated in detail and before anything executes. Charging walks the
 * suites in job order and charges each candidate (one suite slot, its
 * pattern slots, its timeout) BEFORE that candidate's fields are
 * validated. A candidate sitting PAST a limit therefore dies on
 * BUDGET_EXCEEDED — never on a validation error for its (unexamined)
 * contents, and never by running.
 */

const HEX40 = /^[0-9a-f]{40}$/;

export function isHex40(s) {
  return typeof s === "string" && HEX40.test(s);
}

/** Hard caps. A job may tighten budgets below these, never loosen them. */
export const BUDGET_LIMITS = Object.freeze({
  maxJobBytes: 64 * 1024,
  maxSuites: 16,
  maxPatternsPerSuite: 32,
  maxPerSuiteTimeoutMs: 120_000,
  maxPerJobTimeoutMs: 600_000,
  maxCapturedBytesPerSuite: 8 * 1024 * 1024,
});

export const BUDGET_DEFAULTS = Object.freeze({
  maxSuites: BUDGET_LIMITS.maxSuites,
  maxPatternsPerSuite: BUDGET_LIMITS.maxPatternsPerSuite,
  perSuiteTimeoutMs: 60_000,
  perJobTimeoutMs: 300_000,
  maxCapturedBytesPerSuite: 1024 * 1024,
});

const MAX_ID_LEN = 128;
const MAX_TARGET_LEN = 1024;
const MAX_PATTERN_LEN = 512;

const JOB_KEYS = Object.freeze(["job_id", "target", "head_pin", "suites", "budgets"]);
const SUITE_KEYS = Object.freeze(["id", "patterns", "timeout_ms"]);
const BUDGET_KEYS = Object.freeze([
  "max_suites",
  "max_patterns_per_suite",
  "per_suite_timeout_ms",
  "per_job_timeout_ms",
  "max_captured_bytes_per_suite",
]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v, maxLen) {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0 && Number.isFinite(v);
}

class Collector {
  constructor() {
    this.errors = [];
  }
  add(code, path, message) {
    this.errors.push({ code, path, message });
  }
  get ok() {
    return this.errors.length === 0;
  }
}

function exactKeys(c, obj, allowed, path) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      c.add("UNKNOWN_PROPERTY", path, `unknown property "${k}"`);
    }
  }
}

function budgetExceeded(path, message) {
  return {
    ok: false,
    budgetExceeded: true,
    errors: [{ code: "BUDGET_EXCEEDED", path, message }],
    budgets: null,
  };
}

/**
 * Resolve the effective budgets for a job whose `budgets` object has
 * already passed type validation. Values above the hard caps are a
 * budget failure, not a validation failure.
 */
function resolveBudgets(raw) {
  const b = raw ?? {};
  const eff = {
    maxSuites: b.max_suites ?? BUDGET_DEFAULTS.maxSuites,
    maxPatternsPerSuite: b.max_patterns_per_suite ?? BUDGET_DEFAULTS.maxPatternsPerSuite,
    perSuiteTimeoutMs: b.per_suite_timeout_ms ?? BUDGET_DEFAULTS.perSuiteTimeoutMs,
    perJobTimeoutMs: b.per_job_timeout_ms ?? BUDGET_DEFAULTS.perJobTimeoutMs,
    maxCapturedBytesPerSuite: b.max_captured_bytes_per_suite ?? BUDGET_DEFAULTS.maxCapturedBytesPerSuite,
  };
  const caps = [
    ["maxSuites", eff.maxSuites, BUDGET_LIMITS.maxSuites, "$.budgets.max_suites"],
    ["maxPatternsPerSuite", eff.maxPatternsPerSuite, BUDGET_LIMITS.maxPatternsPerSuite, "$.budgets.max_patterns_per_suite"],
    ["perSuiteTimeoutMs", eff.perSuiteTimeoutMs, BUDGET_LIMITS.maxPerSuiteTimeoutMs, "$.budgets.per_suite_timeout_ms"],
    ["perJobTimeoutMs", eff.perJobTimeoutMs, BUDGET_LIMITS.maxPerJobTimeoutMs, "$.budgets.per_job_timeout_ms"],
    ["maxCapturedBytesPerSuite", eff.maxCapturedBytesPerSuite, BUDGET_LIMITS.maxCapturedBytesPerSuite, "$.budgets.max_captured_bytes_per_suite"],
  ];
  for (const [, value, cap, path] of caps) {
    if (value > cap) return { error: budgetExceeded(path, `requested budget ${value} exceeds hard cap ${cap}`) };
  }
  return { budgets: Object.freeze(eff) };
}

function validateBudgetsShape(c, raw, path) {
  if (raw === undefined) return;
  if (!isPlainObject(raw)) {
    c.add("INVALID_BUDGETS", path, "budgets must be an object");
    return;
  }
  exactKeys(c, raw, BUDGET_KEYS, path);
  for (const k of BUDGET_KEYS) {
    if (raw[k] !== undefined && !isPositiveInt(raw[k])) {
      c.add("INVALID_BUDGET", `${path}.${k}`, `${k} must be a positive integer`);
    }
  }
}

function validateSuiteFields(c, suite, path, seenIds) {
  if (!isPlainObject(suite)) {
    c.add("INVALID_SUITE", path, "suite must be an object");
    return;
  }
  exactKeys(c, suite, SUITE_KEYS, path);
  if (!isNonEmptyString(suite.id, MAX_ID_LEN)) {
    c.add("INVALID_ID", `${path}.id`, "suite id must be a non-empty string");
  } else if (seenIds.has(suite.id)) {
    c.add("DUPLICATE_ID", `${path}.id`, `duplicate suite id "${suite.id}"`);
  } else {
    seenIds.add(suite.id);
  }
  if (!Array.isArray(suite.patterns) || suite.patterns.length === 0) {
    c.add("INVALID_PATTERNS", `${path}.patterns`, "patterns must be a non-empty array of test path patterns");
  } else {
    for (const [j, p] of suite.patterns.entries()) {
      const pp = `${path}.patterns[${j}]`;
      if (!isNonEmptyString(p, MAX_PATTERN_LEN)) {
        c.add("INVALID_PATTERN", pp, "pattern must be a non-empty string");
      } else if (p.startsWith("-")) {
        // A leading dash would be parsed by vitest as a flag, not a path:
        // argv is constructed by the runner, so flag injection is refused.
        c.add("INVALID_PATTERN", pp, "pattern must be a test path, not a flag (leading '-' refused)");
      } else if (p.includes("\0") || p.includes("\n") || p.includes("\r")) {
        c.add("INVALID_PATTERN", pp, "pattern must not contain NUL or newline characters");
      }
    }
  }
  if (suite.timeout_ms !== undefined && !isPositiveInt(suite.timeout_ms)) {
    c.add("INVALID_TIMEOUT", `${path}.timeout_ms`, "timeout_ms must be a positive integer");
  }
}

/**
 * Validate a job spec. Returns {ok, errors, budgetExceeded, budgets}.
 * Budget charging is interleaved with validation: each suite candidate is
 * charged (suite slot, pattern slots, timeout) BEFORE its fields are
 * validated, so an over-budget job is refused with BUDGET_EXCEEDED even
 * when the entry past the limit is itself malformed. Never throws on
 * user data.
 */
export function validateJob(job) {
  const c = new Collector();
  if (!isPlainObject(job)) {
    c.add("INVALID_JOB", "$", "job must be an object");
    return { ok: false, errors: c.errors, budgetExceeded: false, budgets: null };
  }
  exactKeys(c, job, JOB_KEYS, "$");
  if (job.job_id !== undefined && !isNonEmptyString(job.job_id, MAX_ID_LEN)) {
    c.add("INVALID_ID", "$.job_id", "job_id must be a non-empty string");
  }
  if (!isNonEmptyString(job.target, MAX_TARGET_LEN)) {
    c.add("INVALID_TARGET", "$.target", "target must be a non-empty checkout path string");
  }
  if (!isHex40(job.head_pin)) {
    c.add("MALFORMED_PIN", "$.head_pin", "head_pin must be 40-hex lowercase");
  }
  validateBudgetsShape(c, job.budgets, "$.budgets");
  if (!Array.isArray(job.suites)) {
    c.add("INVALID_SUITES", "$.suites", "suites must be an array");
  }
  if (!c.ok) return { ok: false, errors: c.errors, budgetExceeded: false, budgets: null };

  const jobBytes = Buffer.byteLength(JSON.stringify(job), "utf8");
  if (jobBytes > BUDGET_LIMITS.maxJobBytes) {
    c.add("INPUT_LIMIT", "$", `job exceeds ${BUDGET_LIMITS.maxJobBytes} bytes`);
    return { ok: false, errors: c.errors, budgetExceeded: false, budgets: null };
  }
  if (job.suites.length === 0) {
    c.add("INVALID_SUITES", "$.suites", "suites must name at least one suite");
    return { ok: false, errors: c.errors, budgetExceeded: false, budgets: null };
  }

  const resolved = resolveBudgets(job.budgets);
  if (resolved.error) return resolved.error;
  const eff = resolved.budgets;

  // Charge-before-validate walk. Each candidate is charged before its
  // contents are examined; the first over-budget charge ends the walk
  // with BUDGET_EXCEEDED and the remaining candidates are never read.
  const seenIds = new Set();
  let chargedTimeoutMs = 0;
  for (const [i, suite] of job.suites.entries()) {
    const path = `$.suites[${i}]`;
    // Charge 1: the suite slot itself.
    if (i + 1 > eff.maxSuites) {
      return budgetExceeded(path, `suite count budget exceeded: suite #${i + 1} exceeds max_suites ${eff.maxSuites}`);
    }
    if (isPlainObject(suite)) {
      // Charge 2: the suite's pattern slots (count only — values unread).
      if (Array.isArray(suite.patterns) && suite.patterns.length > eff.maxPatternsPerSuite) {
        return budgetExceeded(
          `${path}.patterns`,
          `pattern budget exceeded: ${suite.patterns.length} patterns exceeds max_patterns_per_suite ${eff.maxPatternsPerSuite}`
        );
      }
      // Charge 3: the suite's DECLARED timeout against the per-suite cap
      // and the running per-job total. Only declared timeouts are charged
      // up front: an undeclared suite is bounded at runtime by
      // min(per-suite budget, remaining per-job budget), so the per-job
      // bound holds absolutely without refusing coherent jobs whose
      // suites simply omit a timeout. A non-numeric timeout charges
      // nothing here; field validation below names it instead.
      const t = suite.timeout_ms;
      if (typeof t === "number" && Number.isFinite(t)) {
        if (t > eff.perSuiteTimeoutMs) {
          return budgetExceeded(`${path}.timeout_ms`, `per-suite timeout budget exceeded: ${t}ms exceeds ${eff.perSuiteTimeoutMs}ms`);
        }
        chargedTimeoutMs += t;
        if (chargedTimeoutMs > eff.perJobTimeoutMs) {
          return budgetExceeded(
            `${path}.timeout_ms`,
            `per-job timeout budget exceeded: charged ${chargedTimeoutMs}ms exceeds ${eff.perJobTimeoutMs}ms`
          );
        }
      }
    }
    // Only now are this (in-budget) candidate's fields validated.
    validateSuiteFields(c, suite, path, seenIds);
    if (!c.ok) return { ok: false, errors: c.errors, budgetExceeded: false, budgets: eff };
  }
  return { ok: c.ok, errors: c.errors, budgetExceeded: false, budgets: eff };
}

/** Effective per-suite timeout for a validated job + suite. */
export function suiteTimeoutMs(job, suite, budgets) {
  return suite.timeout_ms ?? budgets.perSuiteTimeoutMs;
}
