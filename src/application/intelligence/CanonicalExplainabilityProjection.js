export class CanonicalExplainabilityProjection {
  static project({
    context = {},
    ledger = null,
  } = {}) {
    return Object.freeze({
      type: "canonical-explainability-context",
      ledgerContext: Object.freeze({
        ledger,
      }),
      provenance: Object.freeze({
        ...(context.provenance || {}),
      }),
    });
  }
}

Object.freeze(CanonicalExplainabilityProjection);
