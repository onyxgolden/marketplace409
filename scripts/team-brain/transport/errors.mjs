// Team Brain P2 — typed errors for the trust/transport boundary (signed
// envelopes, key/authority registry). Every rejection carries a stable
// machine-readable `code`, same convention as ../ledger/errors.mjs, so
// tests and callers assert the exact failure instead of message text.

export class TeamBrainTrustError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TeamBrainTrustError";
    this.code = code;
    this.details = details;
  }
}

export const CODES = {
  // Envelope shape / canonicalization
  MALFORMED_ENVELOPE: "MALFORMED_ENVELOPE",
  PAYLOAD_HASH_MISMATCH: "PAYLOAD_HASH_MISMATCH",
  // Signature verification
  UNKNOWN_PRINCIPAL: "UNKNOWN_PRINCIPAL",
  UNKNOWN_KEY: "UNKNOWN_KEY",
  KEY_REVOKED: "KEY_REVOKED",
  SIGNATURE_INVALID: "SIGNATURE_INVALID",
  SIGNER_NOT_PRINCIPAL: "SIGNER_NOT_PRINCIPAL",
  // Authorization / binding
  RESOURCE_BINDING_MISMATCH: "RESOURCE_BINDING_MISMATCH",
  HEAD_BINDING_MISMATCH: "HEAD_BINDING_MISMATCH",
  NOT_AUTHORIZED_FOR_OPERATION: "NOT_AUTHORIZED_FOR_OPERATION",
  AUTHORIZATION_REVOKED: "AUTHORIZATION_REVOKED",
  // Replay
  OPERATION_REPLAYED: "OPERATION_REPLAYED",
  CONFLICTING_REPLAY: "CONFLICTING_REPLAY",
  OPERATION_PENDING: "OPERATION_PENDING",
  // Registry admin boundary
  SELF_REGISTRATION_FORBIDDEN: "SELF_REGISTRATION_FORBIDDEN",
  NOT_ADMIN_ORIGIN: "NOT_ADMIN_ORIGIN",
  // Git shadow importer
  INTAKE_BLOCKED: "INTAKE_BLOCKED",
  // Logical API dispatch
  UNKNOWN_OPERATION: "UNKNOWN_OPERATION",
  ADMIN_OPERATION_VIA_ENVELOPE_FORBIDDEN: "ADMIN_OPERATION_VIA_ENVELOPE_FORBIDDEN",
};

export function fail(code, message, details) {
  throw new TeamBrainTrustError(code, message, details);
}
