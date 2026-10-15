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
  return {
    countPayload(bytes, label) {
      if (bytes > BUDGET_LIMITS.maxInputBytes) {
        throw new BudgetError("INPUT_LIMIT", `${label} exceeds ${BUDGET_LIMITS.maxInputBytes} bytes`);
      }
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
      return { resolutions, spans };
    },
  };
}
