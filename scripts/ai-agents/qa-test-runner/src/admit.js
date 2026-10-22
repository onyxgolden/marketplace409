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
 * (depth, node count, exact serialized UTF-8 byte size) are charged as
 * the walk proceeds; the first over-limit candidate dies on the charge
 * and the unexplored tail is never visited. Byte charging is EXACT, not
 * estimated: every candidate's contribution is the UTF-8 byte length of
 * its JSON.stringify spelling (escaping, numeric forms, quotes, key
 * spellings, colons, commas, brackets), charged when the candidate is
 * first visited, before its subtree. An input whose canonical
 * serialization is exactly the byte budget admits; one byte more
 * refuses — the admission bound and the serializer agree to the byte.
 *
 * Dangerous keys: an own "__proto__" key is refused outright
 * (DANGEROUS_KEY) — the detached copy attaches with parent[key] =
 * copy, which would mutate the copy's prototype instead of staying
 * inert data, conferring inherited job configuration. "constructor"
 * and "prototype" as own data keys are inert (plain assignments, no
 * prototype effect) and are left as ordinary data.
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
 * non-finite number, or a value JSON cannot represent),
 * DANGEROUS_KEY (own "__proto__" key).
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
 * Exact serialized-byte cost of one JSON scalar or key, in UTF-8 bytes.
 * JSON.stringify is the serializer the rest of the system uses, so its
 * spelling (escaping, numeric forms, quotes) is the exact byte cost —
 * never a character-count estimate.
 */
function jsonUtf8Bytes(v) {
  return Buffer.byteLength(JSON.stringify(v), "utf8");
}

const MAX_PATH_CHARS = 256;
function childPath(parentPath, key) {
  const p = `${parentPath}.${String(key)}`;
  return p.length > MAX_PATH_CHARS ? `${p.slice(0, MAX_PATH_CHARS)}…` : p;
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
  // Charge-before-visit: every candidate's exact serialized bytes are
  // charged when the candidate is first visited, BEFORE its subtree is
  // explored or the next candidate is visited. A candidate sitting past
  // the byte budget therefore dies on INPUT_LIMIT even when it would
  // also be schema-invalid — budget first, validation second.
  const charge = (n) => {
    bytes += n;
    if (bytes > L.maxBytes) {
      return refusal("INPUT_LIMIT", `input exceeds ${L.maxBytes} serialized bytes`);
    }
    return null;
  };
  try {
    // Iterative DFS with an explicit stack — recursion depth is bounded
    // by maxDepth anyway, but an explicit stack also keeps cycle and
    // breadth accounting exact. Frames: [value, depth, parentCopy, key].
    const rootFrame = { value: input, depth: 0, parent: null, key: null, path: "$", keyBytes: 0 };
    const stack = [rootFrame];
    let root = null;
    const inProgress = new Set();
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame.exit) {
        // One closing brace/bracket per container, charged in walk order.
        const over = charge(1);
        if (over) return over;
        inProgress.delete(frame.value);
        continue;
      }
      const { value, depth, parent, key, path, keyBytes } = frame;
      nodes += 1;
      if (nodes > L.maxNodes) {
        return refusal("INPUT_LIMIT", `input exceeds ${L.maxNodes} nodes`);
      }
      if (depth > L.maxDepth) {
        return refusal("INPUT_LIMIT", `input nesting exceeds ${L.maxDepth} levels`);
      }
      // The candidate's own structural bytes land before anything
      // beneath it is visited: key spelling + colon + separating comma.
      const over = charge(keyBytes);
      if (over) return over;
      const attach = (copy) => {
        if (parent === null) root = copy;
        else parent[key] = copy;
      };
      if (value === null) {
        const o2 = charge(4); // "null"
        if (o2) return o2;
        attach(null);
        continue;
      }
      const t = typeof value;
      if (t === "boolean") {
        const o2 = charge(value ? 4 : 5); // "true" | "false"
        if (o2) return o2;
        attach(value);
        continue;
      }
      if (t === "number") {
        if (!Number.isFinite(value)) {
          return refusal("NON_JSON_INPUT", "non-finite numbers are not JSON data");
        }
        const o2 = charge(jsonUtf8Bytes(value)); // exact numeric spelling
        if (o2) return o2;
        attach(value);
        continue;
      }
      if (t === "string") {
        if (value.length > L.maxStringLength) {
          return refusal("INPUT_LIMIT", `string exceeds ${L.maxStringLength} characters`);
        }
        const o2 = charge(jsonUtf8Bytes(value)); // exact escaping + quotes
        if (o2) return o2;
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
        if (k === "__proto__") {
          // Q665-004A: the detached copy attaches with parent[key] = copy,
          // so an own __proto__ data key would MUTATE the copy's prototype
          // instead of staying inert data — conferring inherited job
          // configuration (Object.keys(job)==[] yet job.target resolves).
          // __proto__ can never be a legitimate job field, so it is
          // refused outright rather than laundered into the copy.
          return refusal("DANGEROUS_KEY", `own "__proto__" key at ${childPath(path, k)} would confer inherited configuration; refused`);
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
        // Sparse arrays are not JSON data: JSON.stringify spells holes
        // as null, so a sparse input and its detached copy would have
        // different serialized bytes — exact charge-before-visit
        // accounting requires the dense shape. Non-index own properties
        // on arrays are likewise not JSON data (JSON.stringify ignores
        // them); they are skipped below, so only canonical indices are
        // charged and copied.
        let indexCount = 0;
        for (const k of keys) {
          if (k === "length") continue;
          if (typeof k === "string" && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < lenDesc.value) indexCount += 1;
        }
        if (indexCount !== lenDesc.value) {
          return refusal("NON_JSON_INPUT", "sparse arrays are not JSON data");
        }
      }
      const copy = isArr ? [] : {};
      // One opening brace/bracket per container, charged in walk order.
      const over2 = charge(1);
      if (over2) return over2;
      attach(copy);
      inProgress.add(value);
      stack.push({ exit: true, value });
      // The visit list: exactly the entries JSON.stringify serializes, in
      // order. Non-enumerable properties, "length", and non-index array
      // properties are not JSON data and are skipped (never charged).
      const visit = [];
      for (const k of keys) {
        if (isArr && k === "length") continue;
        if (isArr && !(typeof k === "string" && /^(0|[1-9][0-9]*)$/.test(k))) continue;
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
        visit.push([k, desc]);
      }
      // Push children in reverse so traversal reads in key order.
      for (let vi = visit.length - 1; vi >= 0; vi--) {
        const [k, desc] = visit[vi];
        // Exact structural bytes for this candidate, charged when the
        // candidate is visited (before its subtree): the key's exact
        // serialized spelling, the colon, and the separating comma for
        // every entry after the first. Arrays have no keys/colons.
        const keyBytes = isArr ? (vi > 0 ? 1 : 0) : jsonUtf8Bytes(String(k)) + 1 + (vi > 0 ? 1 : 0);
        stack.push({
          value: desc.value,
          depth: depth + 1,
          parent: copy,
          key: k,
          path: childPath(path, k),
          keyBytes,
        });
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
