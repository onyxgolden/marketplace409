/**
 * errors.js — the single refusal type for the P1-A job contract.
 *
 * Every validation, budget, and recurrence failure in this slice is a
 * JobRefusal with a stable machine-readable `code` and a human-readable
 * `detail`. Callers branch on `code`, never on message text. Pure
 * Node 24 ESM, zero deps.
 */

export class JobRefusal extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}:${detail}` : code);
    this.name = "JobRefusal";
    this.code = code;
    this.detail = detail;
  }
}

/** Refusal codes. The brief names the rejection classes; these are them. */
export const CODES = Object.freeze({
  BAD_JOB: "BAD_JOB",
  BAD_JOB_ID: "BAD_JOB_ID",
  VERSION_MISMATCH: "VERSION_MISMATCH",
  BAD_JOB_TYPE: "BAD_JOB_TYPE",
  AMBIGUOUS_OWNERSHIP: "AMBIGUOUS_OWNERSHIP",
  MISSING_SOURCE_AUTHORIZATION: "MISSING_SOURCE_AUTHORIZATION",
  DUPLICATE_CORPUS_ID: "DUPLICATE_CORPUS_ID",
  BAD_EXCLUSION: "BAD_EXCLUSION",
  UNSUPPORTED_DELIVERABLE_VERSION: "UNSUPPORTED_DELIVERABLE_VERSION",
  MALFORMED_RECURRENCE: "MALFORMED_RECURRENCE",
  EXCESSIVE_BUDGET: "EXCESSIVE_BUDGET",
  NON_DISABLED_STATUS: "NON_DISABLED_STATUS",
  BAD_PROVENANCE: "BAD_PROVENANCE",
  EXCLUDED_CORPUS: "EXCLUDED_CORPUS",
  BAD_INVOCATION: "BAD_INVOCATION",
  BAD_CORPUS: "BAD_CORPUS",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  NO_OCCURRENCE: "NO_OCCURRENCE",
});

export function refuse(code, detail = "") {
  throw new JobRefusal(code, detail);
}
