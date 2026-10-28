// Team Brain slice 4 — verified-handoff error codes.
//
// The driver reuses slice-1 codes (CONFLICTING_REPLAY, SKIPPED_TRANSITION,
// UNKNOWN_HANDOFF, BINDING_MISMATCH) and slice-3 outbox codes
// (CAS_CONFLICT, STALE_LEASE, LEASE_HELD, LEASE_EXPIRED, PAYLOAD_DRIFT,
// DISALLOWED_REPO, DISALLOWED_PATH) where the meaning is identical, and
// adds its own codes below for readback, receipt, fencing, and evidence
// failures. Every guard rejection carries a stable code so tests assert
// the exact failure instead of matching message text.

export { CODES, fail, TeamBrainError } from "../ledger/errors.mjs";
export { P3_CODES } from "../orchestrator/errors.mjs";

export const P4_CODES = {
  // Git identity / transport
  INVALID_GIT_IDENTITY: "INVALID_GIT_IDENTITY",
  GIT_UNAVAILABLE: "GIT_UNAVAILABLE",
  GIT_NOT_FOUND: "GIT_NOT_FOUND",
  GIT_CAS_CONFLICT: "GIT_CAS_CONFLICT",
  GIT_LOST_REPLY: "GIT_LOST_REPLY",
  // Delivery uncertainty: a write may or may not have landed. Never
  // treated as failed, never treated as delivered. Reconcile decides.
  DELIVERY_UNKNOWN: "DELIVERY_UNKNOWN",
  // Readback
  READBACK_MISMATCH: "READBACK_MISMATCH",
  READBACK_UNAVAILABLE: "READBACK_UNAVAILABLE",
  // A caller-supplied verification claim. The driver has no `verified`
  // input: a receipt is produced only by an independent Git read.
  INVALID_READBACK_CLAIM: "INVALID_READBACK_CLAIM",
  // Provenance (brief Section 3: caller verified:true is never accepted;
  // missing provenance blocks closure, it never defaults to verified).
  PROVENANCE_MISSING: "PROVENANCE_MISSING",
  PROVENANCE_UNVERIFIED: "PROVENANCE_UNVERIFIED",
  // Receipts / evidence chain
  QUEUE_RECEIPT_MISMATCH: "QUEUE_RECEIPT_MISMATCH",
  OUTCOME_RECEIPT_MISSING: "OUTCOME_RECEIPT_MISSING",
  READBACK_RECEIPT_MISSING: "READBACK_RECEIPT_MISSING",
  QUEUE_RECEIPT_MISSING: "QUEUE_RECEIPT_MISSING",
  INCOMPLETE_EVIDENCE: "INCOMPLETE_EVIDENCE",
  // Consumption guards
  STALE_HEAD: "STALE_HEAD",
  STALE_WORKER: "STALE_WORKER",
  TASK_MOVED: "TASK_MOVED",
  TASK_TERMINAL: "TASK_TERMINAL",
  UNKNOWN_TASK_BINDING: "UNKNOWN_TASK_BINDING",
  TIME_ORDER: "TIME_ORDER",
};
