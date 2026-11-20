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

// GeoJSON geometry type names. ArcGIS names (Polyline, etc.) are never
// valid here: adapters request f=geojson, so contracts must record the
// GeoJSON wire format.
export const GEOJSON_GEOMETRY_TYPES = [
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
];

// Resolve a declared response path such as
// "features[].properties.OBJECTID" or "result.input.address" against a
// parsed response body. A "[]" segment maps over every array element.
// Returns { values, emptyArray }: `values` holds every present,
// non-null value the path resolves to; `emptyArray` is true when the
// path traverses an array that exists but is empty (zero features is a
// valid observation, not a missing field).
export function resolveFieldPath(value, path) {
  const segments = path.split(".");
  let current = [value];
  let emptyArray = false;
  for (const segment of segments) {
    const next = [];
    if (segment.endsWith("[]")) {
      const key = segment.slice(0, -2);
      for (const item of current) {
        if (item === null || typeof item !== "object" || !(key in item)) {
          continue;
        }
        const array = item[key];
        if (!Array.isArray(array)) {
          continue;
        }
        if (array.length === 0) {
          emptyArray = true;
          continue;
        }
        next.push(...array);
      }
    } else {
      for (const item of current) {
        if (item !== null && typeof item === "object" && segment in item) {
          next.push(item[segment]);
        }
      }
    }
    current = next;
    if (current.length === 0) {
      return { values: [], emptyArray };
    }
  }
  const values = current.filter(
    (entry) => entry !== undefined && entry !== null,
  );
  return { values, emptyArray };
}

// A declared path may carry a human note in trailing parentheses, e.g.
// "features[].properties.EFF_DATE (map effective date)". The path is the
// part before the note.
export function declaredPath(raw) {
  return raw.split(" (")[0];
}

// Traverse an adapter CONTRACT's declared response paths against a parsed
// sample (fixture or live) response. Fails closed: a declared required
// field that does not resolve, an observation-time path that does not
// resolve, an ArcGIS geometry name, or a feature geometry outside the
// contract's declared types all error — so a descriptive-but-wrong
// contract cannot still validate. Paths through an empty array are
// skipped: zero features is a valid observation.
export function checkDeclaredResponsePaths(sample, contract, label) {
  const errors = [];
  const response = contract.response || {};
  for (const rawPath of response.requiredFields || []) {
    const path = declaredPath(rawPath);
    const { values, emptyArray } = resolveFieldPath(sample, path);
    if (values.length === 0 && !emptyArray) {
      errors.push(
        `${label}: declared required field ${rawPath} does not resolve in the response`,
      );
    }
  }
  if (typeof contract.observationTimeField === "string") {
    const path = declaredPath(contract.observationTimeField);
    const { values, emptyArray } = resolveFieldPath(sample, path);
    if (values.length === 0 && !emptyArray) {
      errors.push(
        `${label}: declared observation-time field ${contract.observationTimeField} does not resolve in the response`,
      );
    }
  }
  for (const type of response.geometryTypes || []) {
    if (typeof type === "string" && !GEOJSON_GEOMETRY_TYPES.includes(type)) {
      errors.push(
        `${label}: geometry type ${JSON.stringify(type)} is not a GeoJSON geometry type`,
      );
    }
  }
  if (Array.isArray(sample?.features)) {
    const allowed = (response.geometryTypes || []).filter(
      (entry) => typeof entry === "string",
    );
    for (const [index, feature] of sample.features.entries()) {
      const geometryType = feature?.geometry?.type;
      if (typeof geometryType === "string" && allowed.length > 0) {
        if (!allowed.includes(geometryType)) {
          errors.push(
            `${label}.features[${index}].geometry.type: ${geometryType} is outside the contract's declared geometry types`,
          );
        }
      }
    }
  }
  return errors;
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
