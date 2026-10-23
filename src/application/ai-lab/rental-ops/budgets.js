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
});

/** Hard wall-clock boundary for adapter admission + evaluation. */
export const EXECUTION_BOUNDARY_MS = 5000;
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
    this.used = { candidates: 0, inputBytes: 0, evidenceSpans: 0, outputRecords: 0 };
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
