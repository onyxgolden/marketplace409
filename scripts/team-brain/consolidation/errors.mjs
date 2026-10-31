// Team Brain P6 — consolidation / replay error codes. Reuses
// TeamBrainError/fail from the ledger so P6 refusals assert exactly
// like every other slice.

import { CODES, TeamBrainError, fail } from "../ledger/errors.mjs";

export { CODES, TeamBrainError, fail };

export const P6_CODES = {
  ...CODES,
  // SLOT_NOT_DUE: the run's civil date slot (03:00 America/Chicago)
  // has not arrived yet. Due-slot logic only — no early runs, no
  // ad-hoc runs for a future date.
  SLOT_NOT_DUE: "SLOT_NOT_DUE",
  // LEASE_HELD: another holder owns the cooperative lease (two-worker
  // case), or a crashed holder's lease is still standing and the
  // caller did not pass an explicit recover claim. In-process only;
  // never a cross-process fencing guarantee.
  LEASE_HELD: "LEASE_HELD",
  // ROLE_DENIED: the caller is not tb_consolidator. The apply step
  // (fact promotion + fact archiving) runs only through that role.
  // Least-privileged callers get the analysis and zero persisted
  // effects: the run fails fast before any write.
  ROLE_DENIED: "ROLE_DENIED",
  // INVALID_RUN_DATE: not a YYYY-MM-DD civil date.
  INVALID_RUN_DATE: "INVALID_RUN_DATE",
  // UNKNOWN_RUN: no run ledger row for the requested date (audit
  // export / readback of a date that never ran).
  UNKNOWN_RUN: "UNKNOWN_RUN",
  // AUTHORIZATION_REQUIRED: an explicit STANDING_RULE or
  // PERMISSION_CHANGE proposal carries no authorization record.
  // Episode text is never authority; only Jason's word, recorded as
  // an authorization id + note, files one of these.
  AUTHORIZATION_REQUIRED: "AUTHORIZATION_REQUIRED",
  // INVALID_PROPOSAL: unknown proposal type, unknown fields, or a
  // proposal shape outside the closed schema.
  INVALID_PROPOSAL: "INVALID_PROPOSAL",
  // MISSING_PREREQUISITE: the P5 schema (tb_episodes) is not
  // applied, so the P6 schema — whose facts table references
  // tb_episodes — cannot be created. Apply retrieval/schema.sql
  // first. The raw 42P01 is deliberately not left to confuse.
  MISSING_PREREQUISITE: "MISSING_PREREQUISITE",
  // PRINCIPAL_MISMATCH: a stored receipt, binding, or audit export
  // belongs to a different run principal than the caller. Receipts
  // are bound to the visibility principal that produced them; a
  // denied principal never receives another principal's selection,
  // fact ids, counts, or audit payloads (fix round 1, TBP6-001).
  PRINCIPAL_MISMATCH: "PRINCIPAL_MISMATCH",
  // SLOT_MISSED: the requested civil date was already recorded
  // MISSED. Missed slots are terminal for ordinary execution and
  // are never backfilled (fix round 1, TBP6-003).
  SLOT_MISSED: "SLOT_MISSED",
  // SLOT_EXPIRED: a fresh execution for a civil date that is not
  // the current America/Chicago civil date. Historical dates are
  // never executed ad hoc; only a stored INCOMPLETE run resumes
  // (fix round 1, TBP6-003).
  SLOT_EXPIRED: "SLOT_EXPIRED",
  // LIMIT_EXCEEDED: the per-run selection limit exceeds the trusted
  // configuration maximum. Limits are host-owned; caller expansion
  // is refused before any write (fix round 1, TBP6-007).
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  // RUN_BINDING_MISMATCH: a resume attempt's principal, limit, or
  // trusted budgets differ from the durably bound run context.
  // Bound work resumes only under its bound inputs (fix round 1,
  // TBP6-002).
  RUN_BINDING_MISMATCH: "RUN_BINDING_MISMATCH",
};
