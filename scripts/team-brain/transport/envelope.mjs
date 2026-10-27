// Team Brain P2 — signed envelope construction and verification.
//
// Brief §3/§4 (results/chatgpt/team-brain-production-service-implementation-brief-2026-10-15.md):
// signed requests use canonical UTF-8 JSON with schema_version, operation_id,
// principal_id, key_id, issued_at, operation, exact resource/source binding,
// expected_row_version, nonce, payload_sha256 and signature. This module only
// canonicalizes, hashes and signs/verifies — it holds no notion of WHO is
// trusted to do WHAT; that's registry.mjs's job. Ed25519 (node:crypto),
// synthetic/local only here — no network, no DB (brief P2 scope: "Synthetic
// local Git + mocked HTTP only; production flag OFF").

import { createHash, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { fail, CODES } from "./errors.mjs";
import { validateEnvelope, validateBuildFields } from "./envelopeValidator.mjs";

const SCHEMA_VERSION = 1;

// Deterministic canonical JSON: recursively sort object keys so the same
// logical envelope always serializes to the same bytes regardless of
// construction order — required for a stable signature and a stable
// payload_sha256. Arrays keep their given order (order is meaningful there).
export function canonicalize(value) {
  return JSON.stringify(sortKeysDeep(value));
}

// TBP2-001 fix: canonicalization must be injective over own keys.
// A plain `{}` accumulator is not: assigning `sorted["__proto__"]`
// invokes Object.prototype's __proto__ setter and changes the
// accumulator's prototype instead of creating an own property, so a
// payload with an own __proto__ key canonicalized to the same bytes as
// the payload without it — and an altered payload then verified under
// the original signature. Using a null-prototype accumulator makes
// every own key, including "__proto__", "constructor", and
// "prototype", an ordinary data property that JSON.stringify emits.
// Policy: those keys are data, never prototype mutation, at every
// nesting level, for payload/resource/all signed content.
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) continue; // undefined fields never survive signing
      sorted[key] = sortKeysDeep(v);
    }
    return sorted;
  }
  return value;
}

export function sha256Hex(canonicalJsonString) {
  return createHash("sha256").update(canonicalJsonString, "utf8").digest("hex");
}

// Builds and signs a new envelope. `fields` carries everything except
// payload_sha256/signature, which this function computes. `privateKey` is a
// node:crypto KeyObject (Ed25519).
export function buildEnvelope(fields, privateKey) {
  const required = [
    "operationId",
    "principalId",
    "keyId",
    "issuedAt",
    "operation",
    "resource",
    "nonce",
    "payload",
  ];
  for (const key of required) {
    if (fields[key] === undefined || fields[key] === null) {
      fail(CODES.MALFORMED_ENVELOPE, `envelope missing required field: ${key}`, { key });
    }
  }
  // TBP2-002: a malformed envelope must not be signed into existence.
  // The closed validator runs here, before any signing bytes exist.
  validateBuildFields(fields);
  const payloadCanonical = canonicalize(fields.payload);
  const unsigned = {
    schema_version: SCHEMA_VERSION,
    operation_id: fields.operationId,
    principal_id: fields.principalId,
    key_id: fields.keyId,
    issued_at: fields.issuedAt,
    operation: fields.operation,
    resource: fields.resource,
    expected_row_version: fields.expectedRowVersion ?? null,
    nonce: fields.nonce,
    payload: fields.payload,
    payload_sha256: sha256Hex(payloadCanonical),
  };
  const signingBytes = Buffer.from(canonicalize(unsigned), "utf8");
  const signature = cryptoSign(null, signingBytes, privateKey).toString("base64");
  return { ...unsigned, signature };
}

// Verifies an envelope's internal consistency and cryptographic signature
// ONLY — payload_sha256 matches the actual payload, and the signature
// matches the envelope body under the given public key. Does NOT check
// whether key_id is registered, revoked, or authorized for the operation —
// that's registry.mjs, composed on top of this (verifyEnvelope needs a
// resolved public key; the caller resolves key_id -> key via the registry
// first, which is also where UNKNOWN_KEY / KEY_REVOKED / SIGNER_NOT_PRINCIPAL
// get decided).
export function verifyEnvelopeSignature(envelope, publicKey) {
  if (!envelope || typeof envelope !== "object") {
    fail(CODES.MALFORMED_ENVELOPE, "envelope is not an object");
  }
  // TBP2-002: the closed validator runs before any canonicalization,
  // hashing, or signature check, so a correctly signed but malformed or
  // unbounded envelope is refused here and never reaches a handler.
  // No handler or replay state is mutated by a refusal (that happens
  // only in registry.verifyAndAuthorize, after this returns).
  validateEnvelope(envelope);
  const { signature, ...unsigned } = envelope;
  if (typeof signature !== "string" || signature.length === 0) {
    fail(CODES.MALFORMED_ENVELOPE, "envelope missing signature");
  }
  const expectedPayloadHash = sha256Hex(canonicalize(unsigned.payload));
  if (expectedPayloadHash !== unsigned.payload_sha256) {
    fail(CODES.PAYLOAD_HASH_MISMATCH, "payload_sha256 does not match actual payload", {
      expected: expectedPayloadHash,
      claimed: unsigned.payload_sha256,
    });
  }
  const signingBytes = Buffer.from(canonicalize(unsigned), "utf8");
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signature, "base64");
  } catch {
    fail(CODES.MALFORMED_ENVELOPE, "signature is not valid base64");
  }
  const ok = cryptoVerify(null, signingBytes, publicKey, signatureBytes);
  if (!ok) {
    fail(CODES.SIGNATURE_INVALID, "envelope signature does not verify against the resolved key");
  }
  return true;
}
