// Team Brain slice 1 — shared input validation.
// Deterministic, pure, no I/O, no network, no model calls.

import { CODES, fail } from "./errors.mjs";

// Strict UTC ISO-8601: YYYY-MM-DDTHH:MM:SS[.sss]Z. No offsets, no local time.
const UTC_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function assertUtcIso(value, fieldName) {
  if (typeof value !== "string" || !UTC_ISO_RE.test(value)) {
    fail(CODES.MALFORMED_TIMESTAMP, `Malformed UTC timestamp for ${fieldName}: ${JSON.stringify(value)}`, {
      field: fieldName,
      value,
    });
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    fail(CODES.MALFORMED_TIMESTAMP, `Unparseable UTC timestamp for ${fieldName}: ${JSON.stringify(value)}`, {
      field: fieldName,
      value,
    });
  }
  // Round-trip check rejects impossible dates such as 2026-02-30.
  const roundTrip = new Date(ms).toISOString();
  const normalized = value.length === 20 ? value.replace("Z", ".000Z") : value;
  if (roundTrip !== normalized) {
    fail(CODES.MALFORMED_TIMESTAMP, `Nonexistent calendar time for ${fieldName}: ${JSON.stringify(value)}`, {
      field: fieldName,
      value,
    });
  }
  return value;
}

export function utcIsoToMs(value, fieldName) {
  assertUtcIso(value, fieldName);
  return Date.parse(value);
}

export function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(CODES.INVALID_FIELD, `${fieldName} must be a non-empty string`, {
      field: fieldName,
      value,
    });
  }
  return value;
}

// Immutable source binding: repository + path are always required; the
// commit/blob/head pointers are required when the source is versioned content.
export function assertSourceBinding(source, { requireHead = false } = {}) {
  if (!source || typeof source !== "object") {
    fail(CODES.MISSING_SOURCE_BINDING, "Source binding must be an object with repo and path");
  }
  for (const field of ["repo", "path"]) {
    if (typeof source[field] !== "string" || source[field].trim() === "") {
      fail(CODES.MISSING_SOURCE_BINDING, `Source binding missing required field: ${field}`, { field });
    }
  }
  for (const field of ["commit", "blob", "head"]) {
    if (source[field] !== undefined && (typeof source[field] !== "string" || source[field].trim() === "")) {
      fail(CODES.MISSING_SOURCE_BINDING, `Source binding field ${field} must be a non-empty string when present`, {
        field,
      });
    }
  }
  if (requireHead && (!source.head || source.head.trim() === "")) {
    fail(CODES.MISSING_SOURCE_BINDING, "Source binding requires an exact head for this operation", { source });
  }
  return source;
}

// Full artifact binding used by handoffs: every pointer must be present.
export function assertArtifactBinding(artifact, code = CODES.MISSING_ARTIFACT_BINDING) {
  if (!artifact || typeof artifact !== "object") {
    fail(code, "Artifact binding must be an object");
  }
  for (const field of ["repo", "path", "commit", "blob", "head"]) {
    if (typeof artifact[field] !== "string" || artifact[field].trim() === "") {
      fail(code, `Artifact binding missing required field: ${field}`, { field });
    }
  }
  return artifact;
}

export function artifactBindingsEqual(a, b) {
  if (!a || !b) return false;
  return ["repo", "path", "commit", "blob", "head"].every((f) => a[f] === b[f]);
}

export function assertStringArray(value, fieldName) {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v.trim() !== "")) {
    fail(CODES.MALFORMED_TIMESTAMP, `${fieldName} must be an array of non-empty strings`, {
      field: fieldName,
      value,
    });
  }
  return value;
}

export function assertUniqueStringArray(value, fieldName) {
  assertStringArray(value, fieldName);
  const seen = new Set();
  for (const v of value) {
    if (seen.has(v)) {
      fail(CODES.MALFORMED_TIMESTAMP, `${fieldName} contains a duplicate entry: ${v}`, { field: fieldName, value });
    }
    seen.add(v);
  }
  return value;
}

// Structural validation for a priority override. This checks the SHAPE only:
// required attribution fields, a non-empty authorityRef, no free-text
// authority (caller self-attestation is rejected here, never honored), and a
// well-formed rank. Trust resolution (is the authorityRef a real, Jason,
// item-bound, unrevoked grant of the right rank?) runs against
// host-injected trusted records both at the ledger write boundary
// (repository fileObligationRow, before anything persists) and in the queue
// projection (revalidation for grants that change after filing).
export function assertOverrideStructure(override, id) {
  if (override == null) return null;
  if (typeof override !== "object" || Array.isArray(override)) {
    fail(CODES.INVALID_OVERRIDE, `Priority override for ${id} must be an object`, { id });
  }
  const { rank = 0, actor, recordedAt, reason, authorityRef, authority } = override;
  if (authority !== undefined) {
    fail(
      CODES.INVALID_OVERRIDE,
      `Priority override for ${id} rejected: free-text authority is caller self-attestation; supply authorityRef`,
      { id },
    );
  }
  const missing = [];
  if (typeof actor !== "string" || actor.trim() === "") missing.push("actor");
  if (typeof recordedAt !== "string" || recordedAt.trim() === "") missing.push("recordedAt");
  if (typeof reason !== "string" || reason.trim() === "") missing.push("reason");
  if (typeof authorityRef !== "string" || authorityRef.trim() === "") missing.push("authorityRef");
  if (missing.length > 0) {
    fail(CODES.INVALID_OVERRIDE, `Priority override for ${id} rejected: missing ${missing.join(", ")}`, {
      id,
      missing,
    });
  }
  assertUtcIso(recordedAt, `override.recordedAt for ${id}`);
  if (!Number.isInteger(rank) || rank < 0) {
    fail(CODES.INVALID_OVERRIDE, `Priority override for ${id} rejected: rank must be a non-negative integer`, {
      id,
      rank,
    });
  }
  return { rank, actor, recordedAt, reason, authorityRef };
}
