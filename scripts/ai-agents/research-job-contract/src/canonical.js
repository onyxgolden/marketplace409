/**
 * canonical.js — deterministic canonical JSON + SHA-256 identity helpers.
 *
 * P1-A job contract: every hash in this slice (definition hash, fixture
 * set hash, run id, item key, citation-byte identity) derives from the
 * canonical form defined here, so identical inputs hash identically on
 * every run, host, and Node version. Pure Node 24 ESM, zero deps.
 */

import { createHash } from "node:crypto";

/** SHA-256 hex of UTF-8 bytes. */
export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 hex of a Buffer's bytes (citation-byte identity). */
export function sha256Bytes(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Canonical JSON: object keys sorted recursively (code-unit order),
 * arrays in order, no whitespace. Refuses non-JSON data (undefined,
 * functions, symbols, bigints, cyclic graphs, non-plain objects) rather
 * than silently hashing a lossy projection.
 */
export function canonicalStringify(value, seen = new Set()) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalStringify: non-finite number is not JSON data");
    return JSON.stringify(value);
  }
  if (t === "boolean") return value ? "true" : "false";
  if (t !== "object") throw new TypeError(`canonicalStringify: ${t} is not JSON data`);
  if (seen.has(value)) throw new TypeError("canonicalStringify: cyclic structure is not JSON data");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => canonicalStringify(v, seen)).join(",")}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError("canonicalStringify: only plain objects are JSON data");
    }
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k], seen)}`);
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}
