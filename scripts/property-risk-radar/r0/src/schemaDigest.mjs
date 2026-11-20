// Shared canonical digest + shape helpers for the Property Risk Radar R0
// contract pack. Node 24 built-ins only. No network, no filesystem access
// here — callers pass already-loaded values in.

import { createHash } from "node:crypto";

// Deterministic JSON: object keys sorted recursively, arrays in order.
// Two runs over the same value always produce the same string, so digests
// and generated reports are byte-identical.
export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`,
  );
  return `{${parts.join(",")}}`;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Digest of any JSON value via its canonical form.
export function digestObject(value) {
  return sha256Hex(canonicalStringify(value));
}

// Minimal shape checker used by adapters. `fields` is an array of
// { name, type, required, enum } where type is one of
// "string" | "number" | "boolean" | "array" | "object" | "null".
// Returns an array of human-readable error strings (empty = valid).
export function shapeErrors(value, fields, label) {
  const errors = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label}: expected an object`);
    return errors;
  }
  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(value, field.name);
    if (!present) {
      if (field.required) {
        errors.push(`${label}.${field.name}: missing required field`);
      }
      continue;
    }
    const actual = value[field.name];
    if (actual === null) {
      if (field.type !== "null" && field.required) {
        errors.push(`${label}.${field.name}: null, expected ${field.type}`);
      }
      continue;
    }
    const actualType = Array.isArray(actual) ? "array" : typeof actual;
    if (actualType !== field.type) {
      errors.push(
        `${label}.${field.name}: expected ${field.type}, got ${actualType}`,
      );
      continue;
    }
    if (field.enum && !field.enum.includes(actual)) {
      errors.push(
        `${label}.${field.name}: value ${JSON.stringify(actual)} not in ${field.enum.join(", ")}`,
      );
    }
  }
  return errors;
}

// Returns true when `value` is a finite number.
export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// A WGS84 longitude/latitude pair, in that order. Coordinates in fixtures
// must be public test points or official example values — never a private
// address or a real user's property pin.
export function isLngLat(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}
