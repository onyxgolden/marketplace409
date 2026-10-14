// Migration contract test for
// 20261013225000_auth_rate_limit_buckets.sql, executed against an
// in-process Postgres (PGlite). Exercises the real auth_admission_check
// RPC: multi-bucket atomic evaluation, token reservation before allowed,
// operation_id idempotency (replays never double-consume), failure
// backoff escalation and MFA-success clearing, unavailable-on-bad-input
// (fail closed), TTL pruning, and the service-role-only RLS posture.
// No linked/remote database touched.
//
// The migration is PREPARED for review only; applying it to production
// Supabase is Jason's separate explicit authorization.
//
// NOTE: PGlite is single-session, so the "100 concurrent requests cannot
// exceed available tokens" gate from the brief must run against real
// migrated Postgres in staging (see the runbook). What PGlite proves
// here is the single-transaction atomicity the concurrency gate rests
// on: evaluation, reservation, and verdict publication are inseparable.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_SQL = readFileSync(
  new URL("../20261013225000_auth_rate_limit_buckets.sql", import.meta.url),
  "utf8",
);

let db;

const LIMITS_2_60 = JSON.stringify([
  { capacity: 2, window_seconds: 60 },
  { capacity: 100, window_seconds: 60 },
]);

async function admit({ action = "signin", keys, limits = LIMITS_2_60, op, now = null }) {
  const { rows } = await db.query(
    `select * from public.auth_admission_check($1, $2::text[], $3::jsonb, $4, $5)`,
    [action, keys, limits, op, now],
  );
  return rows[0];
}

async function recordOutcome(op, outcome, accountKey = null) {
  const { rows } = await db.query(
    `select public.auth_record_attempt_outcome($1, $2, $3) as recorded`,
    [op, outcome, accountKey],
  );
  return rows[0].recorded;
}

async function bucketTokens(key) {
  const { rows } = await db.query(
    `select tokens from public.auth_rate_limit_buckets where bucket_key = $1`,
    [key],
  );
  return rows.length ? rows[0].tokens : null;
}

beforeAll(async () => {
  db = new PGlite();
  // PGlite has no Supabase roles; create them so the migration's
  // revoke/grant statements resolve (production Supabase always has them).
  await db.exec(
    `do $$
     begin
       if not exists (select 1 from pg_roles where rolname = 'anon') then
         create role anon nologin;
       end if;
       if not exists (select 1 from pg_roles where rolname = 'authenticated') then
         create role authenticated nologin;
       end if;
       if not exists (select 1 from pg_roles where rolname = 'service_role') then
         create role service_role nologin;
       end if;
     end $$;`,
  );
  await db.exec(MIGRATION_SQL);
  // Re-runnable: second apply must not error and must not touch rows.
  await db.exec(MIGRATION_SQL);
});

describe("rate-limit bucket migration", () => {
  it("creates the tables, RPCs, and enables RLS with a service-role-only policy", async () => {
    const { rows } = await db.query(
      `select tablename from pg_tables
        where schemaname = 'public'
          and tablename in ('auth_rate_limit_buckets','auth_operation_log','auth_backoff_clears')`,
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([
      "auth_backoff_clears",
      "auth_operation_log",
      "auth_rate_limit_buckets",
    ]);

    const rls = await db.query(
      `select relname from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('auth_rate_limit_buckets','auth_operation_log','auth_backoff_clears')
          and relrowsecurity`,
    );
    expect(rls.rows).toHaveLength(3);

    const pol = await db.query(
      `select tablename from pg_policies
        where schemaname = 'public' and policyname = 'service_role_full_access'`,
    );
    expect(pol.rows.map((r) => r.tablename).sort()).toEqual([
      "auth_backoff_clears",
      "auth_operation_log",
      "auth_rate_limit_buckets",
    ]);

    const fns = await db.query(
      `select proname from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('auth_admission_check','auth_record_attempt_outcome')`,
    );
    expect(fns.rows.map((r) => r.proname).sort()).toEqual([
      "auth_admission_check",
      "auth_record_attempt_outcome",
    ]);
  });

  it("denies table access to anon/authenticated and RPC execution to client roles", async () => {
    for (const t of ["auth_rate_limit_buckets", "auth_operation_log", "auth_backoff_clears"]) {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await db.query(
          `select has_table_privilege($1, $2, 'select') as p`,
          [role, `public.${t}`],
        );
        expect(rows[0].p).toBe(false);
      }
      const { rows } = await db.query(
        `select has_table_privilege('service_role', $1, 'select, insert, update, delete') as p`,
        [`public.${t}`],
      );
      expect(rows[0].p).toBe(true);
    }
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query(
        `select has_function_privilege($1, 'public.auth_admission_check(text,text[],jsonb,text,timestamptz)', 'execute') as p`,
        [role],
      );
      expect(rows[0].p).toBe(false);
    }
    const { rows } = await db.query(
      `select has_function_privilege('service_role', 'public.auth_admission_check(text,text[],jsonb,text,timestamptz)', 'execute') as p`,
    );
    expect(rows[0].p).toBe(true);
  });

  it("admits while tokens remain and reserves each admission atomically", async () => {
    const keys = ["t1:acct:a", "t1:ip:1"];
    const r1 = await admit({ keys, op: "op-t1-1" });
    expect(r1).toMatchObject({ allowed: true, unavailable: false, backoff_seconds: 0 });
    // One token reserved; sub-millisecond refill between calls adds only
    // a tiny epsilon, so tolerances are loose by design.
    expect(await bucketTokens("t1:acct:a")).toBeCloseTo(1, 1);

    const r2 = await admit({ keys, op: "op-t1-2" });
    expect(r2.allowed).toBe(true);
    expect(await bucketTokens("t1:acct:a")).toBeLessThan(0.05);
  });

  it("denies when any bucket is exhausted and reports retry_after", async () => {
    const keys = ["t2:acct:a", "t2:ip:1"];
    await admit({ keys, op: "op-t2-1" });
    await admit({ keys, op: "op-t2-2" });
    const r3 = await admit({ keys, op: "op-t2-3" });
    expect(r3.allowed).toBe(false);
    expect(r3.unavailable).toBe(false);
    expect(r3.retry_after_seconds).toBeGreaterThan(0);
    // A denied attempt consumes nothing further: the balance only moved
    // by sub-millisecond refill between the two calls.
    expect(await bucketTokens("t2:acct:a")).toBeLessThan(0.01);
  });

  it("refills buckets on the server clock", async () => {
    const keys = ["t3:acct:a"];
    const limits = JSON.stringify([{ capacity: 1, window_seconds: 60 }]);
    const base = new Date("2026-10-13T22:50:00Z");
    const r1 = await admit({ keys, limits, op: "op-t3-1", now: base.toISOString() });
    expect(r1.allowed).toBe(true);
    const r2 = await admit({ keys, limits, op: "op-t3-2", now: base.toISOString() });
    expect(r2.allowed).toBe(false);
    // 61s later the 60s window has fully refilled one token.
    const later = new Date(base.getTime() + 61_000).toISOString();
    const r3 = await admit({ keys, limits, op: "op-t3-3", now: later });
    expect(r3.allowed).toBe(true);
  });

  it("replays a retried operation_id without consuming tokens twice", async () => {
    const keys = ["t4:acct:a"];
    const limits = JSON.stringify([{ capacity: 1, window_seconds: 600 }]);
    const first = await admit({ keys, limits, op: "op-t4-dup" });
    expect(first.allowed).toBe(true);

    const replay = await admit({ keys, limits, op: "op-t4-dup" });
    expect(replay.allowed).toBe(true);

    // If the replay had consumed again, the bucket would be empty and a
    // fresh operation would be denied; it must still see the single
    // original reservation only.
    const probe = await admit({ keys, limits, op: "op-t4-probe" });
    expect(probe.allowed).toBe(false);
    expect(await bucketTokens("t4:acct:a")).toBeCloseTo(0, 5);
  });

  it("escalates backoff on failures and clears it on MFA success", async () => {
    const action = "signin-bk";
    const keys = ["bk:acct:u1", "bk:ip:9"];
    const limits = JSON.stringify([
      { capacity: 100, window_seconds: 300 },
      { capacity: 1000, window_seconds: 300 },
    ]);

    // Two failed credential attempts against the same account key.
    const a1 = await admit({ action, keys, op: "op-bk-1", limits });
    expect(a1.backoff_seconds).toBe(0);
    expect(await recordOutcome("op-bk-1", "credential_failed", "bk:acct:u1")).toBe(true);

    const a2 = await admit({ action, keys, op: "op-bk-2", limits });
    expect(a2.backoff_seconds).toBe(2);
    expect(await recordOutcome("op-bk-2", "credential_failed", "bk:acct:u1")).toBe(true);

    const a3 = await admit({ action, keys, op: "op-bk-3", limits });
    expect(a3.backoff_seconds).toBe(4);

    // Successful MFA clears the account's failure backoff...
    expect(await recordOutcome("op-bk-3", "mfa_succeeded", "bk:acct:u1")).toBe(true);
    const a4 = await admit({ action, keys, op: "op-bk-4", limits });
    expect(a4.backoff_seconds).toBe(0);

    // A failure on a fully DISJOINT key set counts nothing for this
    // account. (Failures sharing only the IP key DO contribute to
    // backoff by design -- advisory, capped at 60s, decaying after
    // 15 quiet minutes; hard enforcement lives in the token buckets.)
    const b1 = await admit({
      action, keys: ["bk:acct:u2", "bk:ip:other"], op: "op-bk-5", limits,
    });
    expect(b1.backoff_seconds).toBe(0);
  });

  it("treats outcome recording as idempotent and forward-only", async () => {
    const keys = ["t5:acct:a"];
    await admit({ keys, op: "op-t5-1" });
    expect(await recordOutcome("op-t5-1", "credential_failed")).toBe(true);
    // Replay of the same outcome is idempotent.
    expect(await recordOutcome("op-t5-1", "credential_failed")).toBe(true);
    // A different terminal outcome never overwrites the first.
    expect(await recordOutcome("op-t5-1", "credential_succeeded")).toBe(false);
    // Unknown operation records nothing.
    expect(await recordOutcome("op-t5-nope", "credential_failed")).toBe(false);
    // Invalid outcome never throws; it records nothing.
    expect(await recordOutcome("op-t5-1", "bogus")).toBe(false);
  });

  it("fails closed (unavailable) on malformed input instead of throwing", async () => {
    const badKeys = await admit({ keys: [], op: "op-bad-1" });
    expect(badKeys).toMatchObject({ allowed: false, unavailable: true });

    const misaligned = await admit({
      keys: ["x:a", "x:b"],
      limits: JSON.stringify([{ capacity: 1, window_seconds: 60 }]),
      op: "op-bad-2",
    });
    expect(misaligned.unavailable).toBe(true);

    const badLimit = await admit({
      keys: ["x:c"],
      limits: JSON.stringify([{ capacity: 0, window_seconds: 60 }]),
      op: "op-bad-3",
    });
    expect(badLimit).toMatchObject({ allowed: false, unavailable: true });
  });

  it("prunes buckets idle longer than the TTL bound", async () => {
    const keys = ["t6:acct:stale"];
    const limits = JSON.stringify([{ capacity: 5, window_seconds: 300 }]);
    await admit({ keys, limits, op: "op-t6-1" });
    expect(await bucketTokens("t6:acct:stale")).not.toBeNull();

    // Age the bucket 25h into the past, then trigger the in-path prune.
    await db.query(
      `update public.auth_rate_limit_buckets
          set last_refill = now() - interval '25 hours'
        where bucket_key = 't6:acct:stale'`,
    );
    await admit({ keys: ["t6:acct:other"], limits, op: "op-t6-2" });
    expect(await bucketTokens("t6:acct:stale")).toBeNull();
  });
});
