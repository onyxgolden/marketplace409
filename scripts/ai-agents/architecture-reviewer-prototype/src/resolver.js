/**
 * resolver.js — scoped bounded fixture resolver for the
 * architecture-reviewer prototype.
 *
 * The resolver binds a design_ref to actual bytes from the separately
 * injected fixture store, independently recomputes the Git blob SHA-1
 * (blob <len>\0 + bytes), and never trusts a supplied blob label alone.
 * base_pin must name the same repo/commit the design was pinned at.
 * Every consulted object and returned UTF-8 payload is counted against
 * the prototype caps: exhaustion yields a named refusal, never partial
 * success.
 */

import { gitBlobSha1Utf8 } from "./canonical.js";

export const BUDGET_LIMITS = {
  maxTotalDataBytes: 262144, // 256 KiB total UTF-8 data per task
  maxObjects: 64,
  maxSpans: 512,
  maxOutputRecords: 256,
  maxOutputBytes: 262144, // 256 KiB final envelope
};

export class BudgetError extends Error {
  constructor(code, reason) {
    super(reason);
    this.name = "BudgetError";
    this.code = code;
  }
}

export function designKey(ref) {
  return `${ref.repo}\0${ref.path}\0${ref.commit}`;
}

/**
 * Make a budget counter. countObject() charges one object resolution;
 * countPayload(bytes) charges UTF-8 payload bytes; countSpan() charges
 * one span check. Throws BudgetError on exhaustion.
 */
export function makeBudget() {
  const b = { objects: 0, dataBytes: 0, spans: 0 };
  return {
    get counts() {
      return b;
    },
    countObject() {
      b.objects += 1;
      if (b.objects > BUDGET_LIMITS.maxObjects) throw new BudgetError("BUDGET_EXCEEDED", `object resolutions exceed ${BUDGET_LIMITS.maxObjects}`);
    },
    countPayload(bytes) {
      const n = typeof bytes === "number" ? bytes : Buffer.byteLength(bytes, "utf8");
      b.dataBytes += n;
      if (b.dataBytes > BUDGET_LIMITS.maxTotalDataBytes) throw new BudgetError("INPUT_LIMIT", `consulted UTF-8 payload exceeds ${BUDGET_LIMITS.maxTotalDataBytes} bytes`);
    },
    countSpan() {
      b.spans += 1;
      if (b.spans > BUDGET_LIMITS.maxSpans) throw new BudgetError("BUDGET_EXCEEDED", `span checks exceed ${BUDGET_LIMITS.maxSpans}`);
    },
  };
}

/**
 * Resolve a design_ref through the injected fixture store.
 * Returns { bytes } or throws a ResolutionError with a contract code.
 */
export class ResolutionError extends Error {
  constructor(code, reason) {
    super(reason);
    this.name = "ResolutionError";
    this.code = code;
  }
}

export function resolveDesign(designRef, basePin, context, budget) {
  if (designRef.repo !== basePin.repo || designRef.commit !== basePin.commit) {
    throw new ResolutionError("TARGET_MISMATCH", "design_ref repo/commit does not match base_pin (wrong base)");
  }
  const store = context && context.designs;
  if (!store || typeof store !== "object") {
    throw new ResolutionError("EVIDENCE_UNREACHABLE", "no design fixture store in context");
  }
  const key = designKey(designRef);
  budget.countObject();
  const entry = store[key];
  if (entry === undefined) {
    throw new ResolutionError("EVIDENCE_UNREACHABLE", "design source not present in fixture store");
  }
  if (entry && entry.denied === true) {
    throw new ResolutionError("READ_DENIED", "design source read denied by fixture grant");
  }
  const bytes = typeof entry === "string" ? entry : entry.bytes;
  if (typeof bytes !== "string") {
    throw new ResolutionError("EVIDENCE_UNREACHABLE", "design fixture entry has no bytes");
  }
  budget.countPayload(bytes);
  const recomputed = gitBlobSha1Utf8(bytes);
  if (recomputed !== designRef.blob) {
    throw new ResolutionError("HASH_MISMATCH", "recomputed Git blob SHA-1 does not match the design_ref pin");
  }
  return { bytes };
}

/**
 * Verify an evidence span against resolved design bytes: the exact UTF-8
 * slice must equal quoted_text. Charges one span check.
 */
export function verifySpan(bytes, span, budget) {
  budget.countSpan();
  const buf = Buffer.from(bytes, "utf8");
  if (span.end_byte > buf.length) return { ok: false, code: "SPAN_MISMATCH", reason: "span end_byte beyond design bytes" };
  const slice = buf.subarray(span.start_byte, span.end_byte).toString("utf8");
  if (slice !== span.quoted_text) return { ok: false, code: "SPAN_MISMATCH", reason: "span quoted_text does not equal the exact UTF-8 slice" };
  return { ok: true };
}
