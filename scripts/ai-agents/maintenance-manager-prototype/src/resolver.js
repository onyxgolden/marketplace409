/**
 * resolver.js — fixture Git-object resolution, quoted-span verification,
 * read-permission checks and the per-task budget.
 *
 * The resolver independently verifies repo/path at commit resolves to the
 * pinned blob: it recomputes the Git blob SHA-1 using the Git blob header
 * ("blob <len>\0"), never plain SHA-1. A claim's own declared pin is
 * never trusted as truth. Pure Node 24 ESM, zero dependencies.
 *
 * Budget discipline: every candidate object (work orders, PM occurrences,
 * and the trusted context's own registry entries) is charged with
 * countObject() BEFORE the caller inspects any field of that candidate —
 * attempt 65 must refuse before that candidate is touched at all, not
 * merely before a "success" result is returned. The caller (src/index.js,
 * src/contextGuard.js) is responsible for calling countObject() as the
 * very first statement of each loop iteration, before dereferencing
 * anything on that iteration's element. Byte-span checks (asset/work-order
 * citation passages) are charged separately via countSpan().
 */

import { gitBlobId, HEX40 } from "./canonical.js";
import { validateSourceRef, SchemaError } from "./schemas.js";

// Common-contract limits (commands/muse/ai-lab-phase2-slice1-common-contract-2026-10-12.md)
// and this brief's own restated limits (identical values).
export const BUDGET_LIMITS = {
  maxPayloadBytes: 262144, // 256 KiB total UTF-8 data per task
  maxObjects: 64, // candidate objects: fixture sources + work orders + PM occurrences + context registry
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

/** Per-task monotonic budget: every object resolution, span check and
 *  payload byte is charged, incrementally, before inspection. */
export function makeBudget() {
  const used = { objects: 0, spans: 0, payloadBytes: 0 };
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
    countSpan(what) {
      used.spans += 1;
      if (used.spans > BUDGET_LIMITS.maxSpans) {
        throw new BudgetError("BUDGET_EXCEEDED", `span checks exceed ${BUDGET_LIMITS.maxSpans}${what ? ` (at ${what})` : ""}`);
      }
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
  if (typeof rev.text !== "string") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `revision bytes missing for ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)}`);
  }
  const bytes = Buffer.from(rev.text, "utf8");
  budget.countPayload(rev.text, `source ${ref.repo}/${ref.path}`);
  const actualBlob = gitBlobId(bytes);
  if (actualBlob !== ref.blob) {
    throw new ResolutionError("HASH_MISMATCH", `blob mismatch for ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)}: pinned ${ref.blob.slice(0, 12)}… recomputed ${actualBlob.slice(0, 12)}…`);
  }
  return { bytes, text: rev.text };
}

/**
 * Citation builders (MM-S1-002). A citation is a SourceRef plus the
 * verified quoted span, or an explicit UNVERIFIED marker when the span
 * could not be verified. Carrying this into every integrity finding
 * closes the fail-open gap: an out-of-bounds span is never silently
 * treated as if it were verified evidence for a finding.
 */
export function buildVerifiedCitation(ref, spanResult) {
  return {
    repo: ref.repo, path: ref.path, commit: ref.commit, blob: ref.blob, algorithm: ref.algorithm, revision: ref.revision,
    quoted_span: spanResult.quoted_text,
    span: { start_byte: spanResult.start_byte, end_byte: spanResult.end_byte, quoted_text: spanResult.quoted_text },
    verification: "VERIFIED",
  };
}

export function buildUnverifiedCitation(ref, span) {
  return {
    repo: ref.repo, path: ref.path, commit: ref.commit, blob: ref.blob, algorithm: ref.algorithm, revision: ref.revision,
    quoted_span: null,
    span: { start_byte: span.start_byte, end_byte: span.end_byte, quoted_text: null },
    verification: "UNVERIFIED",
  };
}

/** Exact read-grant check: grants are exact repo+path, never prefixes. */
export function hasReadGrant(ref, readGrants) {
  return readGrants.some((g) => g.repo === ref.repo && g.path === ref.path);
}

/**
 * Verify a declared byte span [start_byte, end_byte) actually lies within
 * the resolved content bytes, and return the exact quoted text at that
 * span. Throws ResolutionError (SPAN_MISMATCH) when the span is out of
 * bounds. Charged via countSpan().
 */
export function verifySpanBounds(bytes, span, budget, what) {
  budget.countSpan(what);
  if (span.end_byte > bytes.length) {
    throw new ResolutionError("SPAN_MISMATCH", `span [${span.start_byte},${span.end_byte}) exceeds resolved content length ${bytes.length}`);
  }
  const quoted_text = bytes.slice(span.start_byte, span.end_byte).toString("utf8");
  return { start_byte: span.start_byte, end_byte: span.end_byte, quoted_text };
}

export { HEX40 };
