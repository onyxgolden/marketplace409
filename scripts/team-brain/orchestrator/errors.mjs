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
  INVALID_OUTBOX_ENTRY: "INVALID_OUTBOX_ENTRY",
};
