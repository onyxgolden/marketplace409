import { describe, expect, it, vi } from "vitest";

vi.mock("@/application/rental/executeAutopayAttempt", () => ({ executeAutopayAttempt: vi.fn() }));
vi.mock("../settlement-reconciliation/route.js", () => ({
  reconcileMissingStripeSettlements: vi.fn(),
}));

import {
  acquireSweepClaim,
  releaseSweepClaim,
  RENTAL_AUTOPAY_SWEEP_NAME,
} from "./sweepRunner.js";

// In-memory fake of the supabase query-builder subset used by the claim
// functions. JavaScript is single-threaded, so each method body runs
// atomically -- exactly what we need to prove the claim logic admits only
// one owner even when two callers race.
function fakeClaimsDb(seedRows = []) {
  const rows = new Map();
  const key = (name, date) => `${name}|${date}`;
  for (const r of seedRows) rows.set(key(r.sweep_name, r.sweep_date), { ...r });

  const matches = (row, filters) => filters.every(([c, v]) => row[c] === v);

  return {
    __rows: rows, // test seam: lets a test age a claim to simulate staleness
    from() {
      const filters = [];
      const self = {
        _mode: null,
        _patch: null,
        insert: async (row) => {
          const kk = key(row.sweep_name, row.sweep_date);
          if (rows.has(kk)) {
            const err = new Error('duplicate key value violates unique constraint "rental_sweep_claims_pkey"');
            err.code = "23505";
            return { data: null, error: err };
          }
          rows.set(kk, { ...row });
          return { data: [row], error: null };
        },
        select: () => {
          if (self._mode !== "update") self._mode = "select";
          return self;
        },
        update: (patch) => { self._mode = "update"; self._patch = patch; return self; },
        eq: (col, val) => { filters.push([col, val]); return self; },
        single: async () => {
          const found = [...rows.values()].find((r) => matches(r, filters));
          return found ? { data: { ...found }, error: null } : { data: null, error: new Error("no rows") };
        },
        then: (resolve) => {
          if (self._mode === "update") {
            const out = [];
            for (const [kk, r] of rows) {
              if (matches(r, filters)) {
                const next = { ...r, ...self._patch };
                rows.set(kk, next);
                out.push(next);
              }
            }
            resolve({ data: out, error: null });
          } else {
            resolve({ data: [], error: null });
          }
        },
      };
      return self;
    },
  };
}

const TODAY = "2026-10-06";
const NAME = RENTAL_AUTOPAY_SWEEP_NAME;

describe("acquireSweepClaim", () => {
  it("grants the claim to the first caller", async () => {
    const db = fakeClaimsDb();
    const r = await acquireSweepClaim(db, NAME, TODAY, "schedule");
    expect(r.acquired).toBe(true);
    expect(r.reclaimed).toBe(false);
  });

  it("two simultaneous callers cannot both own the sweep", async () => {
    const db = fakeClaimsDb();
    const [a, b] = await Promise.all([
      acquireSweepClaim(db, NAME, TODAY, "schedule"),
      acquireSweepClaim(db, NAME, TODAY, "watchdog"),
    ]);
    expect([a.acquired, b.acquired].filter(Boolean)).toHaveLength(1);
    const loser = a.acquired ? b : a;
    expect(loser.acquired).toBe(false);
    expect(loser.reason).toBe("in-progress");
  });

  it("does not grant a second claim after the sweep completed", async () => {
    const db = fakeClaimsDb();
    const first = await acquireSweepClaim(db, NAME, TODAY, "schedule");
    await releaseSweepClaim(db, NAME, TODAY, "completed", "schedule", first.claimToken);
    const r = await acquireSweepClaim(db, NAME, TODAY, "watchdog");
    expect(r.acquired).toBe(false);
    expect(r.reason).toBe("already-completed");
  });

  it("a failed run is explicitly retryable via atomic reclaim", async () => {
    const db = fakeClaimsDb();
    const first = await acquireSweepClaim(db, NAME, TODAY, "schedule");
    await releaseSweepClaim(db, NAME, TODAY, "failed", "schedule", first.claimToken);
    const r = await acquireSweepClaim(db, NAME, TODAY, "watchdog");
    expect(r.acquired).toBe(true);
    expect(r.reclaimed).toBe(true);
    expect(r.previousStatus).toBe("failed");
  });

  it("reclaims a stale claim left by a dead runner", async () => {
    const staleAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const db = fakeClaimsDb([{
      sweep_name: NAME, sweep_date: TODAY, status: "claimed",
      claimed_by: "schedule", claimed_at: staleAt, attempts: 1,
    }]);
    const r = await acquireSweepClaim(db, NAME, TODAY, "watchdog", 30);
    expect(r.acquired).toBe(true);
    expect(r.reclaimed).toBe(true);
    expect(r.previousStatus).toBe("claimed");
  });

  it("does not reclaim a fresh in-progress claim", async () => {
    const db = fakeClaimsDb();
    await acquireSweepClaim(db, NAME, TODAY, "schedule");
    const r = await acquireSweepClaim(db, NAME, TODAY, "watchdog", 30);
    expect(r.acquired).toBe(false);
    expect(r.reason).toBe("in-progress");
    expect(r.owner).toBe("schedule");
  });

  it("only one simultaneous reclaimer wins when a failed claim is raced", async () => {
    const db = fakeClaimsDb();
    const first = await acquireSweepClaim(db, NAME, TODAY, "schedule");
    await releaseSweepClaim(db, NAME, TODAY, "failed", "schedule", first.claimToken);
    const [a, b] = await Promise.all([
      acquireSweepClaim(db, NAME, TODAY, "watchdog"),
      acquireSweepClaim(db, NAME, TODAY, "manual"),
    ]);
    expect([a.acquired, b.acquired].filter(Boolean)).toHaveLength(1);
  });

  it("two simultaneous reclaimers of a STALE claim cannot both win (claim-token CAS)", async () => {
    // Regression test for the exact bug ChatGPT caught: predicating the
    // reclaim UPDATE on status alone is not a safe CAS, because reclaiming
    // a stale 'claimed' row writes status='claimed' right back -- a second
    // racer's status predicate still matches after the first racer wins.
    // The claimed_at token must change on a winning swap.
    const staleAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const db = fakeClaimsDb([{
      sweep_name: NAME, sweep_date: TODAY, status: "claimed",
      claimed_by: "schedule", claimed_at: staleAt, attempts: 1,
    }]);
    const [a, b] = await Promise.all([
      acquireSweepClaim(db, NAME, TODAY, "watchdog", 30),
      acquireSweepClaim(db, NAME, TODAY, "manual", 30),
    ]);
    const winners = [a, b].filter((r) => r.acquired);
    expect(winners).toHaveLength(1);
    expect(winners[0].reclaimed).toBe(true);
    expect(winners[0].previousStatus).toBe("claimed");
  });

  it("only the claim owner can release the claim", async () => {    const db = fakeClaimsDb();
    const first = await acquireSweepClaim(db, NAME, TODAY, "schedule");
    const r = await releaseSweepClaim(db, NAME, TODAY, "completed", "watchdog", first.claimToken);
    expect(r.released).toBe(false);
    // the owner's claim is untouched: a new acquire still sees in-progress
    const retry = await acquireSweepClaim(db, NAME, TODAY, "watchdog", 30);
    expect(retry.acquired).toBe(false);
    expect(retry.reason).toBe("in-progress");
  });

  it("a stalled watchdog cannot release a newer watchdog's reclaimed claim", async () => {
    // Regression for the exact hole ChatGPT caught: two successive
    // watchdog invocations share claimed_by='watchdog', so fencing release
    // on claimed_by alone lets a stalled old watchdog release the newer
    // runner's claim. The claimed_at token must be required on release.
    const db = fakeClaimsDb();
    const old = await acquireSweepClaim(db, NAME, TODAY, "watchdog", 30);
    expect(old.acquired).toBe(true);
    // time passes: the old watchdog's claim goes stale (dead runner)
    db.__rows.get(`${NAME}|${TODAY}`).claimed_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const fresh = await acquireSweepClaim(db, NAME, TODAY, "watchdog", 30);
    expect(fresh.acquired).toBe(true);
    expect(fresh.reclaimed).toBe(true);
    // the stalled old watchdog wakes up and tries to release with its own
    // (correct owner, STALE token) credentials: must not match
    const r = await releaseSweepClaim(db, NAME, TODAY, "completed", "watchdog", old.claimToken);
    expect(r.released).toBe(false);
    // the newer runner's claim is intact and still in progress
    const retry = await acquireSweepClaim(db, NAME, TODAY, "watchdog", 30);
    expect(retry.acquired).toBe(false);
    expect(retry.reason).toBe("in-progress");
    // the newer runner CAN release with its own token
    const ok = await releaseSweepClaim(db, NAME, TODAY, "completed", "watchdog", fresh.claimToken);
    expect(ok.released).toBe(true);
  });
  it("propagates non-unique-violation database errors instead of silently continuing", async () => {
    const db = { from: () => ({ insert: async () => ({ error: new Error("connection reset") }) }) };
    await expect(acquireSweepClaim(db, NAME, TODAY, "schedule")).rejects.toThrow("connection reset");
  });
});
