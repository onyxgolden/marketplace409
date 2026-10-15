/**
 * canonical.js — deterministic JSON canonicalization (sorted keys, no
 * whitespace). Used for fixture blob hashing (Git blob SHA-1 over the
 * canonical bytes) and determinism checks. Builtins only.
 */

export function canonicalize(value) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (t === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") +
      "}"
    );
  }
  throw new Error("canonicalize: unsupported value type " + t);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), "utf8");
}
