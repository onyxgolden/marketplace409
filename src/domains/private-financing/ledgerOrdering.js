// Deterministic total order for replaying Private Financing ledger events.
//
// effectiveDate is the ONLY value that determines financial effect -- it is what "backdating" means: an
// event recorded today can carry an effectiveDate in the past (a manually entered historical payment, a
// backdated correction), and replay places it exactly where it belongs chronologically for interest
// accrual and balance purposes, regardless of when it was actually entered into the system.
//
// ledgerSequence is a deliberate, persisted, monotonically increasing integer assigned once, at the
// moment an event is durably appended to the ledger -- never reused, never derived from wall-clock time,
// never re-read from whatever order an array or an unordered database scan happens to produce. It exists
// ONLY to break ties between events that share the same effectiveDate. Two provider events that arrive
// out of order get ledgerSequence values reflecting arrival order, but since effectiveDate is always
// compared first, replay still places them in the correct chronological (effective-date) position --
// ledgerSequence only decides among events that are genuinely tied on the date that actually matters.
//
// This is the intentional resolution of "do not let insertion order accidentally change balances": an
// array shuffled into a different in-memory order, or a database scan without ORDER BY, must never change
// a replay's result. ledgerSequence is not "whatever order happened to come back" -- it is a stored,
// stable, once-assigned value that this function treats identically no matter how the input array is
// ordered when sortEventsForReplay is called (see its test: shuffling the input never changes the sort).
//
// recordedAt (the wall-clock persistence timestamp) is deliberately never read here -- it exists purely
// for audit/display. Letting it influence financial ordering would reintroduce exactly the runtime- and
// timing-dependent nondeterminism ledgerSequence exists to rule out.
export function compareEventsForReplay(a, b) {
  if (a.effectiveDate !== b.effectiveDate) {
    return a.effectiveDate < b.effectiveDate ? -1 : 1;
  }
  if (a.ledgerSequence !== b.ledgerSequence) {
    return a.ledgerSequence < b.ledgerSequence ? -1 : 1;
  }
  throw new Error(
    `Two distinct events ("${a.id}", "${b.id}") cannot share both effectiveDate and ledgerSequence -- ledgerSequence must be unique per account.`,
  );
}

export function sortEventsForReplay(events) {
  return Object.freeze([...events].sort(compareEventsForReplay));
}
