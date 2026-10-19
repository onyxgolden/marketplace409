// admission.js — descriptor-safe bounded admission traversal.
// Charges every candidate object BEFORE its fields are read, and measures
// bytes without recursively evaluating uncharged candidates (PC650-001).
//
// Candidate taxonomy (exact):
// - Task envelope: task root (1) + each fixture_ref string slot (1 each) +
//   options object (1) + each eac_formulas entry slot (1 each)
// - Context envelope: context root (1) + clock object (1) + principal
//   object (1) + each grants entry slot (1 each)
// - Fixture registry: each registry entry object (1) charged in resolve()
//   before entry.bytes/entry.sha256 are read
// - Package: package root (1) + planned_percent (1 if present) +
//   claimed_actual_percent (1) + evidenced_ev_minor slot (1 if present) +
//   actual_cost_lines array (1) + each line object (1 each) +
//   etc_lines array (1) + each line object (1 each) +
//   contingency object (1 if present) + additions array (1) +
//   each addition (1 each) + draws array (1) + each draw (1 each) +
//   header_claims object (1 if present) + each rational sub-object (1 each) +
//   source_ref object (1)
// - Spans: each checked byte span (1 per chargeSpan, max 512)
// - Output: each public record in the envelope (1 per chargeOutputRecord,
//   max 256)
//
// Descriptor safety: uses Object.getOwnPropertyDescriptor to detect getters.
// If a getter is found where a data property is expected, the traversal
// refuses with INVALID_INPUT (accessor present) rather than executing it.

import { BudgetExceeded, InputLimit, LIMITS } from './resolver.js';
import { utf8Length } from './canonical.js';
import { types } from 'node:util';

/**
 * Get an own data property value without invoking getters.
 * Returns {present, isAccessor, value}.
 */
export function getOwnData(obj, key) {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc) return { present: false, isAccessor: false, value: undefined };
  if (typeof desc.get === 'function' || typeof desc.set === 'function') {
    return { present: true, isAccessor: true, value: undefined };
  }
  return { present: true, isAccessor: false, value: desc.value };
}

/**
 * Assert that an object has no getters/setters among its own properties.
 * Throws INVALID_INPUT if an accessor is found.
 */
export function assertNoAccessors(obj, what) {
  if (obj === null || typeof obj !== 'object') return;
  const keys = Object.keys(obj);
  for (const k of keys) {
    const desc = Object.getOwnPropertyDescriptor(obj, k);
    if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
      const e = new Error(`INVALID_INPUT: accessor property ${what}.${k} rejected`);
      e.code = 'INVALID_INPUT';
      throw e;
    }
  }
  // Also check array indices for sparse/holey arrays with getters
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(obj, i);
      if (!desc) {
        const e = new Error(`INVALID_INPUT: sparse array hole at ${what}[${i}] rejected`);
        e.code = 'INVALID_INPUT';
        throw e;
      }
      if (typeof desc.get === 'function' || typeof desc.set === 'function') {
        const e = new Error(`INVALID_INPUT: accessor at ${what}[${i}] rejected`);
        e.code = 'INVALID_INPUT';
        throw e;
      }
    }
  }
}

/**
 * Deep accessor check for transport admission (PC650-007).
 * Recursively verifies that a value and all its nested objects contain
 * no getters/setters. Used before worker thread creation to ensure the
 * parent thread never executes accessor code during structured cloning.
 *
 * PC650-007: Proxy values are rejected with a NON-EXECUTING primitive
 * (util.types.isProxy) BEFORE any reflective operation. Object.keys and
 * Object.getOwnPropertyDescriptor trigger Proxy traps (ownKeys,
 * getOwnPropertyDescriptor) — on a Proxy with a hanging ownKeys trap, the
 * parent would hang before the watchdog timer exists. isProxy() is a native
 * V8 check that invokes no user code.
 */
export function assertDeepNoAccessors(value, where, depth = 0, seen = new WeakSet()) {
  if (depth > 64) {
    const e = new Error(`INVALID_INPUT: ${where} exceeds max depth 64`);
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (value === null || typeof value !== 'object') return;
  // PC650-007: reject Proxies BEFORE any reflection. This check executes no
  // user code (native V8 internal-slot test).
  if (types.isProxy(value)) {
    const e = new Error(`TRANSPORT_REFUSED: Proxy value at ${where} rejected: reflection-unsafe for parent transport`);
    e.code = 'TRANSPORT_REFUSED';
    throw e;
  }
  if (seen.has(value)) return;
  seen.add(value);
  assertNoAccessors(value, where);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      // isProxy already checked for `value`; children are checked on recursion.
      // Use descriptor read (safe on non-Proxy) to avoid invoking getters.
      const slot = getOwnData(value, i);
      if (slot.present && !slot.isAccessor) {
        assertDeepNoAccessors(slot.value, `${where}[${i}]`, depth + 1, seen);
      }
    }
  } else {
    for (const k of Object.keys(value)) {
      const slot = getOwnData(value, k);
      if (slot.present && !slot.isAccessor) {
        assertDeepNoAccessors(slot.value, `${where}.${k}`, depth + 1, seen);
      }
    }
  }
}

/**
 * Charged canonical stringify: walks the value with the budget, charging
 * each object/array before reading its contents. Returns the canonical
 * JSON string. Throws BudgetExceeded if the 65th distinct object is reached
 * BEFORE reading it; throws INVALID_INPUT on accessors.
 *
 * This replaces the uncharged canonicalStringify(task) for input byte
 * measurement. The traversal charges objects in the same order that
 * checkTask/checkContext will validate them, ensuring the budget is
 * enforced before any uncharged read.
 */
export function chargedStringify(value, budget, depth = 0) {
  if (depth > LIMITS.maxDepth) {
    throw new InputLimit('admission: nesting depth exceeds 32');
  }
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InputLimit('admission: non-finite number');
    return String(value);
  }
  if (typeof value === 'string') {
    // Strings are values, not candidate objects; just measure
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    throw new InputLimit('admission: bigint not allowed in input');
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    throw new InputLimit('admission: unsupported value type');
  }

  // Object or Array: charge BEFORE reading contents.
  // PC650-001: the budget charge comes FIRST, before any key/descriptor
  // inspection. If this is the 65th distinct object, BudgetExceeded is thrown
  // BEFORE the candidate is examined at all (no descriptor reads, no key
  // listing). The over-limit candidate is never inspected.
  budget.chargeObject(value);
  assertNoAccessors(value, depth === 0 ? 'input' : 'nested');

  if (Array.isArray(value)) {
    const parts = [];
    // Use descriptor-safe reads for each index
    for (let i = 0; i < value.length; i++) {
      const slot = getOwnData(value, i);
      if (!slot.present) {
        const e = new Error(`INVALID_INPUT: sparse array hole at index ${i}`);
        e.code = 'INVALID_INPUT';
        throw e;
      }
      if (slot.isAccessor) {
        const e = new Error(`INVALID_INPUT: accessor at array index ${i} rejected`);
        e.code = 'INVALID_INPUT';
        throw e;
      }
      // The slot value is charged when recursed (if it's an object);
      // primitives are not candidates. Do NOT charge the slot unconditionally.
      parts.push(chargedStringify(slot.value, budget, depth + 1));
    }
    return '[' + parts.join(',') + ']';
  }

  // Plain object
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    const slot = getOwnData(value, k);
    if (!slot.present || slot.isAccessor) {
      const e = new Error(`INVALID_INPUT: invalid property ${k}`);
      e.code = 'INVALID_INPUT';
      throw e;
    }
    // The property value is charged when recursed (if it's an object).
    parts.push(JSON.stringify(k) + ':' + chargedStringify(slot.value, budget, depth + 1));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Measure input bytes with charged admission. Returns the byte count.
 * The value is fully traversed with charging; if the budget is exceeded,
 * BudgetExceeded is thrown before the over-limit candidate is read.
 */
export function measureInputBytes(value, budget) {
  const text = chargedStringify(value, budget, 0);
  const n = utf8Length(text);
  budget.chargeInputBytes(n);
  return n;
}
