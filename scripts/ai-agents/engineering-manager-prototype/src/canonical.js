/**
 * canonical.js — canonical JSON and stable identifiers for the
 * engineering-manager prototype.
 *
 * Canonical form: objects have recursively sorted keys, arrays keep order,
 * no whitespace. SHA-256 over the UTF-8 canonical bytes is the stable
 * node identity: SHA-256(canonical({brief:{repo,path,blob},objective_id,local_key})).
 * Pure Node 24, zero dependencies.
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
 * This is the independently recomputed content binding for brief pins
 * (EM-001): the resolver never trusts a supplied blob label alone.
 */
export function gitBlobSha1Utf8(s) {
  const bytes = Buffer.from(s, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

/**
 * Stable node ID per the brief: SHA-256 of canonical
 * {brief:{repo,path,blob}, objective_id, local_key}.
 */
export function stableNodeId(briefRepo, briefPath, briefBlob, objectiveId, localKey) {
  return sha256HexUtf8(
    canonicalJson({
      brief: { repo: briefRepo, path: briefPath, blob: briefBlob },
      objective_id: objectiveId,
      local_key: localKey,
    })
  );
}

/** Byte length of a value's canonical JSON form. */
export function canonicalByteLength(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}
