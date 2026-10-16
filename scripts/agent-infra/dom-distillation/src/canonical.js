/**
 * canonical.js — deterministic JSON canonicalization and hashing.
 * Pure Node 24 ESM, node:crypto only.
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

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256HexUtf8(value) {
  return createHash("sha256").update(Buffer.from(canonicalJson(value), "utf8")).digest("hex");
}

export function sha256HexString(s) {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}

export const HEX64 = /^[0-9a-f]{64}$/;
