// Team Brain P2 fix round (ChatGPT NO-GO TBP2-002/TBP2-003) — closed,
// bounded envelope validation at the external admission boundary.
//
// This validator runs BEFORE any recursive canonicalization, signature
// check, dispatch, or replay recording, so a correctly signed but
// malformed or unbounded envelope can never reach a handler. It is
// shared: buildEnvelope (construction side), verifyEnvelopeSignature
// (verification side), and verifyAndAuthorize (pin side) all go through
// it, so the admitted shape is one shape, not three.
//
// Policy, stated plainly so a future reader does not have to guess:
// - schema_version is exactly 1. No other version is admitted.
// - All envelope fields are present, exactly the allowed set, no extras.
// - IDs/nonce are nonempty bounded strings without control characters.
// - issued_at is a real calendar date-time, not just a parseable one
//   ("2026-02-30" is not a date and is refused).
// - resource.repo is owner/repo; resource scope/head/source/subject, when
//   present, are nonempty bounded strings without whitespace.
// - expected_row_version is null or a non-negative integer.
// - payload is a plain object, bounded in depth, total bytes, and any
//   single string length. A payload that violates a limit is refused
//   whole — never truncated, never partially admitted.
// - payload_sha256 is 64 lowercase hex chars; signature is bounded
//   base64. Neither is ever embedded in an error message.
// - An external expected (pin) resource, when supplied, must itself be a
//   well-formed resource pin: repo required, only the known pin fields,
//   no unknown field silently ignored. A pin field that is present is a
//   binding that must be checked by the caller (see registry.mjs).

import { fail, CODES } from "./errors.mjs";

export const MAX_ENVELOPE_BYTES = 512 * 1024;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const MAX_PAYLOAD_DEPTH = 20;
export const MAX_STRING_LENGTH = 64 * 1024;
export const MAX_ID_LENGTH = 256;

const ENVELOPE_KEYS = new Set([
  "schema_version",
  "operation_id",
  "principal_id",
  "key_id",
  "issued_at",
  "operation",
  "resource",
  "expected_row_version",
  "nonce",
  "payload",
  "payload_sha256",
  "signature",
]);

const RESOURCE_KEYS = new Set(["repo", "scope", "reviewed_head", "source", "subject"]);
const PIN_KEYS = new Set(["repo", "scope", "reviewed_head", "source", "subject"]);

function malformed(reason, details = {}) {
  fail(CODES.MALFORMED_ENVELOPE, `envelope validation failed: ${reason}`, { reason, ...details });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkId(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    malformed(`${field} must be a nonempty string of at most ${MAX_ID_LENGTH} characters`, { field });
  }
  // Control characters (including NUL, newline, tab) are never valid in
  // an identifier that will be compared, logged, or used as a key.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    malformed(`${field} must not contain control characters`, { field });
  }
}

function checkNoWhitespace(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH || /\s/.test(value)) {
    malformed(`${field} must be a nonempty string without whitespace`, { field });
  }
}

// Real-date check: regex shape plus component validation, so February 30,
// month 13, hour 25, and similar impossible values are refused instead of
// being silently rolled over by a date parser.
export function isRealIsoDateTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return false;
  return true;
}

export function validateResource(resource, { forPin = false } = {}) {
  if (!isPlainObject(resource)) {
    malformed(forPin ? "expected resource pin must be an object" : "resource must be an object");
  }
  const allowed = forPin ? PIN_KEYS : RESOURCE_KEYS;
  for (const key of Object.keys(resource)) {
    if (!allowed.has(key)) {
      malformed(`unknown ${forPin ? "pin" : "resource"} field: ${key}`, { field: key });
    }
  }
  if (forPin && (typeof resource.repo !== "string" || resource.repo.length === 0)) {
    malformed("expected resource pin must name a repo", { field: "repo" });
  }
  if (resource.repo !== undefined) {
    if (typeof resource.repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(resource.repo)) {
      malformed("resource.repo must be an owner/repo string", { field: "repo" });
    }
  }
  for (const field of ["scope", "reviewed_head", "source", "subject"]) {
    if (resource[field] !== undefined) checkNoWhitespace(resource[field], `resource.${field}`);
  }
  return true;
}

function walkPayload(value, depth) {
  if (depth > MAX_PAYLOAD_DEPTH) {
    malformed(`payload nesting exceeds ${MAX_PAYLOAD_DEPTH} levels`, { reason: "DEPTH_EXCEEDED" });
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      malformed(`payload string exceeds ${MAX_STRING_LENGTH} characters`, { reason: "STRING_TOO_LONG" });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkPayload(item, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (key.length > MAX_ID_LENGTH) malformed("payload key exceeds length limit", { reason: "KEY_TOO_LONG" });
      walkPayload(value[key], depth + 1);
    }
  }
  // Numbers, booleans, null: bounded by the total-byte check below.
}

export function validateEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    malformed("envelope must be an object", { reason: "NOT_AN_OBJECT" });
  }
  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_KEYS.has(key)) {
      malformed(`unknown envelope field: ${key}`, { field: key, reason: "UNKNOWN_FIELD" });
    }
  }
  for (const key of ENVELOPE_KEYS) {
    if (envelope[key] === undefined) {
      malformed(`envelope missing required field: ${key}`, { field: key });
    }
  }
  if (envelope.schema_version !== 1) {
    malformed("schema_version must be exactly 1", { field: "schema_version" });
  }
  checkId(envelope.operation_id, "operation_id");
  checkId(envelope.principal_id, "principal_id");
  checkId(envelope.key_id, "key_id");
  checkId(envelope.nonce, "nonce");
  if (typeof envelope.operation !== "string" || !/^[A-Za-z0-9_]+$/.test(envelope.operation) || envelope.operation.length > 128) {
    malformed("operation must be a nonempty identifier of letters, digits, and underscores", { field: "operation" });
  }
  if (!isRealIsoDateTime(envelope.issued_at)) {
    malformed("issued_at must be a real ISO 8601 date-time", { field: "issued_at" });
  }
  validateResource(envelope.resource);
  if (envelope.expected_row_version !== null) {
    if (!Number.isInteger(envelope.expected_row_version) || envelope.expected_row_version < 0) {
      malformed("expected_row_version must be null or a non-negative integer", { field: "expected_row_version" });
    }
  }
  if (!isPlainObject(envelope.payload)) {
    malformed("payload must be an object", { field: "payload" });
  }
  walkPayload(envelope.payload, 0);
  const payloadBytes = Buffer.byteLength(JSON.stringify(envelope.payload), "utf8");
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    malformed(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`, { reason: "PAYLOAD_TOO_LARGE", payloadBytes });
  }
  if (typeof envelope.payload_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(envelope.payload_sha256)) {
    malformed("payload_sha256 must be 64 lowercase hex characters", { field: "payload_sha256" });
  }
  if (
    typeof envelope.signature !== "string" ||
    envelope.signature.length === 0 ||
    envelope.signature.length > 2048 ||
    !/^[A-Za-z0-9+/=]+$/.test(envelope.signature)
  ) {
    malformed("signature must be a nonempty bounded base64 string", { field: "signature" });
  }
  return true;
}

// Raw-JSON entrypoint: the byte cap is applied BEFORE decoding, so an
// oversized document is never parsed at all. Returns the parsed value
// (validation itself is the caller's job — see validateEnvelope); a
// document over the cap is reported, not decoded.
export function parseBoundedJson(rawText) {
  if (typeof rawText !== "string") {
    return { value: null, error: "ENVELOPE_NOT_TEXT" };
  }
  if (Buffer.byteLength(rawText, "utf8") > MAX_ENVELOPE_BYTES) {
    return { value: null, error: "ENVELOPE_TOO_LARGE" };
  }
  try {
    return { value: JSON.parse(rawText), error: null };
  } catch (e) {
    return { value: null, error: String(e.message ?? e) };
  }
}

// Validates the camelCase construction-side fields buildEnvelope accepts.
// Same limits as the wire shape, translated field by field, so a malformed
// envelope cannot be signed into existence either.
export function validateBuildFields(fields) {
  checkId(fields.operationId, "operationId");
  checkId(fields.principalId, "principalId");
  checkId(fields.keyId, "keyId");
  checkId(fields.nonce, "nonce");
  if (typeof fields.operation !== "string" || !/^[A-Za-z0-9_]+$/.test(fields.operation) || fields.operation.length > 128) {
    malformed("operation must be a nonempty identifier of letters, digits, and underscores", { field: "operation" });
  }
  if (!isRealIsoDateTime(fields.issuedAt)) {
    malformed("issuedAt must be a real ISO 8601 date-time", { field: "issuedAt" });
  }
  validateResource(fields.resource);
  if (fields.expectedRowVersion !== undefined && fields.expectedRowVersion !== null) {
    if (!Number.isInteger(fields.expectedRowVersion) || fields.expectedRowVersion < 0) {
      malformed("expectedRowVersion must be null or a non-negative integer", { field: "expectedRowVersion" });
    }
  }
  if (!isPlainObject(fields.payload)) {
    malformed("payload must be an object", { field: "payload" });
  }
  walkPayload(fields.payload, 0);
  const payloadBytes = Buffer.byteLength(JSON.stringify(fields.payload), "utf8");
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    malformed(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`, { reason: "PAYLOAD_TOO_LARGE", payloadBytes });
  }
  return true;
}
