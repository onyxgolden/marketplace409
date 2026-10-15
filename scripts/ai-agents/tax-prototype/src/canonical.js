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

/** SHA-256 hex of raw UTF-8 text (not JSON-canonicalized). */
export function sha256HexText(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
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

/**
 * Deterministic fixture commit ID: sha1 of a namespaced seed.
 * These are fixture identifiers, NOT real Git commit objects — the
 * fixture store never claims Git commit semantics, only content
 * addressing of revision bytes. Returns 40 lowercase hex.
 */
export function fixtureCommitId(repo, path, bytes) {
  return createHash("sha1")
    .update(Buffer.from("tax-fixture-commit-v1|", "utf8"))
    .update(Buffer.from(repo, "utf8"))
    .update(Buffer.from("|", "utf8"))
    .update(Buffer.from(path, "utf8"))
    .update(Buffer.from("|", "utf8"))
    .update(bytes)
    .digest("hex");
}

/** Deep-clone via canonical JSON (detached snapshots). */
export function detached(value) {
  return JSON.parse(canonicalJson(value));
}

export const HEX40 = /^[0-9a-f]{40}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
