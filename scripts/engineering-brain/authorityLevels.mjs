// The authority order Jason specified, encoded as ascending rank (0 = highest authority). When two
// records disagree about a fact, the lower-ranked (numerically smaller) one wins -- e.g. a live RLS
// policy always outranks what a lessons-learned doc says about it, and a governance snapshot always
// loses to literally everything above it.
export const AUTHORITY_LEVELS = Object.freeze({
  CURRENT: Object.freeze({ rank: 0, id: "current", label: "Current code, migrations, and tests" }),
  VALIDATION_EVIDENCE: Object.freeze({ rank: 1, id: "validation_evidence", label: "Validation evidence" }),
  GOVERNANCE_STATE: Object.freeze({ rank: 2, id: "governance_state", label: "Current governance state" }),
  SYNCHRONIZED_DOCUMENT: Object.freeze({ rank: 3, id: "synchronized_document", label: "Synchronized documents" }),
  REVIEWED_DECISION: Object.freeze({ rank: 4, id: "reviewed_decision", label: "Reviewed decisions and handoffs" }),
  HISTORICAL_SNAPSHOT: Object.freeze({ rank: 5, id: "historical_snapshot", label: "Historical snapshots" }),
});

export const AUTHORITY_LEVELS_BY_RANK = Object.freeze(
  Object.values(AUTHORITY_LEVELS).sort((a, b) => a.rank - b.rank),
);

export function isKnownAuthorityLevelId(id) {
  return AUTHORITY_LEVELS_BY_RANK.some((level) => level.id === id);
}
