// Team Brain slice 1 — deterministic stable stringification.
// Recursively sorts object keys; arrays keep their order. Used by the fixture
// CLI so identical input + database state + now yields byte-identical JSON.

export function stableStringify(value) {
  return stringifyValue(value);
}

function stringifyValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("stableStringify: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stringifyValue).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifyValue(value[k])}`).join(",")}}`;
  }
  throw new Error(`stableStringify: unsupported type ${typeof value}`);
}
