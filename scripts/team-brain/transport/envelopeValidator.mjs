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
// - issued_at is a real calendar date-time with a real, finite offset
//   ("2026-02-30" is not a date and is refused; "+99:99" is not an
//   offset and is refused).
// - resource.repo is owner/repo; resource scope/head/source/subject, when
//   present, are nonempty bounded strings without whitespace. When a
//   reviewed_head is present it must be a canonical 40-hex git commit
//   identity — a nonempty arbitrary string does not prove a head.
// - A submit_verdict envelope is verdict evidence under the brief, so
//   it must carry scope, source, and reviewed_head. Generic reads and
//   tasks need not fabricate a head and may omit it.
// - Payload numbers must be finite: raw JSON "1e400" parses to Infinity
//   and JSON.stringify renders Infinity as null, so an unchecked
//   nonfinite number would let an altered payload verify under the
//   original signature. Finite numbers and null are the only numeric
//   domain admitted.
// - TBP2-002B: payload values must belong to the JSON value domain
//   exactly — null, booleans, finite numbers, strings, arrays, and
//   plain records (Object.prototype or null prototype) with enumerable
//   data properties only. undefined, functions, symbols, bigints,
//   class/Date/Map/Set/typed-array instances, accessors, symbol keys,
//   and hidden fields are refused: JSON.stringify drops them while a
//   handler receiving the raw object could still observe them, which
//   is the same signature-binding collision as the numeric case.
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  // TBP2-002B: "object" is not a prototype — a class instance, Date,
  // Map, Set, typed array, or any other exotic object is not a plain
  // JSON record, even if it happens to carry string-keyed fields. Only
  // Object.prototype and null-prototype records are admitted.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// TBP2-002B: a record's shape is part of its meaning. A symbol-keyed
// field, an accessor, or a non-enumerable field is dropped by
// JSON.stringify / canonicalization but remains observable to a handler
// that receives the raw object — the exact unsigned-field collision
// this validator must close. Descriptors are inspected BEFORE any
// value is read, so an accessor getter is never invoked here.
function checkRecordShape(value, field) {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    malformed(`${field} must not carry symbol-keyed fields`, { field, reason: "SYMBOL_FIELD" });
  }
  for (const key of Object.keys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || desc.get || desc.set || !desc.enumerable) {
      malformed(`${field} fields must be enumerable data properties, not accessors or hidden fields`, {
        field,
        key,
        reason: "ACCESSOR_OR_HIDDEN_FIELD",
      });
    }
  }
}

function checkJsonValue(value, depth, field) {
  if (depth > MAX_PAYLOAD_DEPTH) {
    malformed(`payload nesting exceeds ${MAX_PAYLOAD_DEPTH} levels`, { reason: "DEPTH_EXCEEDED" });
  }
  if (value === null) return;
  const t = typeof value;
  if (t === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      malformed(`payload string exceeds ${MAX_STRING_LENGTH} characters`, { reason: "STRING_TOO_LONG" });
    }
    return;
  }
  if (t === "number") {
    if (!Number.isFinite(value)) {
      malformed("payload numbers must be finite", { reason: "NONFINITE_NUMBER" });
    }
    return;
  }
  if (t === "boolean") return;
  // TBP2-002B: everything else at a value position is outside the
  // JSON value domain, even if JSON.stringify would silently drop it
  // (undefined, functions, symbols) or coerce it (bigint throws in
  // JSON.stringify, but is not a JSON value either). Dropping is the
  // collision: a signed {} and an altered {approved: undefined} would
  // canonicalize to the same bytes while the handler observes a
  // different object.
  if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") {
    malformed(`payload values must belong to the JSON value domain, not ${t}`, { reason: "NON_JSON_VALUE" });
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      malformed("payload arrays must have Array.prototype", { reason: "NON_JSON_VALUE" });
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      malformed("payload arrays must not carry symbol-keyed fields", { reason: "SYMBOL_FIELD" });
    }
    // Array elements are exactly indices 0..length-1. Any extra own key
    // is dropped by JSON.stringify but observable to a handler, so it
    // is refused here rather than silently ignored.
    if (Object.keys(value).length !== value.length) {
      malformed("payload arrays must not carry extra own keys", { reason: "NON_JSON_VALUE" });
    }
    for (let i = 0; i < value.length; i += 1) {
      const desc = Object.getOwnPropertyDescriptor(value, String(i));
      if (!desc || desc.get || desc.set || !desc.enumerable) {
        malformed("payload array elements must be enumerable data properties", { reason: "ACCESSOR_OR_HIDDEN_FIELD" });
      }
      checkJsonValue(desc.value, depth + 1, field);
    }
    return;
  }
  if (t === "object") {
    if (!isPlainObject(value)) {
      malformed("payload records must be plain JSON records (Object.prototype or null prototype)", {
        reason: "NON_JSON_VALUE",
      });
    }
    checkRecordShape(value, field);
    for (const key of Object.keys(value)) {
      if (key.length > MAX_ID_LENGTH) malformed("payload key exceeds length limit", { reason: "KEY_TOO_LONG" });
      const desc = Object.getOwnPropertyDescriptor(value, key);
      checkJsonValue(desc.value, depth + 1, field);
    }
    return;
  }
  malformed(`payload values must belong to the JSON value domain, not ${t}`, { reason: "NON_JSON_VALUE" });
}

function walkPayload(value, depth) {
  checkJsonValue(value, depth, "payload");
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
  // TBP2-002A: component ranges alone do not prove a real instant —
  // "+99:99" passes the regex shape but is not an offset. Require a
  // bounded offset and a finite materialized instant.
  const zone = match[8];
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function validateResource(resource, { forPin = false } = {}) {
  if (!isPlainObject(resource)) {
    malformed(forPin ? "expected resource pin must be an object" : "resource must be an object");
  }
  // TBP2-002B: a resource record with a symbol key, accessor, or hidden
  // field would have that field dropped by canonicalization while a
  // handler could still observe it. Refuse the shape, not just the value.
  checkRecordShape(resource, forPin ? "expected resource pin" : "resource");
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
  // TBP2-002A: a present reviewed_head must be a canonical 40-hex git
  // commit identity. "not-a-hash" and short fixture strings are not
  // heads, and accepting them would let a caller claim head binding
  // over nothing.
  if (resource.reviewed_head !== undefined && !/^[0-9a-f]{40}$/.test(resource.reviewed_head)) {
    malformed("resource.reviewed_head must be a 40-hex git commit identity", { field: "reviewed_head" });
  }
  return true;
}

export function validateEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    malformed("envelope must be an object", { reason: "NOT_AN_OBJECT" });
  }
  // TBP2-002B: the envelope record itself must be a plain data record
  // — no symbol keys, accessors, or hidden fields — before any of its
  // fields are read, so validation never invokes an accessor getter.
  checkRecordShape(envelope, "envelope");
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
  // TBP2-002A: submit_verdict is the brief's verdict-evidence
  // operation (exact repo/resource/scope/head + result source), so a
  // verdict envelope missing any of scope, source, or reviewed_head
  // is not verdict evidence at all and is refused here, not admitted
  // as a generic signed object.
  if (envelope.operation === "submit_verdict") {
    for (const field of ["scope", "source", "reviewed_head"]) {
      if (envelope.resource[field] === undefined) {
        malformed(`submit_verdict resource must carry ${field}`, { field });
      }
    }
  }
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
  if (!isPlainObject(fields)) {
    malformed("envelope fields must be a plain object", { reason: "NOT_AN_OBJECT" });
  }
  checkRecordShape(fields, "envelope fields");
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
  if (fields.operation === "submit_verdict") {
    for (const field of ["scope", "source", "reviewed_head"]) {
      if (fields.resource[field] === undefined) {
        malformed(`submit_verdict resource must carry ${field}`, { field });
      }
    }
  }
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
