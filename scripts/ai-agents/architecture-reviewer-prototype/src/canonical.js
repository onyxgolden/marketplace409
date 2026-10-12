/**
 * canonical.js — canonical JSON and stable identifiers for the
 * architecture-reviewer prototype.
 *
 * Canonical form: objects have recursively sorted keys, arrays keep order,
 * no whitespace. SHA-256 over the UTF-8 canonical bytes is the stable
 * identity basis. Pure Node 24, zero dependencies.
 */

import { createHash } from "node:crypto";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Recursively sort object keys; arrays keep their order. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

/** Canonical JSON string: sorted keys, no whitespace. */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256HexUtf8(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function sha256HexBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Git blob SHA-1 of a UTF-8 string: SHA-1("blob <byteLen>\0" + bytes).
 * The resolver independently recomputes this from resolved bytes and
 * never trusts a supplied blob label alone.
 */
export function gitBlobSha1Utf8(s) {
  const bytes = Buffer.from(s, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

/** Byte length of a value's canonical JSON form. */
export function canonicalByteLength(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

/**
 * Stable finding ID per the brief: SHA-256 of canonical
 * {design:{repo,path,blob}, check_id, clause_key, span_start, span_end},
 * first 16 hex chars. Identical derivations always yield the same ID.
 */
export function stableFindingId(designRepo, designPath, designBlob, checkId, clauseKey, spanStart, spanEnd) {
  return sha256HexUtf8(
    canonicalJson({
      design: { repo: designRepo, path: designPath, blob: designBlob },
      check_id: checkId,
      clause_key: clauseKey,
      span_start: spanStart,
      span_end: spanEnd,
    })
  ).slice(0, 16);
}

/** Stable review ID: SHA-256 of the canonical review identity. */
export function stableReviewId(designRef, basePin, scopeIds, requiredCheckIds) {
  return sha256HexUtf8(
    canonicalJson({
      design_ref: designRef,
      base_pin: basePin,
      scope_ids: [...scopeIds].sort(),
      required_check_ids: [...requiredCheckIds].sort(),
    })
  ).slice(0, 32);
}
