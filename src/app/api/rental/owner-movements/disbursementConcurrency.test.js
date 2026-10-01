import { describe, expect, it } from "vitest";

// Protocol simulation for the PR #514 GO WITH FIXES item (Rentec R9).
//
// NOT a database test: no live Postgres is available in the unit-test
// environment (the repo's migration tests are structural by design — see
// ownerDisbursementRpc.migration.test.js for the shipped artifact's contract).
// The real guarantee is pg_advisory_xact_lock in
// supabase/migrations/20261001013000_owner_disbursement_atomic_rpc.sql, which
// makes the balance-recompute + invariant-check + insert sequence mutually
// exclusive per effective owner inside one database transaction.
//
// This test documents the interleaving the lock closes. It runs both
// protocols against a fake ledger, with a tiny async mutex standing in for
// the advisory lock:
//   * check-then-act (the old route behavior): both requests read the same
//     balance before either writes, so both succeed and the owner ends up
//     over-disbursed — the bug the reviewer flagged.
//   * lock-then-check-then-act (record_owner_disbursement): the loser
//     recomputes after the winner's insert committed, so exactly one succeeds
//     and the invariant holds.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// A minimal async mutex: queued callbacks run one at a time, in order.
function makeMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}

function makeLedger(balanceCents) {
  return {
    balanceCents,
    disbursedCents: 0,
    // "Recompute the live balance": income less active disbursements.
    liveBalance() {
      return this.balanceCents - this.disbursedCents;
    },
  };
}

// Old protocol: read, yield so the competitor reads too, then check + write.
async function oldProtocolDisburse(ledger, amountCents, barrier) {
  const read = ledger.liveBalance();
  await barrier();
  if (amountCents > read) return { ok: false };
  ledger.disbursedCents += amountCents;
  return { ok: true };
}

// New protocol: hold the lock across read + check + write.
async function newProtocolDisburse(ledger, withLock, amountCents) {
  return withLock(async () => {
    const read = ledger.liveBalance();
    await tick(); // yielding while the lock is held is safe: nobody else
    // can enter the critical section until this callback resolves.
    if (amountCents > read) return { ok: false };
    ledger.disbursedCents += amountCents;
    return { ok: true };
  });
}

describe("disbursement concurrency protocol", () => {
  it("check-then-act without a lock lets two competing disbursements both succeed", async () => {
    const ledger = makeLedger(160000);
    let readers = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const barrier = async () => {
      readers += 1;
      if (readers === 2) release();
      await gate;
    };
    const [a, b] = await Promise.all([
      oldProtocolDisburse(ledger, 160000, barrier),
      oldProtocolDisburse(ledger, 160000, barrier),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Both read 160000 before either wrote: the owner is over-disbursed.
    expect(ledger.disbursedCents).toBe(320000);
  });

  it("lock-then-check-then-act lets exactly one of two competing disbursements succeed", async () => {
    const ledger = makeLedger(160000);
    const withLock = makeMutex();
    const [a, b] = await Promise.all([
      newProtocolDisburse(ledger, withLock, 160000),
      newProtocolDisburse(ledger, withLock, 160000),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(ledger.disbursedCents).toBe(160000);
  });

  it("the lock does not block a disbursement that fits after a smaller one", async () => {
    const ledger = makeLedger(160000);
    const withLock = makeMutex();
    const [a, b] = await Promise.all([
      newProtocolDisburse(ledger, withLock, 60000),
      newProtocolDisburse(ledger, withLock, 60000),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(ledger.disbursedCents).toBe(120000);
  });
});
