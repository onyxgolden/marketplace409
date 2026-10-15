/**
 * canonical.js — deterministic JSON canonicalization and hashing helpers.
 * Pure Node 24 ESM, node:crypto only. No model calls, no I/O.
 */

import { createHash } from "node:crypto";

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

/** Canonical JSON: sorted keys, no whitespace. Throws on undefined. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** SHA-256 hex of the UTF-8 canonical JSON of value. */
export function sha256HexUtf8(value) {
  return createHash("sha256").update(Buffer.from(canonicalJson(value), "utf8")).digest("hex");
}

/** SHA-256 hex of raw UTF-8 text/bytes (not JSON-canonicalized). */
export function sha256HexBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Canonical JSON byte length (UTF-8). */
export function canonicalByteLength(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

/** Git blob object ID: sha1("blob <byteLength>\0" + bytes). Returns 40 lowercase hex. */
export function gitBlobId(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

/** Deep-clone via canonical JSON (detached snapshots). */
export function detached(value) {
  return JSON.parse(canonicalJson(value));
}

export const HEX40 = /^[0-9a-f]{40}$/;
export const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Full exact SourceRef identity key: repo, path, commit, blob, algorithm
 * AND revision. Resolved-content reuse (e.g. a per-document content
 * cache) must key on this full identity, never a partial prefix like
 * repo|path|commit alone — a partial key lets a later caller supplying
 * the same repo/path/commit but a DIFFERENT (forged) blob/revision reuse
 * an earlier, unrelated resolution without its own ref ever being
 * validated. This is the fix for DOC-001.
 */
export function fullSourceRefKey(r) {
  return `${r.repo}|${r.path}|${r.commit}|${r.blob}|${r.algorithm}|${r.revision}`;
}
