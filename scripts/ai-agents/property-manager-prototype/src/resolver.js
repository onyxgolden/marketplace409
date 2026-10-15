/**
 * resolver.js — budget model for the property-manager prototype.
 *
 * Per the common contract: 256 KiB total input, 64 source objects,
 * 512 evidence spans, 256 output records, 256 KiB output. No context
 * operation beyond 64 object resolutions + 512 span checks; budget
 * exhaustion -> BUDGET_EXCEEDED / INPUT_LIMIT / OUTPUT_LIMIT and no
 * partial success.
 */

export const BUDGET_LIMITS = {
  maxInputBytes: 256 * 1024,
  maxSourceObjects: 64,
  maxEvidenceSpans: 512,
  maxOutputRecords: 256,
  maxOutputBytes: 256 * 1024,
  maxObjectResolutions: 64,
  maxSpanChecks: 512,
};

export class BudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BudgetError";
    this.code = code;
  }
}

export function makeBudget() {
  let resolutions = 0;
  let spans = 0;
  let inputBytes = 0;
  const sources = [];
  const seenSourceKeys = new Set();
  return {
    countPayload(bytes, label) {
      if (bytes > BUDGET_LIMITS.maxInputBytes) {
        throw new BudgetError("INPUT_LIMIT", `${label} exceeds ${BUDGET_LIMITS.maxInputBytes} bytes`);
      }
    },
    /**
     * Cumulative input byte budget (PM-004): charges the exact bytes of
     * every consulted input (task envelope, resolved case, notes,
     * permission and trust records). Throws INPUT_LIMIT when the running
     * total exceeds the 256 KiB contract cap.
     */
    countInputBytes(bytes, label) {
      if (!Number.isFinite(bytes) || bytes < 0) {
        throw new BudgetError("INPUT_LIMIT", `${label}: invalid byte count`);
      }
      if (inputBytes + bytes > BUDGET_LIMITS.maxInputBytes) {
        throw new BudgetError("INPUT_LIMIT", `${label} pushes consulted input over ${BUDGET_LIMITS.maxInputBytes} bytes`);
      }
      inputBytes += bytes;
    },
    /**
     * Source ledger (PM-005): records a consulted source reference with
     * the exact bytes it pins, for deterministic emission in the result
     * envelope. Deduplicated by repo/path/commit/blob.
     */
    addSource(ref, bytes) {
      if (!ref || typeof ref.blob !== "string") return;
      const key = `${ref.repo}|${ref.path}|${ref.commit}|${ref.blob}`;
      if (seenSourceKeys.has(key)) return;
      seenSourceKeys.add(key);
      sources.push({ ref: { ...ref }, bytes: bytes ? Buffer.from(bytes) : null });
    },
    /** Revalidate every ledgered source by recomputing its blob. Throws on mismatch. */
    revalidateSources(gitBlobId) {
      for (const { ref, bytes } of sources) {
        if (!bytes) {
          throw new BudgetError("SOURCE_UNVERIFIED", `consulted source ${ref.path} has no pinned bytes to revalidate`);
        }
        if (gitBlobId(bytes) !== ref.blob) {
          throw new BudgetError("SOURCE_UNVERIFIED", `consulted source ${ref.path} failed revalidation at emission`);
        }
      }
    },
    sourceRefs() {
      return sources
        .map(({ ref }) => ({ ...ref }))
        .sort((a, b) => {
          const ka = `${a.repo}|${a.path}|${a.commit}|${a.blob}`;
          const kb = `${b.repo}|${b.path}|${b.commit}|${b.blob}`;
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
    },
    countResolution(label) {
      resolutions += 1;
      if (resolutions > BUDGET_LIMITS.maxObjectResolutions) {
        throw new BudgetError("BUDGET_EXCEEDED", `object resolution budget exceeded at ${label}`);
      }
    },
    countSpan(label) {
      spans += 1;
      if (spans > BUDGET_LIMITS.maxEvidenceSpans || spans > BUDGET_LIMITS.maxSpanChecks) {
        throw new BudgetError("BUDGET_EXCEEDED", `evidence span budget exceeded at ${label}`);
      }
    },
    get used() {
      return { resolutions, spans, inputBytes, sources: sources.length };
    },
  };
}
