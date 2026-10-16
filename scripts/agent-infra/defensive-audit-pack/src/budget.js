/**
 * budget.js — admission bounds and candidate charging for the audit pack.
 * Original code. Pure Node 24 ESM, no imports.
 *
 * Bounds (per the slice-1 scope):
 *   - 64 consulted candidates (each inspected config entry is charged BEFORE read)
 *   - 256 KiB admitted input bytes
 *   - JSON nesting depth 16 (byte-level structural scan, before JSON.parse)
 *   - 5 s watchdog (wall clock; injectable clock for tests)
 *
 * Own-property reads only: `ownRead` never invokes getters and never walks
 * prototypes, so a throwing accessor planted in a synthetic export cannot
 * fire and over-budget candidates are never touched.
 */

export const MAX_CANDIDATES = 64;
export const MAX_ADMIT_BYTES = 256 * 1024;
export const MAX_DEPTH = 16;
export const WATCHDOG_MS = 5000;

export class BudgetExceeded extends Error {
  constructor(kind, detail) {
    super(`BUDGET_EXCEEDED:${kind}:${detail}`);
    this.name = "BudgetExceeded";
    this.kind = kind;
  }
}

export class WatchdogExceeded extends Error {
  constructor() {
    super("WATCHDOG_EXCEEDED:5s");
    this.name = "WatchdogExceeded";
  }
}

/** Closed-schema / admission violation. `code` selects the refusal reason. */
export class SchemaError extends Error {
  constructor(code, detail) {
    super(`SCHEMA:${code}:${detail}`);
    this.name = "SchemaError";
    this.code = code;
  }
}

function accessorError(where) {
  return new SchemaError("accessor", `accessor property at ${where} rejected without invocation`);
}

/**
 * Unified bounded admission: deep-copies a programmatic value through own
 * data descriptors only. This is the ONE admission contract shared by the
 * string entrypoint (after JSON.parse) and the object entrypoint.
 *
 * - the budget is charged BEFORE each key/index candidate is inspected;
 *   the first candidate over the limit refuses without touching it
 * - nesting depth is capped at MAX_DEPTH (root counts as 1, matching the
 *   byte-level scanJsonDepth used on the string path)
 * - admitted bytes are estimated (keys + string leaves + fixed per-value
 *   cost) and capped at MAX_ADMIT_BYTES
 * - accessors are rejected WITHOUT invocation (getOwnPropertyDescriptor
 *   never fires a getter); array indices are read only via their own data
 *   descriptor, never by indexed access or iteration first
 * - cyclic graphs are rejected
 *
 * Throws BudgetExceeded or SchemaError. Returns a plain-data deep copy.
 */
export function admitDocument(value, budget, opts = {}) {
  const label = opts.label || "admission";
  const seen = new Set();
  let bytes = 0;
  const chargeBytes = (n, path) => {
    bytes += n;
    if (bytes > MAX_ADMIT_BYTES) {
      throw new BudgetExceeded("bytes", `${label}: ${path} pushes admitted bytes over ${MAX_ADMIT_BYTES}`);
    }
  };
  function walk(v, depth, path) {
    if (v === null || typeof v !== "object") {
      if (typeof v === "string") chargeBytes(Buffer.byteLength(v, "utf8"), path);
      else if (typeof v === "number") chargeBytes(8, path);
      else chargeBytes(4, path);
      return v;
    }
    if (depth > MAX_DEPTH) {
      throw new BudgetExceeded("depth", `${label}: ${path} depth ${depth} exceeds ${MAX_DEPTH}`);
    }
    if (seen.has(v)) {
      throw new SchemaError("cycle", `${label}: ${path} object graph must be acyclic`);
    }
    seen.add(v);
    chargeBytes(2, path);
    let out;
    if (Array.isArray(v)) {
      out = new Array(v.length);
      for (let i = 0; i < v.length; i++) {
        budget.charge(`${label}:${path}[${i}]`);
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (d && !("value" in d)) throw accessorError(`${path}[${i}]`);
        out[i] = walk(d ? d.value : undefined, depth + 1, `${path}[${i}]`);
      }
    } else {
      out = {};
      for (const k of Object.keys(v)) {
        chargeBytes(Buffer.byteLength(k, "utf8"), `${path}.${k}`);
        budget.charge(`${label}:${path}.${k}`);
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (!d) continue;
        if (!("value" in d)) throw accessorError(`${path}.${k}`);
        out[k] = walk(d.value, depth + 1, `${path}.${k}`);
      }
    }
    seen.delete(v);
    return out;
  }
  return walk(value, 1, "$");
}

/**
 * Byte-level JSON nesting-depth scanner. Walks raw UTF-8 text and tracks
 * container depth from structural characters only ({ } [ ]), skipping
 * string literals (with escape handling). Never decodes or interprets a
 * candidate's fields. Throws BudgetExceeded on depth > MAX_DEPTH.
 * Returns the maximum depth observed.
 */
export function scanJsonDepth(text) {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth++;
      if (depth > max) max = depth;
      if (depth > MAX_DEPTH) throw new BudgetExceeded("depth", `depth ${depth} > ${MAX_DEPTH}`);
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth < 0) throw new BudgetExceeded("depth", "unbalanced containers");
    }
  }
  if (inString) throw new BudgetExceeded("depth", "unterminated string");
  return max;
}

/** Admit raw input text: byte budget first. Returns the text unchanged. */
export function admitBytes(text) {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_ADMIT_BYTES) {
    throw new BudgetExceeded("bytes", `${bytes} > ${MAX_ADMIT_BYTES}`);
  }
  return text;
}

/**
 * Candidate budget: every consulted config entry is charged BEFORE it is
 * read. The first candidate over the limit refuses without touching it.
 */
export class CandidateBudget {
  constructor(limit = MAX_CANDIDATES) {
    this.limit = limit;
    this.used = 0;
  }
  /** Charge one candidate. Throws BudgetExceeded before the limit is exceeded. */
  charge(label) {
    if (this.used >= this.limit) {
      throw new BudgetExceeded("candidates", `candidate ${this.used + 1} (${label}) over limit ${this.limit}`);
    }
    this.used += 1;
  }
}

/**
 * Own-property read. Returns {present, value}. Never invokes a getter:
 * value is taken from the own data descriptor only. Never walks the
 * prototype chain.
 */
export function ownRead(obj, key) {
  if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) {
    return { present: false, value: undefined };
  }
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (!d || !("value" in d)) return { present: false, value: undefined };
  return { present: true, value: d.value };
}

/** Own enumerable string keys of an object (no prototype keys). */
export function ownKeys(obj) {
  if (obj === null || typeof obj !== "object") return [];
  return Object.keys(obj);
}

/**
 * Watchdog: throws WatchdogExceeded when the injected clock passes the
 * deadline. `now` defaults to Date.now; tests inject a fake clock.
 */
export class Watchdog {
  constructor(ms = WATCHDOG_MS, now = Date.now) {
    this.deadline = now() + ms;
    this.now = now;
  }
  check() {
    if (this.now() > this.deadline) throw new WatchdogExceeded();
  }
}
