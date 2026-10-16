/**
 * budget.js — one monotonic budget per run() invocation, plus the
 * structural pre-splitter.
 *
 * Caps: 256 KiB total input UTF-8, 64 consulted objects, 512 evidence
 * spans, 256 output records, 256 KiB final output. Every candidate object
 * is charged BEFORE it is inspected; the 65th object charge (or 513th
 * span charge) throws before that candidate — or anything after it — is
 * touched. No dedup refunds.
 *
 * The pre-splitter yields raw per-element byte spans of a fixture's
 * "rows" array WITHOUT decoding any candidate's fields: the resolver
 * charges one object per span, then parses only that span. Byte lengths
 * are bounded before decoding; nesting depth > 32 refuses.
 */

export const BUDGET_LIMITS = {
  maxInputBytes: 256 * 1024,
  maxObjects: 64,
  maxSpans: 512,
  maxOutputRecords: 256,
  maxOutputBytes: 256 * 1024,
  maxDepth: 32,
};

export class BudgetError extends Error {
  constructor(code, reason) {
    super(reason);
    this.name = "BudgetError";
    this.code = code;
  }
}

export class Budget {
  constructor() {
    this.objects = 0;
    this.spans = 0;
    this.inputBytes = 0;
    this.outputRecords = 0;
  }
  chargeObject(n = 1) {
    this.objects += n;
    if (this.objects > BUDGET_LIMITS.maxObjects) {
      throw new BudgetError(
        "BUDGET_EXCEEDED",
        `object budget exceeded: ${this.objects}/${BUDGET_LIMITS.maxObjects} consulted objects`
      );
    }
  }
  chargeSpan(n = 1) {
    this.spans += n;
    if (this.spans > BUDGET_LIMITS.maxSpans) {
      throw new BudgetError(
        "BUDGET_EXCEEDED",
        `span budget exceeded: ${this.spans}/${BUDGET_LIMITS.maxSpans} evidence spans`
      );
    }
  }
  chargeInputBytes(n) {
    this.inputBytes += n;
    if (this.inputBytes > BUDGET_LIMITS.maxInputBytes) {
      throw new BudgetError(
        "INPUT_LIMIT",
        `input budget exceeded: ${this.inputBytes}/${BUDGET_LIMITS.maxInputBytes} bytes`
      );
    }
  }
  chargeOutputRecord(n = 1) {
    this.outputRecords += n;
    if (this.outputRecords > BUDGET_LIMITS.maxOutputRecords) {
      throw new BudgetError(
        "OUTPUT_LIMIT",
        `output record budget exceeded: ${this.outputRecords}/${BUDGET_LIMITS.maxOutputRecords} records`
      );
    }
  }
}

export class StructuralError extends Error {
  constructor(code, reason) {
    super(reason);
    this.name = "StructuralError";
    this.code = code; // INVALID_INPUT | INPUT_TOO_DEEP
  }
}

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

function isWs(b) {
  return WS.has(b);
}

/**
 * Scan a JSON string starting at index i (bytes[i] === 0x22).
 * Returns the index just past the closing quote. Throws StructuralError
 * on unterminated strings or invalid escapes. Strict: only the JSON
 * escapes \" \\ \/ \b \f \n \r \t \uXXXX are accepted.
 */
function scanString(bytes, i) {
  let j = i + 1;
  while (j < bytes.length) {
    const c = bytes[j];
    if (c === 0x5c) {
      // backslash: validate the escape
      const e = bytes[j + 1];
      if (e === 0x75) {
        // \uXXXX: 4 hex digits required
        if (j + 5 >= bytes.length) throw new StructuralError("INVALID_INPUT", "fixture: truncated \\u escape");
        for (let k = j + 2; k <= j + 5; k++) {
          const h = bytes[k];
          const isHex = (h >= 0x30 && h <= 0x39) || (h >= 0x41 && h <= 0x46) || (h >= 0x61 && h <= 0x66);
          if (!isHex) throw new StructuralError("INVALID_INPUT", "fixture: invalid \\u escape");
        }
        j += 6;
      } else if (
        e === 0x22 || e === 0x5c || e === 0x2f || // " \ /
        e === 0x62 || e === 0x66 || e === 0x6e || e === 0x72 || e === 0x74 // b f n r t
      ) {
        j += 2;
      } else {
        throw new StructuralError("INVALID_INPUT", "fixture: invalid string escape");
      }
      continue;
    }
    if (c === 0x22) return j + 1;
    // Unescaped control characters are invalid in JSON strings
    if (c < 0x20) throw new StructuralError("INVALID_INPUT", "fixture: unescaped control character in string");
    j += 1;
  }
  throw new StructuralError("INVALID_INPUT", "fixture: unterminated string");
}

/**
 * Skip one JSON value starting at index i (first non-ws char), tracking
 * depth. Returns the index just past the value. Refuses depth > 32.
 */
function skipValue(bytes, i, depth) {
  if (depth > BUDGET_LIMITS.maxDepth) {
    throw new StructuralError("INPUT_TOO_DEEP", `fixture: nesting depth exceeds ${BUDGET_LIMITS.maxDepth}`);
  }
  const c = bytes[i];
  if (c === 0x22) return scanString(bytes, i);
  if (c === 0x7b || c === 0x5b) {
    // { or [: scan balanced, string-aware
    const open = c;
    const close = open === 0x7b ? 0x7d : 0x5d;
    let j = i + 1;
    let d = depth + 1;
    if (d > BUDGET_LIMITS.maxDepth) {
      throw new StructuralError("INPUT_TOO_DEEP", `fixture: nesting depth exceeds ${BUDGET_LIMITS.maxDepth}`);
    }
    while (j < bytes.length) {
      const ch = bytes[j];
      if (ch === 0x22) {
        j = scanString(bytes, j);
        continue;
      }
      if (ch === 0x7b || ch === 0x5b) {
        d += 1;
        if (d > BUDGET_LIMITS.maxDepth) {
          throw new StructuralError("INPUT_TOO_DEEP", `fixture: nesting depth exceeds ${BUDGET_LIMITS.maxDepth}`);
        }
      } else if (ch === 0x7d || ch === 0x5d) {
        d -= 1;
        if (d === depth) return j + 1;
      }
      j += 1;
    }
    throw new StructuralError("INVALID_INPUT", "fixture: unterminated container");
  }
  // literal: true/false/null/number — scan to delimiter
  let j = i;
  while (j < bytes.length && !isWs(bytes[j]) && bytes[j] !== 0x2c && bytes[j] !== 0x7d && bytes[j] !== 0x5d) {
    j += 1;
  }
  if (j === i) throw new StructuralError("INVALID_INPUT", "fixture: bad value");
  return j;
}

function skipWs(bytes, i) {
  while (i < bytes.length && isWs(bytes[i])) i += 1;
  return i;
}

/**
 * presplitRows(bytes) — bounded structural pre-split of one fixture.
 *
 * Returns { header: {fixture_id, kind, schema_version}, rowSpans: [[s,e],...] }
 * where each [s,e) is the raw UTF-8 byte span of one "rows" element.
 * No candidate field is decoded: header scalars are parsed from their own
 * tiny slices, rows are returned as opaque spans for the resolver to
 * charge-then-parse one at a time. Unknown top-level keys, a missing or
 * non-array "rows", or depth > 32 → StructuralError (named refusal, no
 * partial domain output).
 */
export function presplitRows(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  let i = skipWs(bytes, 0);
  if (bytes[i] !== 0x7b) throw new StructuralError("INVALID_INPUT", "fixture: top-level value must be an object");
  i += 1;
  const header = {};
  const seen = new Set();
  let rowSpans = null;
  let expectPair = true; // strict: no leading comma, no trailing comma
  for (;;) {
    i = skipWs(bytes, i);
    if (bytes[i] === 0x7d) {
      if (expectPair && seen.size > 0) {
        throw new StructuralError("INVALID_INPUT", "fixture: trailing comma in top-level object");
      }
      i += 1;
      break;
    }
    if (!expectPair) throw new StructuralError("INVALID_INPUT", "fixture: malformed object");
    if (bytes[i] !== 0x22) throw new StructuralError("INVALID_INPUT", "fixture: object keys must be strings");
    const keyEnd = scanString(bytes, i);
    const key = JSON.parse(bytes.toString("utf8", i, keyEnd));
    if (seen.has(key)) throw new StructuralError("INVALID_INPUT", `fixture: duplicate top-level key ${JSON.stringify(key)}`);
    seen.add(key);
    i = skipWs(bytes, keyEnd);
    if (bytes[i] !== 0x3a) throw new StructuralError("INVALID_INPUT", "fixture: expected ':' after key");
    i = skipWs(bytes, i + 1);
    if (key === "rows") {
      if (bytes[i] !== 0x5b) throw new StructuralError("INVALID_INPUT", 'fixture: "rows" must be an array');
      rowSpans = [];
      i += 1; // past '['
      let expectValue = true; // strict: no leading comma, no trailing comma
      for (;;) {
        i = skipWs(bytes, i);
        if (bytes[i] === 0x5d) {
          if (expectValue && rowSpans.length > 0) {
            throw new StructuralError("INVALID_INPUT", 'fixture: trailing comma in "rows" array');
          }
          i += 1;
          break;
        }
        if (!expectValue) throw new StructuralError("INVALID_INPUT", 'fixture: malformed "rows" array');
        const start = i;
        const end = skipValue(bytes, i, 2); // elements live at depth 2
        rowSpans.push([start, end]);
        i = skipWs(bytes, end);
        expectValue = false;
        if (bytes[i] === 0x2c) {
          i += 1;
          expectValue = true;
          continue;
        }
        if (bytes[i] === 0x5d) {
          i += 1;
          break;
        }
        throw new StructuralError("INVALID_INPUT", 'fixture: malformed "rows" array');
      }
    } else if (key === "fixture_id" || key === "kind" || key === "schema_version") {
      if (bytes[i] !== 0x22) throw new StructuralError("INVALID_INPUT", `fixture: "${key}" must be a string`);
      const vEnd = scanString(bytes, i);
      header[key] = JSON.parse(bytes.toString("utf8", i, vEnd));
      i = vEnd;
    } else {
      throw new StructuralError("INVALID_INPUT", `fixture: unknown top-level property ${JSON.stringify(key)}`);
    }
    i = skipWs(bytes, i);
    expectPair = false;
    if (bytes[i] === 0x2c) {
      i += 1;
      expectPair = true;
      continue;
    }
    if (bytes[i] === 0x7d) {
      i += 1;
      break;
    }
    throw new StructuralError("INVALID_INPUT", "fixture: malformed object");
  }
  i = skipWs(bytes, i);
  if (i !== bytes.length) throw new StructuralError("INVALID_INPUT", "fixture: trailing bytes after top-level object");
  for (const k of ["fixture_id", "kind", "schema_version"]) {
    if (typeof header[k] !== "string" || header[k].length === 0) {
      throw new StructuralError("INVALID_INPUT", `fixture: missing or empty "${k}"`);
    }
  }
  if (rowSpans === null) throw new StructuralError("INVALID_INPUT", 'fixture: missing "rows" array');
  return { header, rowSpans };
}

/** Depth of a plain JS value; {ok:false} when depth > 32 or cyclic. */
export function measureDepth(value) {
  const seen = new Set();
  function go(v, d) {
    if (d > BUDGET_LIMITS.maxDepth) return false;
    if (v !== null && typeof v === "object") {
      if (seen.has(v)) return false;
      seen.add(v);
      const vs = Array.isArray(v) ? v : Object.values(v);
      for (const x of vs) {
        if (!go(x, d + 1)) return false;
      }
      seen.delete(v);
    }
    return true;
  }
  const ok = go(value, 0);
  return ok ? { ok: true } : { ok: false, reason: `value nesting exceeds ${BUDGET_LIMITS.maxDepth} or is cyclic` };
}

/**
 * measureCanonicalBytes(value) — bounded pre-scan at the public entry.
 *
 * Computes the EXACT UTF-8 byte length that canonicalJson(value) would
 * produce, WITHOUT invoking any getter/setter or reading accessor
 * properties. Uses Object.getOwnPropertyDescriptor exclusively: data
 * descriptors are measured, accessor descriptors are counted as opaque
 * nodes (0 bytes measured, never invoked).
 *
 * This is the "bounded incremental traversal/accounting at the actual
 * public entry, before canonicalization, validation, hashing, property
 * read and nested parsing" required by M640-001. Serialization IS
 * inspection: calling canonicalJson() on uncharged input recursively
 * reads every field (firing getters, reading denied fixture bytes).
 * This pre-scan establishes the byte/object accounting FIRST, so the
 * budget can refuse BEFORE any value is read.
 *
 * Returns { bytes, nodes }. Throws StructuralError on depth > 32,
 * cyclic structures, or node count exceeding the sanity cap.
 * The node cap is a DoS bound, not the 64-object consultation budget.
 */
const PRESCAN_NODE_CAP = 100000;

function jsonStringByteLength(s) {
  // Exact JSON string encoding length: quotes + escapes.
  // JSON.stringify emits valid surrogate PAIRS as raw UTF-8; only LONE
  // surrogates become \uXXXX (6 bytes).
  let n = 2; // quotes
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x5c) {
      n += 2; // \" or \\
    } else if (c < 0x20) {
      // \b \f \n \r \t are 2 bytes; others are \uXXXX (6 bytes)
      n += (c === 0x08 || c === 0x0c || c === 0x0a || c === 0x0d || c === 0x09) ? 2 : 6;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4; i++; // valid pair -> raw UTF-8 (4 bytes)
      } else {
        n += 6; // lone high surrogate -> \uXXXX
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      n += 6; // lone low surrogate -> \uXXXX
    } else {
      n += Buffer.byteLength(s[i], "utf8");
    }
  }
  return n;
}

export function measureCanonicalBytes(value) {
  const seen = new Set();
  let nodes = 0;
  function go(v, depth) {
    if (++nodes > PRESCAN_NODE_CAP) {
      throw new StructuralError("INVALID_INPUT", "input: node count exceeds pre-scan cap");
    }
    if (depth > BUDGET_LIMITS.maxDepth) {
      throw new StructuralError("INPUT_TOO_DEEP", `input: nesting depth exceeds ${BUDGET_LIMITS.maxDepth}`);
    }
    if (v === null) return 4; // null
    const t = typeof v;
    if (t === "string") return jsonStringByteLength(v);
    if (t === "number") {
      const s = JSON.stringify(v);
      return s === undefined ? 4 : Buffer.byteLength(s, "utf8"); // non-finite -> null
    }
    if (t === "boolean") return v ? 4 : 5;
    if (t === "undefined" || t === "function" || t === "symbol") return 0; // dropped by canonicalize
    // object or array: descriptor-based traversal, never invoking accessors
    if (seen.has(v)) {
      throw new StructuralError("INVALID_INPUT", "input: cyclic structure");
    }
    seen.add(v);
    let n;
    if (Array.isArray(v)) {
      n = 2; // []
      const names = Object.getOwnPropertyNames(v);
      // Array elements: canonicalize maps each; undefined/function/symbol -> null in JSON arrays
      let first = true;
      for (let i = 0; i < v.length; i++) {
        if (!first) n += 1; // comma
        first = false;
        const desc = Object.getOwnPropertyDescriptor(v, i);
        if (!desc || !("value" in desc)) {
          n += 4; // hole or accessor -> null (accessor never invoked)
        } else {
          const ev = desc.value;
          const et = typeof ev;
          if (ev === undefined || et === "function" || et === "symbol") {
            n += 4; // null
          } else {
            n += go(ev, depth + 1);
          }
        }
      }
      // Non-index own properties on arrays are ignored by JSON.stringify; ignore here too.
    } else {
      n = 2; // {}
      const names = Object.getOwnPropertyNames(v).sort();
      let first = true;
      for (const k of names) {
        const desc = Object.getOwnPropertyDescriptor(v, k);
        if (!desc) continue;
        if (!("value" in desc)) continue; // accessor: opaque, never invoked, 0 bytes
        const ev = desc.value;
        if (ev === undefined || typeof ev === "function" || typeof ev === "symbol") continue; // dropped
        if (!first) n += 1; // comma
        first = false;
        n += jsonStringByteLength(k) + 1 + go(ev, depth + 1); // "key":value
      }
    }
    seen.delete(v);
    return n;
  }
  const bytes = go(value, 0);
  return { bytes, nodes };
}

/**
 * snapshotData(value) — descriptor-validated bounded data snapshot.
 *
 * Deep-copies plain data via Object.getOwnPropertyDescriptor exclusively.
 * Any accessor property (getter/setter, no "value" in descriptor) on the
 * traversed input throws StructuralError("ACCESSOR_REJECTED") WITHOUT
 * invoking it. This is the "reject accessors on control data at admission
 * without invoking them" path required by M640-001: the descriptor
 * pre-scan (measureCanonicalBytes) deliberately skips accessors during
 * measurement, but later canonicalJson()/validation would invoke them —
 * an accessor value is not bounded by the measured input size. The
 * snapshot runs at the public entry, after byte charging and before any
 * canonicalization, validation, hashing, or property read; all downstream
 * processing operates on the snapshot, so a getter can never fire.
 *
 * Array holes become null (matching JSON.stringify semantics). undefined,
 * function, and symbol values are dropped from objects and become null in
 * arrays (matching canonicalize). Depth > 32, cycles, and node counts
 * above the pre-scan cap throw StructuralError.
 *
 * NOTE: this snapshots the control plane (task; context clock/principal/
 * relays/grants/source_registry). context.fixtures is NOT snapshotted
 * here — fixture store entries are third-party data governed by the
 * resolver's charge-before-inspect path (grant check precedes any byte
 * read), and a denied fixture's bytes getter must reach READ_DENIED
 * rather than being rejected at snapshot time.
 */
export function snapshotData(value) {
  const seen = new Set();
  let nodes = 0;
  function go(v, depth) {
    if (++nodes > PRESCAN_NODE_CAP) {
      throw new StructuralError("INVALID_INPUT", "input: snapshot node count exceeds pre-scan cap");
    }
    if (depth > BUDGET_LIMITS.maxDepth) {
      throw new StructuralError("INPUT_TOO_DEEP", `input: snapshot nesting depth exceeds ${BUDGET_LIMITS.maxDepth}`);
    }
    if (v === null) return null;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") return undefined;
    if (seen.has(v)) {
      throw new StructuralError("INVALID_INPUT", "input: snapshot found cyclic structure");
    }
    seen.add(v);
    let out;
    if (Array.isArray(v)) {
      out = [];
      for (let i = 0; i < v.length; i++) {
        const desc = Object.getOwnPropertyDescriptor(v, i);
        if (!desc) {
          out[i] = null; // hole -> null, like JSON.stringify
          continue;
        }
        if (!("value" in desc)) {
          throw new StructuralError("ACCESSOR_REJECTED", "input: accessor property rejected on control data (not invoked)");
        }
        const ev = go(desc.value, depth + 1);
        out[i] = ev === undefined ? null : ev;
      }
    } else {
      out = {};
      for (const k of Object.getOwnPropertyNames(v)) {
        const desc = Object.getOwnPropertyDescriptor(v, k);
        if (!desc) continue;
        if (!("value" in desc)) {
          throw new StructuralError("ACCESSOR_REJECTED", "input: accessor property rejected on control data (not invoked)");
        }
        const ev = go(desc.value, depth + 1);
        if (ev !== undefined) out[k] = ev;
      }
    }
    seen.delete(v);
    return out;
  }
  return go(value, 0);
}

/**
 * snapshotContextControlPlane(context) — snapshot the host-injected
 * control plane (clock, principal, relays, grants, source_registry)
 * while leaving context.fixtures aliased for the resolver.
 *
 * Fixture store entries are intentionally NOT deep-copied here: they are
 * third-party payload data governed by the resolver's charge-before-
 * inspect sequence (scoped grant check precedes any byte read). A bytes
 * getter on a denied fixture must reach the grant check and refuse
 * READ_DENIED with zero byte reads — snapshotting it would either invoke
 * the getter or reject it before the permission check runs.
 *
 * The returned object is a fresh plain object; `fixtures` is the original
 * reference. Accessors anywhere in the control plane throw
 * StructuralError("ACCESSOR_REJECTED") without invocation.
 */
export function snapshotContextControlPlane(context) {
  if (context === null || typeof context !== "object" || Array.isArray(context)) {
    throw new StructuralError("INVALID_INPUT", "context: must be an object");
  }
  const out = {};
  for (const k of Object.getOwnPropertyNames(context)) {
    if (k === "fixtures") continue;
    const desc = Object.getOwnPropertyDescriptor(context, k);
    if (!desc) continue;
    if (!("value" in desc)) {
      throw new StructuralError("ACCESSOR_REJECTED", "input: accessor property rejected on control data (not invoked)");
    }
    out[k] = snapshotData(desc.value);
  }
  // Fixtures stay aliased; the resolver meters each entry before reading.
  const fdesc = Object.getOwnPropertyDescriptor(context, "fixtures");
  if (fdesc && "value" in fdesc) {
    out.fixtures = fdesc.value;
  }
  return out;
}
