/**
 * canonical.js — deterministic JSON canonicalization and SHA-256 helpers.
 * Original code for the FORGE defensive audit pack. Pure Node 24 ESM,
 * node:crypto only. No I/O, no network, no child processes.
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

/** SHA-256 hex of a raw UTF-8 string (not JSON-canonicalized). */
export function sha256HexString(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** Canonical JSON byte length (UTF-8). */
export function canonicalByteLength(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

export const HEX64 = /^[0-9a-f]{64}$/;

/** Evidence pointer digest: binds a finding to exact input bytes. */
export function evidenceDigest(pointer, bytesText) {
  return sha256HexString(`${pointer}\n${bytesText}`);
}
