// Team Brain slice 3 — orchestrator error codes.
//
// The controller and outbox reuse the slice-1 typed error (`TeamBrainError`
// + `fail`) so every guard rejection carries a stable machine-readable code.
// P3 adds its own codes below; slice-1 codes (SELF_DEPENDENCY,
// DEPENDENCY_CYCLE, CYCLE_DETECTED, INVALID_OVERRIDE, DUPLICATE_OPERATION,
// CONFLICTING_REPLAY) are reused where the meaning is identical.

export { CODES, fail, TeamBrainError } from "../ledger/errors.mjs";

export const P3_CODES = {
  // Assignment / agent scoping
  NO_SCOPED_AGENT: "NO_SCOPED_AGENT",
  ALL_AGENTS_BUSY: "ALL_AGENTS_BUSY",
  REVOKED_OVERRIDE: "REVOKED_OVERRIDE",
  STALE_SNAPSHOT: "STALE_SNAPSHOT",
  // Leases
  STALE_LEASE: "STALE_LEASE",
  LEASE_EXPIRED: "LEASE_EXPIRED",
  LEASE_HELD: "LEASE_HELD",
  // Result validation
  MALFORMED_RESULT: "MALFORMED_RESULT",
  MALFORMED_LIMIT: "MALFORMED_LIMIT",
  RETRY_LIMIT: "RETRY_LIMIT",
  ALREADY_TERMINAL: "ALREADY_TERMINAL",
  NOT_EXECUTING: "NOT_EXECUTING",
  UNKNOWN_TASK: "UNKNOWN_TASK",
  // Outbox
  CAS_CONFLICT: "CAS_CONFLICT",
  PATH_MISMATCH: "PATH_MISMATCH",
  DISALLOWED_PATH: "DISALLOWED_PATH",
  DISALLOWED_REPO: "DISALLOWED_REPO",
  REPO_MISMATCH: "REPO_MISMATCH",
  INVALID_OUTBOX_ENTRY: "INVALID_OUTBOX_ENTRY",
  PAYLOAD_DRIFT: "PAYLOAD_DRIFT",
  INTENT_CANCELLED: "INTENT_CANCELLED",
  STALE_INTENT: "STALE_INTENT",
  // Fix round 2 (TBP3-006A): a task-derived intent claimed or delivered
  // without the authoritative task collection.
  APPLICABILITY_REQUIRED: "APPLICABILITY_REQUIRED",
  // Fix round 1 (TBP3-004/010)
  TIMEOUT_LIMIT: "TIMEOUT_LIMIT",
  NOT_WAITING: "NOT_WAITING",
  EVENT_MISMATCH: "EVENT_MISMATCH",
};
