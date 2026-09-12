// The structurally look-ahead-safe replay entry point (architecture plan §7: "the replay engine
// physically cannot see bars after the current simulated timestamp, not just 'trusted' not to").
//
// adapter.getBars() alone is NOT this guarantee -- a careless caller could pass a future range.end
// and, since every scenario's bars are fully pre-generated (finite, deterministic, all at once),
// there would be nothing stopping it from receiving bars past "now" in the simulation. This cursor
// closes that gap: it captures the full bar array in a closure ONCE, and no method on the returned
// object ever returns that array or a live reference into it -- only a frozen shallow COPY of
// whichever single bar is "current" as of the last advanceTo() call. A consumer holding the cursor
// object has no code path to reach a future bar; this is enforced by what the closure exposes, not
// by a comment asking callers to behave.

export function createLookAheadSafeReplayCursor({ adapter, instrumentId }) {
  // Captured once, in this closure only. Every method below returns data DERIVED from `bars`, never
  // `bars` (or any live reference into it) itself.
  const bars = adapter.getBars(instrumentId, {
    start: "0000-01-01T00:00:00.000Z",
    end: "9999-12-31T23:59:59.999Z",
  });
  let cursorIndex = -1;

  function snapshotAt(index) {
    return index >= 0 && index < bars.length ? Object.freeze({ ...bars[index] }) : null;
  }

  return Object.freeze({
    // Advances the cursor forward (never backward) to the latest bar whose effectiveAt is <= asOf,
    // and returns a frozen copy of it (or null if no bar qualifies yet). Calling this with an asOf
    // that has already been passed is a no-op -- the cursor never rewinds and never re-derives a
    // "future" position from an out-of-order asOf.
    advanceTo(asOf) {
      while (cursorIndex + 1 < bars.length && bars[cursorIndex + 1].effectiveAt <= asOf) {
        cursorIndex += 1;
      }
      return snapshotAt(cursorIndex);
    },
    current() {
      return snapshotAt(cursorIndex);
    },
    hasMoreAfterCurrent() {
      return cursorIndex + 1 < bars.length;
    },
  });
}
