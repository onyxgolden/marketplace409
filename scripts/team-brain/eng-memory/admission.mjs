// Team Brain eng-memory slice 1 — bounded descriptor-based admission.
// Pure, no I/O, no network, no model calls.
//
// Admission owns the trust boundary between an untrusted caller-supplied
// value and the typed schema validators. Rules:
//
//  1. Only OWN data properties are inspected (Object.getOwnPropertyDescriptors).
//     Inherited properties, prototype getters, and proxy traps on the
//     prototype chain are never consulted.
//  2. ZERO accessor invocation: if any own property is an accessor
//     (descriptor has get/set), admission refuses with ACCESSOR_REJECTED
//     without invoking it. Throwing sentinels in tests prove this.
//  3. Unknown keys are refused with UNKNOWN_FIELD BEFORE their values are
//     read, at any nesting depth. Extra nested fields never get traversed.
//  4. `__proto__` as an own key is refused outright (prototype pollution).
//  5. Admission is bounded: max depth 4, max 256 own keys per level.
//     Exceeding either refuses with ADMISSION_BOUND_EXCEEDED.
//  6. The admitted snapshot is a fresh plain object containing data values
//     only — the caller's object (and any live accessors) never escapes.

import { ENG_CODES, fail } from "./errors.mjs";

export const ADMISSION_MAX_DEPTH = 4;
export const ADMISSION_MAX_KEYS = 256;

const PROTO_KEY = "__proto__";

/**
 * Admit a value against a closed key schema.
 *
 * @param {*} value - the untrusted value
 * @param {Map<string, KeySpec>} keySpecs - closed schema: key -> {nested?: Map, optional?: boolean}
 * @param {object} opts - {depth, path}
 * @returns plain-object snapshot of own data properties
 *
 * KeySpec: { nested?: Map<string,KeySpec> } for nested objects, or
 * { scalar: true } for leaf values (validated later by schemas.mjs).
 * Admission proves leaves are PRIMITIVE data: after the accessor check, a
 * scalar whose value is a non-null object, function, or symbol is refused
 * with NONPRIMITIVE_SCALAR. Only `typeof desc.value` is consulted — the
 * value's own properties are never read, so getter-bearing objects, arrays,
 * and cyclic structures at scalar positions are rejected with zero
 * invocations, before serialization.
 */
export function admitObject(value, keySpecs, opts = {}) {
  const depth = opts.depth ?? 0;
  const path = opts.path ?? "$";
  if (depth > ADMISSION_MAX_DEPTH) {
    fail(ENG_CODES.ADMISSION_BOUND_EXCEEDED, `Admission depth exceeded at ${path}`, { path });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(ENG_CODES.ADMISSION_TYPE, `Expected an object at ${path}`, { path });
  }
  // Own descriptors only: never touches the prototype chain.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.length > ADMISSION_MAX_KEYS) {
    fail(ENG_CODES.ADMISSION_BOUND_EXCEEDED, `Too many own keys at ${path}`, { path });
  }
  const snapshot = {};
  for (const key of keys) {
    // Prototype pollution key: refuse before anything else.
    if (key === PROTO_KEY) {
      fail(ENG_CODES.PROTOTYPE_KEY, `Forbidden key at ${path}`, { path });
    }
    const spec = keySpecs.get(key);
    if (spec === undefined) {
      // Unknown field: refuse BEFORE reading its value. The descriptor's
      // value/getter is never touched for unknown keys.
      fail(ENG_CODES.UNKNOWN_FIELD, `Unknown field at ${path}.${key}`, { path: `${path}.${key}` });
    }
    const desc = descriptors[key];
    if (typeof desc.get === "function" || typeof desc.set === "function") {
      // Accessor property: refuse WITHOUT invoking. A throwing sentinel
      // getter must never fire during admission.
      fail(ENG_CODES.ACCESSOR_REJECTED, `Accessor property rejected at ${path}.${key}`, {
        path: `${path}.${key}`,
      });
    }
    const raw = desc.value;
    if (spec.nested) {
      snapshot[key] = admitObject(raw, spec.nested, { depth: depth + 1, path: `${path}.${key}` });
    } else {
      // Scalar position: prove primitive type descriptor-safely. Objects
      // (including arrays and cycles), functions, and symbols are refused
      // WITHOUT reading any of their properties — a throwing or counting
      // getter nested inside such a value can never fire.
      if (raw !== null && (typeof raw === "object" || typeof raw === "function" || typeof raw === "symbol")) {
        fail(ENG_CODES.NONPRIMITIVE_SCALAR, `Non-primitive scalar rejected at ${path}.${key}`, {
          path: `${path}.${key}`,
        });
      }
      snapshot[key] = raw;
    }
  }
  // Missing keys are fine here (optional/required is a schema concern, not
  // an admission concern); extra keys are impossible by construction above.
  return snapshot;
}

/** Build a closed key-spec Map from a compact descriptor. */
export function keySpecs(def) {
  const m = new Map();
  for (const [key, sub] of Object.entries(def)) {
    m.set(key, sub ? { nested: keySpecs(sub) } : { scalar: true });
  }
  return m;
}
