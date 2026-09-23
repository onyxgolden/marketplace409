// Evidence subdomain for Call Shield — chain-of-custody invariants.
//
// This module owns everything about evidence integrity: hash validation,
// MIME allowlisting, capture timestamps, manifest construction, and export
// ordering. It is deliberately separate from case mutation logic so the
// custody rules can be reasoned about (and tested) in isolation.
//
// Invariants:
// - Evidence is append-only. There is no update or delete here; custody
//   means the original bytes are never rewritten by this product.
// - Every attachment carries a SHA-256 hash of the original file bytes and
//   the moment the user captured it. The hash is validated for shape here;
//   computing it from bytes is the caller's job (persistence layer).
// - Manifests list evidence in chronological capture order.

import { ALLOWED_EVIDENCE_MIME_TYPES, EVIDENCE_KINDS, EVENT_TYPES } from "./callShieldConstants.js";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cse-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function isValidDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(d.getTime());
}

/**
 * Validate an evidence descriptor without attaching it. Returns
 * { ok, issues[] } — non-blocking, so the UI can explain what is wrong.
 */
export function validateEvidenceDescriptor(descriptor = {}) {
  const issues = [];
  const kinds = Object.values(EVIDENCE_KINDS);
  if (!kinds.includes(descriptor.kind)) {
    issues.push(`kind must be one of: ${kinds.join(", ")}`);
  }
  if (typeof descriptor.fileName !== "string" || descriptor.fileName.trim().length === 0) {
    issues.push("fileName is required");
  }
  if (!ALLOWED_EVIDENCE_MIME_TYPES.includes(descriptor.mimeType)) {
    issues.push(`mimeType must be one of the allowed types (got "${descriptor.mimeType}")`);
  }
  if (!Number.isInteger(descriptor.byteSize) || descriptor.byteSize <= 0) {
    issues.push("byteSize must be a positive integer");
  }
  if (typeof descriptor.sha256 !== "string" || !SHA256_HEX_RE.test(descriptor.sha256)) {
    issues.push("sha256 must be a 64-character hex digest of the original file bytes");
  }
  if (!isValidDate(descriptor.capturedAt)) {
    issues.push("capturedAt must be a valid date");
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Attach evidence to a case. Returns { event } on success; throws a TypeError
 * describing every problem when the descriptor is invalid. The event is meant
 * to be appended to the case timeline via applyEvents from callShieldCase.
 *
 * @param {string} caseId
 * @param {object} descriptor - kind, fileName, mimeType, byteSize, sha256, capturedAt
 * @param {object} opts - { callId } to link the evidence to a logged call
 */
export function attachEvidence(caseId, descriptor = {}, opts = {}) {
  if (typeof caseId !== "string" || caseId.trim().length === 0) {
    throw new TypeError("attachEvidence requires a caseId");
  }
  const { ok, issues } = validateEvidenceDescriptor(descriptor);
  if (!ok) {
    throw new TypeError(`invalid evidence descriptor: ${issues.join("; ")}`);
  }
  const capturedAt = descriptor.capturedAt instanceof Date
    ? descriptor.capturedAt.toISOString()
    : new Date(descriptor.capturedAt).toISOString();
  return {
    event: {
      id: generateId(),
      type: EVENT_TYPES.EVIDENCE_ATTACHED,
      recordedAt: new Date().toISOString(),
      payload: {
        caseId,
        evidenceId: generateId(),
        callId: typeof opts.callId === "string" ? opts.callId : null,
        kind: descriptor.kind,
        fileName: descriptor.fileName.trim(),
        mimeType: descriptor.mimeType,
        byteSize: descriptor.byteSize,
        sha256: descriptor.sha256.toLowerCase(),
        capturedAt,
      },
    },
  };
}

/**
 * Build the export manifest for a case state: evidence in chronological
 * capture order, each entry carrying the custody fields. The manifest itself
 * is hashable by the persistence layer (canonical JSON of this array).
 */
export function buildManifest(caseState) {
  const evidence = Array.isArray(caseState?.evidence) ? caseState.evidence : [];
  return [...evidence]
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    .map((e, index) => ({
      sequence: index + 1,
      evidenceId: e.evidenceId,
      callId: e.callId,
      kind: e.kind,
      fileName: e.fileName,
      mimeType: e.mimeType,
      byteSize: e.byteSize,
      sha256: e.sha256,
      capturedAt: e.capturedAt,
      recordedAt: e.recordedAt,
    }));
}

/**
 * Verify a set of files against a manifest. filesByEvidenceId maps
 * evidenceId -> sha256 hex of the bytes on hand. Returns
 * { ok, checked, mismatches[] } where each mismatch names the evidenceId
 * and the expected vs actual digest. Missing files are mismatches too.
 */
export function verifyManifest(manifest, filesByEvidenceId = {}) {
  const mismatches = [];
  for (const entry of manifest || []) {
    const actual = filesByEvidenceId[entry.evidenceId];
    if (typeof actual !== "string" || actual.toLowerCase() !== entry.sha256.toLowerCase()) {
      mismatches.push({
        evidenceId: entry.evidenceId,
        fileName: entry.fileName,
        expected: entry.sha256,
        actual: typeof actual === "string" ? actual : null,
      });
    }
  }
  return { ok: mismatches.length === 0, checked: (manifest || []).length, mismatches };
}
