/**
 * canonical.js — canonical JSON, SHA-256 and Git blob SHA-1 helpers.
 *
 * canonicalJson sorts object keys recursively so every serialized value is
 * byte-stable across runs, key orders and JS engine map ordering. All
 * hashes in this prototype are computed over canonical bytes.
 */

import { createHash } from "node:crypto";

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = canonicalize(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
}

export function sha256HexUtf8(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** Git blob SHA-1: sha1("blob <byteLength>\0" + bytes). Never plain SHA-1 of bytes. */
export function gitBlobSha1(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  const header = Buffer.from(`blob ${buf.length}\0`, "utf8");
  return createHash("sha1").update(header).update(buf).digest("hex");
}

export function utf8ByteLength(text) {
  return Buffer.byteLength(text, "utf8");
}
