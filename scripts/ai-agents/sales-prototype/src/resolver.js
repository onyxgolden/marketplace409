/**
 * resolver.js — fixture Git-object resolution, quoted-span verification,
 * read-permission checks and the per-task budget.
 *
 * Budget discipline: every candidate object — fixture sources, network
 * records, span checks, AND every element of the injected trusted context
 * (sources, revisions, read grants, principal, criteria) — is charged with
 * countObject()/countSpan() BEFORE the caller inspects any field of that
 * candidate. Attempt 65 (or span 513) refuses before that candidate is
 * touched at all. validateContext() in schemas.js applies the same
 * discipline to the context population; it requires the caller's live
 * budget and must never be called without one.
 */

import { gitBlobId, HEX40 } from "./canonical.js";
import { validateSourceRef, SchemaError } from "./schemas.js";

export const BUDGET_LIMITS = {
  maxPayloadBytes: 262144, // 256 KiB total UTF-8 data per task
  maxObjects: 64, // candidate objects: fixture sources + network records + criteria entries
  maxSpans: 512, // evidence span checks
  maxOutputRecords: 256, // output records
  maxOutputBytes: 262144, // 256 KiB output
};

export class BudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BudgetError";
    this.code = code;
  }
}

export class ResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResolutionError";
    this.code = code;
  }
}

/**
 * S653-005: exact canonical-serialized UTF-8 byte measurement — the single
 * serialized representation for the invocation-wide input budget. Counts
 * structure (braces/brackets/colons/commas), property names WITH JSON
 * quoting/escaping, string values WITH escaping (quotes, backslashes,
 * NUL/Unicode -> \uXXXX), and numbers/booleans in their JSON form.
 *
 * S653-005 (fix round 3): EVERY serialized occurrence is charged. A
 * shared reference aliased N times in the structure is emitted N times by
 * JSON, so it is measured N times here. The old whole-walk WeakSet dedup
 * refunded repeated occurrences and let aliased input bypass the cap.
 * Cycle rejection uses the ancestor path only: an object that is its own
 * ancestor is a genuine cycle (not JSON-serializable) and refuses; a
 * shared DAG reference is measured once per occurrence. Measurement
 * throws BudgetError INPUT_LIMIT partway when the cap would be exceeded,
 * so oversized input is refused DURING measurement (bounded before full
 * allocation) — this also bounds the walk on adversarial sharing.
 *
 * This is deliberately different from the once-per-selected-source-byte
 * convention: selected source BYTES (bundle text) are charged exactly once
 * in resolveSourceRef. Repeated METADATA references in the structure are
 * charged per emitted occurrence, matching the actual serialized bytes.
 *
 * For plain JSON data without aliases this equals canonicalByteLength()
 * exactly; the unit tests assert that equivalence.
 */
export function serializedByteLength(value, limit = Number.MAX_SAFE_INTEGER) {
  let total = 0;
  const bump = (n) => {
    total += n;
    if (total > limit) {
      throw new BudgetError(
        "INPUT_LIMIT",
        `serialized input exceeds the invocation-wide ${BUDGET_LIMITS.maxPayloadBytes}-byte cap`
      );
    }
  };
  const strBytes = (s) => Buffer.byteLength(JSON.stringify(s), "utf8");
  const walk = (v, ancestors, depth) => {
    if (depth > 32) {
      throw new BudgetError("INPUT_LIMIT", "serialized measurement exceeded depth 32");
    }
    if (v === null) { bump(4); return; } // "null"
    const t = typeof v;
    if (t === "string") { bump(strBytes(v)); return; }
    if (t === "number") {
      if (!Number.isFinite(v)) throw new BudgetError("INPUT_LIMIT", "nonfinite number is not serializable");
      bump(strBytes(v));
      return;
    }
    if (t === "boolean") { bump(v ? 4 : 5); return; }
    if (t === "bigint") { bump(strBytes(`{"$bigint":"${v.toString()}"}`)); return; }
    if (t !== "object") return; // undefined/function/symbol: not JSON-serializable; schemas reject these
    // Ancestor-path cycle rejection: only a true cycle refuses. A shared
    // reference reached via a different path is measured again — JSON
    // emits it again.
    if (ancestors.has(v)) {
      throw new BudgetError("INPUT_LIMIT", "cyclic input is not JSON-serializable; refusing");
    }
    ancestors.add(v);
    try {
      if (Array.isArray(v)) {
        bump(2); // []
        for (let i = 0; i < v.length; i++) {
          if (i > 0) bump(1); // comma
          if (v[i] === undefined) bump(4); // JSON.stringify -> null
          else walk(v[i], ancestors, depth + 1);
        }
        return;
      }
      bump(2); // {}
      let first = true;
      for (const k of Object.keys(v)) {
        const child = v[k];
        if (child === undefined) continue; // JSON.stringify drops undefined-valued keys
        if (!first) bump(1); // comma
        first = false;
        bump(strBytes(k) + 1); // "key":
        walk(child, ancestors, depth + 1);
      }
    } finally {
      ancestors.delete(v);
    }
  };
  walk(value, new Set(), 0);
  return total;
}

/** Per-task monotonic budget: every object resolution, span check and
 *  payload byte is charged, incrementally, before inspection. */
export function makeBudget() {
  const used = { objects: 0, spans: 0, payloadBytes: 0 };
  // S648-006: idempotent object charging. The budget-integrated admission
  // walk and the schema validators share one monotonic counter; each
  // distinct object is charged exactly once no matter how many times it
  // is visited. The WeakSet never invokes user code.
  const chargedObjects = new WeakSet();
  return {
    used,
    countPayload(bytes, what) {
      used.payloadBytes += Buffer.byteLength(bytes, "utf8");
      if (used.payloadBytes > BUDGET_LIMITS.maxPayloadBytes) {
        throw new BudgetError("INPUT_LIMIT", `${what ?? "payload"} exceeds ${BUDGET_LIMITS.maxPayloadBytes} bytes`);
      }
    },
    countObject(what) {
      used.objects += 1;
      if (used.objects > BUDGET_LIMITS.maxObjects) {
        throw new BudgetError("BUDGET_EXCEEDED", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}${what ? ` (at ${what})` : ""}`);
      }
    },
    /**
     * S648-006: charge a distinct object once. The FIRST call for a given
     * object identity increments the counter (and refuses at #65); later
     * calls for the same identity are free. This lets the admission walk
     * and the validators share one counter without double-counting.
     * Primitives are never charged.
     */
    chargeObjectOnce(obj, what) {
      if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) return;
      if (chargedObjects.has(obj)) return;
      chargedObjects.add(obj);
      used.objects += 1;
      if (used.objects > BUDGET_LIMITS.maxObjects) {
        throw new BudgetError("BUDGET_EXCEEDED", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}${what ? ` (at ${what})` : ""}`);
      }
    },
    countSpan(what) {
      used.spans += 1;
      if (used.spans > BUDGET_LIMITS.maxSpans) {
        throw new BudgetError("BUDGET_EXCEEDED", `span checks exceed ${BUDGET_LIMITS.maxSpans}${what ? ` (at ${what})` : ""}`);
      }
    },
    /**
     * S653-005: charge the exact canonical-serialized UTF-8 size of a
     * value against the single invocation-wide input budget. The
     * measurement throws INPUT_LIMIT partway when the cap would be
     * exceeded, so oversized input is refused before full allocation.
     * S653-005 (fix round 3): every serialized occurrence is charged —
     * shared references are measured once per occurrence, matching the
     * emitted bytes. Selected source bytes keep their own once-only
     * convention via countPayload in resolveSourceRef.
     */
    chargeSerialized(value, what) {
      const remaining = BUDGET_LIMITS.maxPayloadBytes - used.payloadBytes;
      const n = serializedByteLength(value, remaining);
      used.payloadBytes += n;
    },
  };
}

function sourceKeyOf(ref) {
  return `${ref.repo}|${ref.path}`;
}

/**
 * Resolve a SourceRef through the fixture Git object store. Verifies the
 * source key is registered, the commit is a registered revision, and the
 * recomputed Git blob ID equals the pinned blob. Returns {bytes, text}.
 * Throws ResolutionError (SOURCE_UNVERIFIED / HASH_MISMATCH).
 */
export function resolveSourceRef(ref, sources, budget, what) {
  budget.countObject(what);
  try {
    validateSourceRef(ref, "source pin");
  } catch (e) {
    if (e instanceof SchemaError) throw new ResolutionError("SOURCE_UNVERIFIED", `pin failed validation: ${e.message}`);
    throw e;
  }
  const key = sourceKeyOf(ref);
  const entry = sources[key];
  if (!entry || typeof entry !== "object") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `source key not registered: ${ref.repo}/${ref.path}`);
  }
  const revisions = entry.revisions;
  if (!revisions || typeof revisions !== "object") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `no revisions registered for ${ref.repo}/${ref.path}`);
  }
  const rev = revisions[ref.commit];
  if (!rev || typeof rev !== "object") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `commit ${ref.commit} not registered for ${ref.repo}/${ref.path}`);
  }
  // S648A-002: bind every declared source-identity field. The revision
  // label declared in the task must match the host-registered label for
  // this commit; a fabricated revision on a real commit is tuple spoofing.
  if (rev.label !== ref.revision) {
    throw new ResolutionError("SOURCE_UNVERIFIED", `revision label '${ref.revision}' does not match registered label for ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)}`);
  }
  if (typeof rev.text !== "string") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `revision bytes missing for ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)}`);
  }
  const bytes = Buffer.from(rev.text, "utf8");
  // S653-005: the selected revision's raw bytes are charged EXACTLY ONCE
  // here. Callers must not re-charge the bundle text or per-record slices
  // (they are byte ranges of these same bytes).
  budget.countPayload(rev.text, `source ${ref.repo}/${ref.path}`);
  const actualBlob = gitBlobId(bytes);
  // S653-002: bind the full consumed tuple to the HOST registration. The
  // recomputed bytes must match BOTH the task pin AND the host-registered
  // blob; a disagreement with the registered immutable tuple fails closed.
  if (actualBlob !== rev.blob) {
    throw new ResolutionError("HASH_MISMATCH", `blob mismatch for ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)}: recomputed ${actualBlob.slice(0, 12)}… disagrees with the HOST-REGISTERED blob ${String(rev.blob).slice(0, 12)}…; failing closed`);
  }
  if (actualBlob !== ref.blob) {
    throw new ResolutionError("HASH_MISMATCH", `blob mismatch for ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)}: pinned ${ref.blob.slice(0, 12)}… recomputed ${actualBlob.slice(0, 12)}…`);
  }
  // S648A-003: host-established population, bound to the resolved source
  // identity. Undefined when the host declares no expected count (unknown
  // coverage — never verified complete).
  const expected_records = rev.expected_records;
  // S653-001: host-registered dataset identity travels with the resolved
  // source so population declarations can bind to it.
  // S653-001 (fix round 2): the host-declared coverage contract (report
  // period applicability) travels with it as well.
  return { bytes, text: rev.text, expected_records, dataset_id: rev.dataset_id, dataset_version: rev.dataset_version, coverage: rev.coverage };
}

/** Exact read-grant check: grants are exact repo+path, never prefixes. */
export function hasReadGrant(ref, readGrants) {
  return readGrants.some((g) => g.repo === ref.repo && g.path === ref.path);
}

/**
 * Locate a quoted span by exact byte search in the source bytes.
 * Returns {start_byte, end_byte, quoted_text}. Throws ResolutionError
 * (SPAN_MISMATCH) when the quoted text is not found exactly.
 */
export function verifySpan(bytes, quotedSpan, budget, what) {
  budget.countSpan(what);
  if (typeof quotedSpan !== "string" || quotedSpan.length === 0) {
    throw new ResolutionError("SPAN_MISMATCH", "quoted span must be a non-empty string");
  }
  const needle = Buffer.from(quotedSpan, "utf8");
  const start = bytes.indexOf(needle);
  if (start < 0) {
    throw new ResolutionError("SPAN_MISMATCH", "quoted span not found exactly in source bytes");
  }
  const end = start + needle.length;
  const slice = bytes.subarray(start, end).toString("utf8");
  if (slice !== quotedSpan) {
    throw new ResolutionError("SPAN_MISMATCH", "quoted span splits a UTF-8 sequence");
  }
  return { start_byte: start, end_byte: end, quoted_text: quotedSpan };
}

export { HEX40 };
