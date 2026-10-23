import { createHash } from "node:crypto";

/**
 * Canonical JSON + SHA-256 for the rental-ops wiring.
 *
 * Canonical form: object keys sorted by UTF-16 code unit, arrays in
 * order, no whitespace, strings/numbers via JSON.stringify. Only plain
 * JSON data is canonicalizable; anything else (undefined, functions,
 * non-finite numbers, class instances) throws, so two runs can never
 * silently disagree about the bytes they hashed.
 */
export function canonicalJson(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // JSON semantics: undefined array elements serialize as null.
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error("canonicalJson: non-plain object");
    // JSON semantics: object keys whose value is undefined are omitted —
    // this is what lets a projected row mark an absent allowlisted
    // field as undefined without changing the record's identity.
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported type ${t}`);
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalDigest(value) {
  return sha256Hex(canonicalJson(value));
}
