/**
 * canonical.js — deterministic JSON + SHA-256 for the transport slice.
 *
 * canonicalStringify sorts object keys recursively (arrays keep their
 * order), so the same logical bundle always hashes to the same
 * digest. Only plain JSON data is accepted: undefined, functions,
 * symbols, and non-plain objects refuse rather than hashing
 * silently. Pure Node 24 ESM, zero deps.
 */

import { createHash } from "node:crypto";

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function canonicalStringify(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalStringify: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
  }
  throw new TypeError(`canonicalStringify: unsupported value of type ${typeof value}`);
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
