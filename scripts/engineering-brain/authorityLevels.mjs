// The authority order, encoded as ascending rank (0 = highest authority). When two records disagree
// about a fact, the lower-ranked (numerically smaller) one wins -- e.g. a live RLS policy always
// outranks what a lessons-learned doc says about it, and a governance snapshot always loses to
// literally everything above it.
//
// CANONICAL_DOCUMENT (rank 4) is the registered product/architecture owner documents (see
// canonicalDocumentRegistry.mjs). It records product INTENT: it governs what FORGE should be, but it
// does not prove implementation truth, which stays with CURRENT and VALIDATION_EVIDENCE. It sits
// below synchronized documents, so existing FORGE_SYNC ordering is unchanged, and above reviewed
// decisions and historical snapshots, so bootstrap and continuity material can never outrank it.
export const AUTHORITY_LEVELS = Object.freeze({
  CURRENT: Object.freeze({ rank: 0, id: "current", label: "Current code, migrations, and tests" }),
  VALIDATION_EVIDENCE: Object.freeze({ rank: 1, id: "validation_evidence", label: "Validation evidence" }),
  GOVERNANCE_STATE: Object.freeze({ rank: 2, id: "governance_state", label: "Current governance state" }),
  SYNCHRONIZED_DOCUMENT: Object.freeze({ rank: 3, id: "synchronized_document", label: "Synchronized documents" }),
  CANONICAL_DOCUMENT: Object.freeze({ rank: 4, id: "canonical_document", label: "Canonical product and architecture documents (intent)" }),
  REVIEWED_DECISION: Object.freeze({ rank: 5, id: "reviewed_decision", label: "Reviewed decisions and handoffs" }),
  HISTORICAL_SNAPSHOT: Object.freeze({ rank: 6, id: "historical_snapshot", label: "Historical snapshots and bootstrap continuity" }),
});

export const AUTHORITY_LEVELS_BY_RANK = Object.freeze(
  Object.values(AUTHORITY_LEVELS).sort((a, b) => a.rank - b.rank),
);

export function isKnownAuthorityLevelId(id) {
  return AUTHORITY_LEVELS_BY_RANK.some((level) => level.id === id);
}
