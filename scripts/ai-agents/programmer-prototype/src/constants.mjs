/**
 * constants.mjs — schema versions, budgets, statuses, reason codes.
 * Pure module: no I/O.
 */

export const TASK_SCHEMA_VERSION = 1;
export const RESULT_SCHEMA_VERSION = 1;
export const CORPUS_VERSION = 1;
export const CORPUS_SEED = "pa2-corpus-v1";
export const POLICY_VERSION = "pa2-policy-v1";
export const PROTOTYPE_VERSION = "0.1.0";

/** Host-enforced per-task budgets. Task payloads may only lower these. */
export const BUDGETS = {
  maxScopedReads: 40,
  maxBytesPerFile: 256 * 1024, // 256 KiB
  maxTotalContextBytes: 2 * 1024 * 1024, // 2 MiB
  maxTargetFiles: 3,
  maxAddedRemovedLines: 200,
  maxPatchBytes: 64 * 1024, // 64 KiB
  maxProfiles: 3,
  profileTimeoutMs: 30_000,
  totalWallMs: 120_000,
  maxWorkers: 1,
  maxMemoryMiB: 512, // JS heap via --max-old-space-size; address space capped at 2 GiB
  maxCapturedOutputBytes: 64 * 1024, // 64 KiB per stream
};

export const STATUS = {
  READY_FOR_REVIEW: "READY_FOR_REVIEW",
  BLOCKED: "BLOCKED",
  REFUSED: "REFUSED",
  FAILED_VERIFICATION: "FAILED_VERIFICATION",
};

/** Supported task families (slice 1). */
export const FAMILIES = {
  LITERAL_CORRECTION: "literal-correction",
  BOUNDARY_CORRECTION: "boundary-correction",
  ADD_HELPER: "add-helper",
};
export const SUPPORTED_FAMILIES = Object.values(FAMILIES);

/** Fixed execution profile IDs. No command strings come from tasks. */
export const PROFILES = {
  SYNTAX: "syntax",
  BASELINE: "baseline",
  CANDIDATE: "candidate",
};
export const ALL_PROFILE_IDS = Object.values(PROFILES);

export const OPERATIONS = { ADD: "add", MODIFY: "modify" };

/** Machine-readable reason codes. */
export const REASON = {
  OK: "OK",
  TASK_MALFORMED: "TASK_MALFORMED",
  SCHEMA_VERSION_UNSUPPORTED: "SCHEMA_VERSION_UNSUPPORTED",
  FAMILY_UNSUPPORTED: "FAMILY_UNSUPPORTED",
  AMBIGUOUS_TASK: "AMBIGUOUS_TASK",
  CONFLICTING_TASKS: "CONFLICTING_TASKS",
  NO_UNIQUE_ANCHOR: "NO_UNIQUE_ANCHOR",
  NO_CHANGE_NEEDED: "NO_CHANGE_NEEDED",
  INJECTION_FORBIDDEN_CAPABILITY: "INJECTION_FORBIDDEN_CAPABILITY",
  SECRET_REQUEST: "SECRET_REQUEST",
  PRODUCTION_INPUT: "PRODUCTION_INPUT",
  AUTH_MISSING: "AUTH_MISSING",
  AUTH_MISMATCH: "AUTH_MISMATCH",
  AUTH_REVOKED: "AUTH_REVOKED",
  BASE_UNAVAILABLE: "BASE_UNAVAILABLE",
  BASE_DRIFT: "BASE_DRIFT",
  REPO_UNKNOWN: "REPO_UNKNOWN",
  PATH_REJECTED: "PATH_REJECTED",
  OPERATION_FORBIDDEN: "OPERATION_FORBIDDEN",
  PATCH_MALFORMED: "PATCH_MALFORMED",
  PATCH_NOT_APPLICABLE: "PATCH_NOT_APPLICABLE",
  PATCH_STALE: "PATCH_STALE",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  ORACLE_TAMPER: "ORACLE_TAMPER",
  PROFILE_TAMPER: "PROFILE_TAMPER",
  ISOLATION_BLOCKED: "ISOLATION_BLOCKED",
  TOOL_MISSING: "TOOL_MISSING",
  TEST_FAILED: "TEST_FAILED",
  ORACLE_FAILED: "ORACLE_FAILED",
  BASELINE_UNEXPECTED: "BASELINE_UNEXPECTED",
  ESCAPE_CONTAINED: "ESCAPE_CONTAINED",
  AUDIT_FAILED: "AUDIT_FAILED",
  CLEANUP_FAILED: "CLEANUP_FAILED",
  REPLAY_MISMATCH: "REPLAY_MISMATCH",
  TIMEOUT: "TIMEOUT",
  OUTPUT_OVERRUN: "OUTPUT_OVERRUN",
};
