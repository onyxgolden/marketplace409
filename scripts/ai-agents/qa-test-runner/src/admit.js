/**
 * admit.js — bounded admission for untrusted job-shaped values.
 *
 * Charge-before-inspect, applied to the VALUE ITSELF before any field
 * validation: caller-controlled Proxy objects are refused FIRST via
 * util.types.isProxy — a trap-free shape check — before ANY reflective
 * traversal, because every reflective operation (getPrototypeOf,
 * ownKeys, getOwnPropertyDescriptor) invokes caller-defined traps on a
 * Proxy and a non-throwing trap would execute arbitrary caller code
 * before any refusal could land. Non-proxy values are then walked
 * exactly once via property DESCRIPTORS (Object.getOwnPropertyDescriptor
 * / Reflect.ownKeys), so getters, setters and revoked-Proxy traps are
 * never invoked either — an accessor property is a refusal, not a
 * read. Structural limits
 * (depth, node count, estimated byte size) are charged as the walk
 * proceeds; the first over-limit candidate dies on the charge and the
 * unexplored tail is never visited.
 *
 * The walk produces a DETACHED plain-data copy (fresh objects/arrays,
 * plain string keys, finite numbers, strings, booleans, null). Every
 * downstream consumer — validation, budget charging, refusal reports —
 * works only on that detached copy, so nothing downstream can invoke
 * caller code either, and refusals are built from admitted metadata
 * only (counts and paths), never from an unbounded walk of the input.
 *
 * Refusal codes: INPUT_LIMIT (depth / node / byte budget exceeded),
 * NON_JSON_INPUT (accessor, Proxy-shaped, cyclic, sparse, symbol-keyed,
 * non-finite number, or a value JSON cannot represent).
 */

import { types as utilTypes } from "node:util";

export const ADMISSION_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 4096,
  maxBytes: 64 * 1024,
  maxStringLength: 8192,
  maxArrayLength: 1024,
});

function refusal(code, message) {
  return { ok: false, code, message };
}

function isPlainProto(proto) {
  return proto === Object.prototype || proto === null;
}

/**
 * Admit an untrusted value as bounded plain JSON data.
 * Returns {ok:true, value} | {ok:false, code, message}. Never throws
 * on user data; never invokes user code (accessors/Proxies refused
 * from their descriptors, and any trap that still throws is caught).
 */
export function admitValue(input) {
  const L = ADMISSION_LIMITS;
  let nodes = 0;
  let bytes = 0;
  try {
    // Iterative DFS with an explicit stack — recursion depth is bounded
    // by maxDepth anyway, but an explicit stack also keeps cycle and
    // breadth accounting exact. Frames: [value, depth, parentCopy, key].
    const rootFrame = { value: input, depth: 0, parent: null, key: null };
    const stack = [rootFrame];
    let root = null;
    const inProgress = new Set();
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame.exit) {
        inProgress.delete(frame.value);
        continue;
      }
      const { value, depth, parent, key } = frame;
      nodes += 1;
      if (nodes > L.maxNodes) {
        return refusal("INPUT_LIMIT", `input exceeds ${L.maxNodes} nodes`);
      }
      if (depth > L.maxDepth) {
        return refusal("INPUT_LIMIT", `input nesting exceeds ${L.maxDepth} levels`);
      }
      const attach = (copy) => {
        if (parent === null) root = copy;
        else parent[key] = copy;
      };
      if (value === null) {
        bytes += 4;
        attach(null);
        continue;
      }
      const t = typeof value;
      if (t === "boolean") {
        bytes += 5;
        attach(value);
        continue;
      }
      if (t === "number") {
        if (!Number.isFinite(value)) {
          return refusal("NON_JSON_INPUT", "non-finite numbers are not JSON data");
        }
        bytes += 8;
        attach(value);
        continue;
      }
      if (t === "string") {
        if (value.length > L.maxStringLength) {
          return refusal("INPUT_LIMIT", `string exceeds ${L.maxStringLength} characters`);
        }
        bytes += value.length + 2;
        if (bytes > L.maxBytes) {
          return refusal("INPUT_LIMIT", `input exceeds ${L.maxBytes} bytes`);
        }
        attach(value);
        continue;
      }
      if (t !== "object") {
        // undefined, function, symbol, bigint — none are JSON data,
        // and functions are never invoked to find out more.
        return refusal("NON_JSON_INPUT", `value of type ${t} is not JSON data`);
      }
      // Q665-008: caller-controlled Proxies are refused BEFORE any
      // reflective traversal. util.types.isProxy is a trap-free shape
      // check (it consults the engine's internal object shape and cannot
      // invoke user traps, not even on a revoked Proxy). Every
      // reflective operation below — Object.getPrototypeOf, Reflect.ownKeys,
      // Object.getOwnPropertyDescriptor — WOULD invoke the
      // caller-defined getPrototypeOf/ownKeys/getOwnPropertyDescriptor
      // traps on a live Proxy, executing arbitrary caller code before a
      // thrown trap could ever be converted into a refusal. (Array.isArray
      // is trap-free by spec, but the gate runs first regardless.)
      if (utilTypes.isProxy(value)) {
        return refusal("NON_JSON_INPUT", "Proxy objects are not JSON data");
      }
      // Objects and arrays from here on. A revoked Proxy throws on
      // these probes — the surrounding catch turns that into a refusal.
      if (inProgress.has(value)) {
        return refusal("NON_JSON_INPUT", "cyclic structures are not JSON data");
      }
      const isArr = Array.isArray(value);
      if (!isArr && !isPlainProto(Object.getPrototypeOf(value))) {
        // Class instances, Dates, Maps, Proxies over exotic targets:
        // not plain JSON containers. Refused, contents unexamined.
        return refusal("NON_JSON_INPUT", "only plain objects and arrays are JSON data");
      }
      let keys;
      try {
        keys = Reflect.ownKeys(value);
      } catch {
        return refusal("NON_JSON_INPUT", "input could not be inspected without invoking it");
      }
      for (const k of keys) {
        if (typeof k === "symbol") {
          return refusal("NON_JSON_INPUT", "symbol-keyed properties are not JSON data");
        }
      }
      if (isArr) {
        const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
        if (!lenDesc || "get" in lenDesc || "set" in lenDesc || typeof lenDesc.value !== "number") {
          return refusal("NON_JSON_INPUT", "array length is not a plain data property");
        }
        if (lenDesc.value > L.maxArrayLength) {
          return refusal("INPUT_LIMIT", `array exceeds ${L.maxArrayLength} entries`);
        }
      }
      const copy = isArr ? [] : {};
      attach(copy);
      inProgress.add(value);
      stack.push({ exit: true, value });
      // Push children in reverse so traversal reads in key order.
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        if (isArr && k === "length") continue;
        let desc;
        try {
          desc = Object.getOwnPropertyDescriptor(value, k);
        } catch {
          return refusal("NON_JSON_INPUT", "input could not be inspected without invoking it");
        }
        if (!desc) continue;
        if ("get" in desc || "set" in desc) {
          // An accessor: its value is executable code. Refuse WITHOUT
          // invoking it — the descriptor alone is the whole evidence.
          return refusal("NON_JSON_INPUT", `accessor property "${String(k)}" is not JSON data`);
        }
        if (!desc.enumerable) {
          // JSON data is enumerable by construction; a hidden data
          // property is out-of-shape but inert — skip it, do not copy.
          continue;
        }
        bytes += String(k).length + 4;
        if (bytes > L.maxBytes) {
          return refusal("INPUT_LIMIT", `input exceeds ${L.maxBytes} bytes`);
        }
        stack.push({ value: desc.value, depth: depth + 1, parent: copy, key: k });
      }
    }
    if (bytes > L.maxBytes) {
      return refusal("INPUT_LIMIT", `input exceeds ${L.maxBytes} bytes`);
    }
    return { ok: true, value: root };
  } catch {
    // Any trap that throws despite descriptor-only access lands here:
    // still a named refusal, never an exception out of admission.
    return refusal("NON_JSON_INPUT", "input could not be admitted without invoking it");
  }
}
