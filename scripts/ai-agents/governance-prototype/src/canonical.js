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

/** Canonical JSON: sorted keys, no whitespace. Throws on undefined/circular. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** SHA-256 hex of the UTF-8 canonical JSON of value. */
export function sha256HexUtf8(value) {
  return createHash("sha256").update(Buffer.from(canonicalJson(value), "utf8")).digest("hex");
}

/** Canonical JSON byte length (UTF-8). */
export function canonicalByteLength(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

/** SHA-256 hex of raw bytes. */
export function sha256HexBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Git blob SHA-1 (hex) for UTF-8 content, using the Git blob header. */
export function gitBlobSha1Hex(contentUtf8) {
  const body = Buffer.from(contentUtf8, "utf8");
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, body])).digest("hex");
}

export const HEX40 = /^[0-9a-f]{40}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
export const STABLE_ID = /^[a-z0-9][a-z0-9:_\-.]{0,127}$/;
