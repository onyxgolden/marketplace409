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
};
