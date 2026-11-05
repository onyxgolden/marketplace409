/**
 * errors.js — the P1-C refusal type.
 *
 * Mirrors the P1-A/P1-B pattern: a coded refusal, never a bare Error,
 * so the host can map codes to HTTP statuses without leaking stack
 * traces or item contents into the UI.
 */

export const CODES = Object.freeze({
  BAD_REQUEST: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  STORE_UNAVAILABLE: "STORE_UNAVAILABLE",
  JOB_DEFINITIONS_UNAVAILABLE: "JOB_DEFINITIONS_UNAVAILABLE",
  BAD_JOB_DEFINITION: "BAD_JOB_DEFINITION",
  BAD_HOST_CONFIG: "BAD_HOST_CONFIG",
  INTERNAL: "INTERNAL",
});

export class WorkbenchRefusal extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "WorkbenchRefusal";
    this.code = code;
  }
}

export function refuse(code, detail = "") {
  throw new WorkbenchRefusal(code, detail);
}
