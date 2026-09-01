import { describe, expect, it } from "vitest";
import { compareEventsForReplay, sortEventsForReplay } from "../ledgerOrdering.js";

function ev(id, effectiveDate, ledgerSequence) {
  return { id, effectiveDate, ledgerSequence };
}

describe("compareEventsForReplay / sortEventsForReplay", () => {
  it("orders strictly by effectiveDate when dates differ", () => {
    const a = ev("a", "2026-01-01", 5);
    const b = ev("b", "2026-06-01", 1);
    expect(compareEventsForReplay(a, b)).toBeLessThan(0);
    expect(compareEventsForReplay(b, a)).toBeGreaterThan(0);
  });

  it("breaks a same-effectiveDate tie by ledgerSequence, not by array order", () => {
    const early = ev("early", "2026-03-08", 1);
    const late = ev("late", "2026-03-08", 2);
    expect(sortEventsForReplay([late, early])).toEqual([early, late]);
    expect(sortEventsForReplay([early, late])).toEqual([early, late]);
  });

  it("a manually entered historical payment recorded later still sorts by its ledgerSequence among same-date ties", () => {
    // Two events both effective on the same historical date; the one durably appended (assigned a
    // ledgerSequence) LATER always sorts after the one appended earlier, regardless of which the caller
    // happens to list first.
    const enteredFirst = ev("entered_first", "2022-03-23", 10);
    const enteredLater = ev("entered_later_same_date", "2022-03-23", 47);
    expect(sortEventsForReplay([enteredLater, enteredFirst])).toEqual([enteredFirst, enteredLater]);
  });

  it("a backdated correction sorts into its true chronological position by effectiveDate, ignoring ledgerSequence", () => {
    // The correction is appended (and gets its ledgerSequence) long after the other events, but its
    // effectiveDate is set in the past -- it must replay BEFORE later-dated events despite having the
    // highest ledgerSequence of all three.
    const earlyPayment = ev("early_payment", "2022-04-23", 2);
    const backdatedCorrection = ev("backdated_correction", "2022-03-30", 99);
    const laterPayment = ev("later_payment", "2022-05-23", 3);
    expect(sortEventsForReplay([earlyPayment, laterPayment, backdatedCorrection])).toEqual([backdatedCorrection, earlyPayment, laterPayment]);
  });

  it("two provider events that arrive (and are appended) out of order still replay in effectiveDate order", () => {
    // eventB's real transaction date (per the provider) is EARLIER than eventA's, but eventB happened to
    // arrive/be appended second (higher ledgerSequence) due to network reordering -- replay must not let
    // that arrival order override the true effective date.
    const eventA = ev("eventA_arrived_first", "2026-02-15", 1);
    const eventB = ev("eventB_arrived_second_but_dated_earlier", "2026-01-10", 2);
    expect(sortEventsForReplay([eventA, eventB])).toEqual([eventB, eventA]);
  });

  it("sort result is independent of the input array's original order -- insertion order never accidentally changes the outcome", () => {
    const events = [ev("d", "2026-04-01", 4), ev("a", "2026-01-01", 1), ev("c", "2026-03-01", 3), ev("b", "2026-02-01", 2)];
    const shuffled = [events[2], events[0], events[3], events[1]];
    const expected = [events[1], events[3], events[2], events[0]];
    expect(sortEventsForReplay(events)).toEqual(expected);
    expect(sortEventsForReplay(shuffled)).toEqual(expected);
  });

  it("throws if two distinct events share both effectiveDate and ledgerSequence -- an impossible, corrupt state", () => {
    const a = ev("a", "2026-01-01", 1);
    const b = ev("b", "2026-01-01", 1);
    expect(() => sortEventsForReplay([a, b])).toThrow(/cannot share both/);
  });

  it("returns a frozen array", () => {
    expect(Object.isFrozen(sortEventsForReplay([ev("a", "2026-01-01", 1)]))).toBe(true);
  });

  it("never mutates the input array", () => {
    const events = [ev("b", "2026-02-01", 2), ev("a", "2026-01-01", 1)];
    const copy = [...events];
    sortEventsForReplay(events);
    expect(events).toEqual(copy);
  });
});
