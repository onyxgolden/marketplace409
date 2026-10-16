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
 * on unterminated strings. Escape-aware: \" \\ \/ \b \f \n \r \t \uXXXX.
 */
function scanString(bytes, i) {
  let j = i + 1;
  while (j < bytes.length) {
    const c = bytes[j];
    if (c === 0x5c) {
      // backslash: skip the escaped char (\" etc.)
      if (bytes[j + 1] === 0x75) j += 6; // \uXXXX
      else j += 2;
      continue;
    }
    if (c === 0x22) return j + 1;
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
  for (;;) {
    i = skipWs(bytes, i);
    if (bytes[i] === 0x7d) {
      i += 1;
      break;
    }
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
      for (;;) {
        i = skipWs(bytes, i);
        if (bytes[i] === 0x5d) {
          i += 1;
          break;
        }
        const start = i;
        const end = skipValue(bytes, i, 2); // elements live at depth 2
        rowSpans.push([start, end]);
        i = skipWs(bytes, end);
        if (bytes[i] === 0x2c) {
          i += 1;
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
    if (bytes[i] === 0x2c) {
      i += 1;
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
