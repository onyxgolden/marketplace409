import { types } from "node:util";

/**
 * One invocation budget for the rental-ops jobs (brief: "Runtime
 * budgets and deterministic publication"). Every consulted registry,
 * descriptor, input container and domain candidate is charged against
 * the SAME budget instance, BEFORE it is inspected. Boundary behavior:
 * an over-budget candidate dies on the charge alone — the refusal is
 * BUDGET_EXCEEDED and no domain totals are ever produced from a
 * partially inspected population.
 */
export const BUDGET_LIMITS = Object.freeze({
  candidates: 64,
  inputBytes: 256 * 1024,
  depth: 16,
  evidenceSpans: 512,
  outputRecords: 256,
  outputBytes: 256 * 1024,
  /**
   * Control-admission container cap (P666-007A/008A). Host-owned
   * control objects (host config, request, policies, adapter spec)
   * are charged against THIS cap — never against the 64-candidate
   * cap, which governs admitted source containers (pages, rows) and
   * whose calibration the battery pins exactly. Reinterpreting the
   * 64 cap for control data would silently shrink the source
   * budget; a separate named cap keeps both boundaries honest.
   */
  controlContainers: 4096,
});

/** Hard wall-clock boundary for adapter admission + evaluation. */
export const EXECUTION_BOUNDARY_MS = 5000;
/**
 * Separate bounded wait for publication, deliberately OUTSIDE the
 * execution boundary: a publish that does not settle inside this
 * bound fails as PUBLICATION_TIMEOUT (named semantics — the report
 * was computed but not durably published; publication is idempotent,
 * so replaying the same job identity settles the question).
 */
export const PUBLICATION_BOUND_MS = 5000;
/** Bounded wait for a single source page read. */
export const READ_TIMEOUT_MS = 2000;

export class BudgetExceededError extends Error {
  constructor(kind, limit) {
    super(`BUDGET_EXCEEDED:${kind}`);
    this.name = "BudgetExceededError";
    this.code = "BUDGET_EXCEEDED";
    this.kind = kind;
    this.limit = limit;
  }
}

export class ControlDataError extends Error {
  constructor(reason) {
    super(`CONTROL_DATA_REFUSED:${reason}`);
    this.name = "ControlDataError";
    this.code = "CONTROL_DATA_REFUSED";
    this.reason = reason;
  }
}

export class Budget {
  constructor(limits = BUDGET_LIMITS) {
    this.limits = limits;
    this.used = { candidates: 0, inputBytes: 0, evidenceSpans: 0, outputRecords: 0, controlContainers: 0 };
  }

  charge(kind, n = 1) {
    this.used[kind] += n;
    if (this.used[kind] > this.limits[kind]) throw new BudgetExceededError(kind, this.limits[kind]);
  }

  chargeCandidate() { this.charge("candidates"); }
  chargeInputBytes(n) { this.charge("inputBytes", n); }
  chargeEvidenceSpan() { this.charge("evidenceSpans"); }

  /**
   * Measure and charge one candidate container WITHOUT inspecting its
   * field values: Proxies and accessor-bearing structures are refused
   * from property descriptors alone (getters are never invoked), then
   * the serialized UTF-8 size and structural depth are charged.
   * Returns { bytes, depth } for the admitted container.
   */
  measureCandidate(value, what = "candidate") {
    this.chargeCandidate();
    const seen = new Set();
    let maxDepth = 0;
    const walk = (v, depth) => {
      if (depth > maxDepth) maxDepth = depth;
      if (depth > this.limits.depth) throw new BudgetExceededError("depth", this.limits.depth);
      if (v === null || typeof v !== "object") return;
      if (types.isProxy(v)) throw new ControlDataError(`${what}: proxy`);
      if (seen.has(v)) throw new ControlDataError(`${what}: cyclic structure`);
      seen.add(v);
      const proto = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) {
        throw new ControlDataError(`${what}: non-plain object`);
      }
      for (const key of Reflect.ownKeys(v)) {
        const desc = Object.getOwnPropertyDescriptor(v, key);
        if (!desc) continue;
        if ("get" in desc || "set" in desc) throw new ControlDataError(`${what}: accessor property ${String(key)}`);
        walk(desc.value, depth + 1);
      }
    };
    walk(value, 1);
    let text;
    try { text = JSON.stringify(value); } catch { throw new ControlDataError(`${what}: unserializable`); }
    if (typeof text !== "string") throw new ControlDataError(`${what}: unserializable`);
    const bytes = Buffer.byteLength(text, "utf8");
    this.chargeInputBytes(bytes);
    return { bytes, depth: maxDepth };
  }

  /** Charge a finished output envelope against record/byte caps. */
  chargeOutput(records, serializedBytes) {
    this.used.outputRecords += records;
    if (this.used.outputRecords > this.limits.outputRecords) {
      throw new BudgetExceededError("outputRecords", this.limits.outputRecords);
    }
    if (serializedBytes > this.limits.outputBytes) {
      throw new BudgetExceededError("outputBytes", this.limits.outputBytes);
    }
  }
}

/**
 * Admit a caller/host control object (request, host config, policies,
 * adapter spec) under the invocation budget BEFORE any of its fields
 * is read. The walk is ITERATIVE (explicit stack — no recursion, so a
 * deeply nested object can never throw RangeError) and charges
 * incrementally, before each next candidate is admitted:
 *   - depth: each descent past the depth limit refuses
 *     BUDGET_EXCEEDED (a 10,000-deep padding object dies on the
 *     charge, not on the call stack);
 *   - controlContainers: every admitted container charges the
 *     control-container cap (separate from the 64 source-candidate
 *     cap — the battery's source calibration is untouched);
 *   - inputBytes: a lower-bound byte charge (exact key bytes plus
 *     exact primitive-leaf bytes) is taken as each node is visited,
 *     so a wide object is bounded during the walk, not after it.
 * No full prewalk or stringify happens before charging. After the
 * walk, the exact serialized size is reconciled against the
 * incremental charge (the remainder is charged; an over-limit total
 * still refuses exactly).
 *
 * The object's serialized bytes are charged, then it is walked by
 * property DESCRIPTOR only: getters, setters, proxies, cyclic
 * graphs, non-plain prototypes and function-valued fields (including
 * toJSON) refuse with CONTROL_DATA_REFUSED — no accessor is ever
 * invoked and no serialization hook ever runs. The admitted value is
 * a primitive-only deep copy, so nothing downstream (structured
 * clone into the execution worker included) can trigger caller code.
 *
 * This covers the complete admission phase with the advertised
 * bounded execution policy: admission work is finite (depth-,
 * container- and byte-bounded) before the invocation deadline timer
 * is even constructed.
 */
export function admitControlObject(value, what, budget) {
  const seen = new Set();
  let incrementalBytes = 0;
  const chargeBytes = (n) => {
    if (n > 0) {
      incrementalBytes += n;
      budget.chargeInputBytes(n);
    }
  };
  const keyBytes = (key) => {
    // Exact UTF-8 size of the key as JSON will encode it; symbols
    // have no JSON encoding and contribute nothing.
    if (typeof key === "string") return Buffer.byteLength(JSON.stringify(key), "utf8") + 1; // +1 for the colon
    return 0;
  };
  const leafBytes = (v) => {
    if (v === null || v === undefined) return 4; // "null" — undefined serializes to null in arrays / is dropped in objects; 4 is a safe lower bound
    if (typeof v === "string") return Buffer.byteLength(JSON.stringify(v), "utf8");
    if (typeof v === "number" || typeof v === "boolean") return Buffer.byteLength(String(v), "utf8");
    return 0; // bigint and exotic leaves refuse below via JSON
  };
  const checkContainer = (v, path, depth) => {
    if (depth > budget.limits.depth) throw new BudgetExceededError("depth", budget.limits.depth);
    budget.used.controlContainers += 1;
    if (budget.used.controlContainers > budget.limits.controlContainers) {
      throw new BudgetExceededError("controlContainers", budget.limits.controlContainers);
    }
    if (types.isProxy(v)) throw new ControlDataError(`${what}: proxy at ${path}`);
    if (seen.has(v)) throw new ControlDataError(`${what}: cyclic structure at ${path}`);
    seen.add(v);
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) {
      throw new ControlDataError(`${what}: non-plain object at ${path}`);
    }
  };
  // Iterative descriptor walk: the stack holds [value, path, depth].
  // Children are pushed in reverse key order to preserve document
  // order for the (order-irrelevant) copy built by JSON at the end.
  const stack = [[value, what, 1]];
  while (stack.length > 0) {
    const [v, path, depth] = stack.pop();
    if (v === null || v === undefined) { chargeBytes(leafBytes(v)); continue; }
    if (typeof v === "function") {
      throw new ControlDataError(`${what}: function value at ${path}`);
    }
    if (typeof v !== "object") { chargeBytes(leafBytes(v)); continue; }
    checkContainer(v, path, depth);
    chargeBytes(2); // structural lower bound for the container's brackets
    const keys = Reflect.ownKeys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      const desc = Object.getOwnPropertyDescriptor(v, key);
      if (!desc) continue;
      const at = `${path}.${String(key)}`;
      if ("get" in desc || "set" in desc) {
        throw new ControlDataError(`${what}: accessor property at ${at}`);
      }
      chargeBytes(keyBytes(key));
      stack.push([desc.value, at, depth + 1]);
    }
  }
  // The walk above refused every function-valued field, so no toJSON
  // or other serialization hook can run during stringification, and
  // depth is already bounded — stringify cannot throw RangeError.
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw new ControlDataError(`${what}: unserializable`);
  const totalBytes = Buffer.byteLength(text, "utf8");
  budget.chargeInputBytes(Math.max(0, totalBytes - incrementalBytes));
  return JSON.parse(text);
}

/**
 * Count public output records in a finished envelope: every
 * non-array plain-object node (rows, spans, recommendations,
 * escalations, coverage facts, headers). The runner charges this
 * count — not a hand-picked subset of domain rows — so nested
 * evidence/coverage/header records are accounted and 257 public
 * objects refuse at the 256-record cap.
 */
export function countOutputRecords(value) {
  if (value === null || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((a, v) => a + countOutputRecords(v), 0);
  return 1 + Object.values(value).reduce((a, v) => a + countOutputRecords(v), 0);
}
