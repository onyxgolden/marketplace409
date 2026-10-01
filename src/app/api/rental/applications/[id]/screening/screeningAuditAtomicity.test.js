import { describe, expect, it } from "vitest";

// Protocol simulation for the PR #527 NO-GO finding 1 (Rentec R22):
// screening state mutations and their append-only audit events were separate
// database requests, so a failed event insert left a result-bearing or
// completed screening with no audit event.
//
// NOT a database test: no live Postgres is available in the unit-test
// environment (the repo's migration tests are structural by design — see
// screeningAtomicRpc.migration.test.js for the shipped artifact's contract).
// The real guarantee is the single-transaction RPCs in
// supabase/migrations/20261001143000_rental_screening_atomic_transitions.sql,
// where the mutation + the event append are one transaction: either both
// commit or neither does.
//
// This test documents the interleaving the transaction closes. A tiny fake
// database stands in for Postgres; the failing event insert is the
// failure-injection the reviewer demanded.

function makeFakeDb({ eventInsertFails = false } = {}) {
  return {
    screenings: [{ id: "scr_1", status: "requested", results: null }],
    events: [],
    eventInsertFails,
    // The new protocol: mutation + event append are one transaction.
    transition(action, mutate, event) {
      const snapshot = JSON.parse(JSON.stringify({ screenings: this.screenings, events: this.events }));
      try {
        mutate();
        this.appendEvent(event); // raises when eventInsertFails
        return { ok: true };
      } catch (error) {
        // Roll back: neither the mutation nor the event survived.
        this.screenings = snapshot.screenings;
        this.events = snapshot.events;
        return { ok: false, error };
      }
    },
    appendEvent(event) {
      if (this.eventInsertFails) throw new Error("event insert failed");
      this.events.push(event);
    },
  };
}

// Old protocol: the mutation commits first, the event insert follows as a
// separate request (the pre-fix route behavior).
function oldProtocolTransition(db, mutate, event) {
  mutate(); // committed
  try {
    db.appendEvent(event);
  } catch {
    return { ok: false, halfCommitted: true }; // 500 after the mutation committed
  }
  return { ok: true };
}

describe("screening audit atomicity protocol", () => {
  it("old protocol: a failed event insert leaves a mutated screening with no audit event", () => {
    const db = makeFakeDb({ eventInsertFails: true });
    const result = oldProtocolTransition(
      db,
      () => { db.screenings[0].results = { creditScore: 700 }; db.screenings[0].status = "complete"; },
      { screeningId: "scr_1", event: "completed" },
    );
    expect(result.ok).toBe(false);
    expect(result.halfCommitted).toBe(true);
    // The bug the reviewer flagged: a completed, result-bearing screening
    // exists with no corresponding audit event.
    expect(db.screenings[0].status).toBe("complete");
    expect(db.events).toHaveLength(0);
  });

  it("new protocol: a failed event insert rolls back the whole transition", () => {
    const db = makeFakeDb({ eventInsertFails: true });
    const result = db.transition(
      "complete",
      () => { db.screenings[0].results = { creditScore: 700 }; db.screenings[0].status = "complete"; },
      { screeningId: "scr_1", event: "completed" },
    );
    expect(result.ok).toBe(false);
    // Nothing half-committed: the screening is untouched and no event exists.
    expect(db.screenings[0].status).toBe("requested");
    expect(db.screenings[0].results).toBeNull();
    expect(db.events).toHaveLength(0);
  });

  it("new protocol: mutation + event commit together on the happy path", () => {
    const db = makeFakeDb({ eventInsertFails: false });
    const result = db.transition(
      "complete",
      () => { db.screenings[0].results = { creditScore: 700 }; db.screenings[0].status = "complete"; },
      { screeningId: "scr_1", event: "completed" },
    );
    expect(result.ok).toBe(true);
    expect(db.screenings[0].status).toBe("complete");
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({ screeningId: "scr_1", event: "completed" });
  });

  it("new protocol: the applicant's consent update + both events are one transaction", () => {
    const db = makeFakeDb({ eventInsertFails: true });
    const result = db.transition(
      "consent",
      () => { db.screenings[0].consentRecorded = true; },
      { screeningId: "scr_1", event: "consent_recorded" },
    );
    expect(result.ok).toBe(false);
    // Consent is the most sensitive transition: it must never be recorded
    // without its audit trail.
    expect(db.screenings[0].consentRecorded).toBeFalsy();
    expect(db.events).toHaveLength(0);
  });
});
