// Migration contract + atomicity test for
// 20261013000000_scheduled_send_ledger_atomic_attempt.sql, executed
// against an in-process Postgres (PGlite). Applies the base ledger
// migration, the RDL-002A/B + 004A/B follow-up, and the atomic-attempt
// migration, then exercises the real record_rental_send_attempt function:
// token fencing, atomic ordinal allocation under concurrency, legacy
// null-token semantics, idempotent re-records, the uniqueness backstop,
// and RDL-004A.3 replay safety (a second application never rewrites
// authoritative ordinals). No linked/remote database touched.
//
// The migration is PREPARED for review only; applying it to production
// Supabase is Jason's separate explicit authorization.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { authoritativeLatestAttempts } from "../../../src/application/notifications/scheduledSendLedger.js";

const BASE_SQL = readFileSync(
  new URL("../20261012000000_scheduled_send_ledger.sql", import.meta.url),
  "utf8",
);
const FOLLOWUP_SQL = readFileSync(
  new URL("../20261012000100_scheduled_send_ledger_rdl2_followup.sql", import.meta.url),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  new URL("../20261013000000_scheduled_send_ledger_atomic_attempt.sql", import.meta.url),
  "utf8",
);

let db;

async function seedLedgerRow({ claimToken = "tok_A" } = {}) {
  const id = randomUUID();
  const { rows } = await db.query(
    `insert into scheduled_send_ledger
       (id, schedule_name, scheduled_slot, recipient_allowlist_id, run_id, state,
        send_attempts, claim_token, summary_version)
     values ($1::uuid, 'tenant_invite', '2026-10-13', 'allow_' || $1,
             'run_1', 'claimed', 1, $2, 0)
     returning id, claim_token`,
    [id, claimToken],
  );
  return rows[0];
}

async function recordAttempt(ledgerId, overrides = {}) {
  const { rows } = await db.query(
    `select record_rental_send_attempt(
       $1::uuid, $2, $3, $4, $5, $6, $7
     ) as result`,
    [
      ledgerId,
      overrides.deliveryId ?? "del_1",
      overrides.state ?? "provider_failed",
      overrides.providerMessageId ?? null,
      overrides.failureReason ?? "boom",
      overrides.runId ?? "run_1",
      overrides.claimToken ?? "tok_A",
    ],
  );
  return rows[0].result;
}

async function attemptCount(ledgerId, deliveryId = "del_1") {
  const { rows } = await db.query(
    `select count(*)::int as n from scheduled_send_attempts
      where ledger_id = $1::uuid and delivery_id = $2`,
    [ledgerId, deliveryId],
  );
  return rows[0].n;
}

beforeAll(async () => {
  db = new PGlite();
  // PGlite ships without pgcrypto: stub gen_random_uuid() so the base
  // migration's column default resolves. The default itself is not under
  // test.
  await db.exec(
    `create or replace function gen_random_uuid() returns uuid language sql as
     $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;`,
  );
  await db.exec(BASE_SQL);
  await db.exec(FOLLOWUP_SQL);
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
  // Re-runnable: second apply must not error.
  await db.exec(MIGRATION_SQL);
});

describe("atomic attempt migration", () => {
  it("adds the unique ordinal constraint and backfills pre-existing rows", async () => {
    const { rows } = await db.query(
      `select conname from pg_constraint
        where conname = 'scheduled_send_attempts_ordinal_unique'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("records under the current token with ordinal 1, then 2", async () => {
    const ledger = await seedLedgerRow();
    const first = await recordAttempt(ledger.id, { claimToken: "tok_A" });
    expect(first.recorded).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.attempt_ordinal).toBe(1);
    expect(first.attempt.claim_token).toBe("tok_A");
    const second = await recordAttempt(ledger.id, {
      claimToken: "tok_A",
      state: "provider_accepted",
      providerMessageId: "msg_1",
      failureReason: null,
    });
    expect(second.recorded).toBe(true);
    expect(second.attempt_ordinal).toBe(2);
  });

  it("RDL-004A.1: a token rotation refuses the stale generation with zero appends", async () => {
    const ledger = await seedLedgerRow();
    const before = await recordAttempt(ledger.id, { claimToken: "tok_A" });
    expect(before.recorded).toBe(true);
    // Takeover rotates the generation.
    await db.query(
      `update scheduled_send_ledger set claim_token = 'tok_B', run_id = 'run_2'
        where id = $1::uuid`,
      [ledger.id],
    );
    // The stale worker's recording -- however late -- is refused, because
    // the function verifies the CURRENT token inside the same locked
    // operation as the insert: no check-then-insert gap exists.
    const stale = await recordAttempt(ledger.id, {
      claimToken: "tok_A",
      state: "provider_accepted",
      providerMessageId: "msg_stale",
      failureReason: null,
      runId: "run_1",
    });
    expect(stale.recorded).toBe(false);
    expect(stale.reason).toBe("stale_claim_token");
    expect(await attemptCount(ledger.id)).toBe(1);
    // The new generation records normally.
    const fresh = await recordAttempt(ledger.id, {
      claimToken: "tok_B",
      state: "provider_accepted",
      providerMessageId: "msg_2",
      failureReason: null,
      runId: "run_2",
    });
    expect(fresh.recorded).toBe(true);
    expect(fresh.attempt_ordinal).toBe(2);
    expect(fresh.attempt.claim_token).toBe("tok_B");
  });

  it("RDL-004A.2: concurrent recordings get distinct ordinals, never a shared max+1", async () => {
    const ledger = await seedLedgerRow();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        recordAttempt(ledger.id, {
          claimToken: "tok_A",
          runId: `run_${i}`,
          failureReason: `boom-${i}`,
        }),
      ),
    );
    for (const r of results) expect(r.recorded).toBe(true);
    const ordinals = results.map((r) => r.attempt_ordinal).sort((a, b) => a - b);
    expect(ordinals).toEqual([1, 2, 3, 4, 5]);
    expect(await attemptCount(ledger.id)).toBe(5);
  });

  it("an identical re-record returns the existing attempt as duplicate, appending nothing", async () => {
    const ledger = await seedLedgerRow();
    const args = {
      claimToken: "tok_A",
      state: "provider_accepted",
      providerMessageId: "msg_1",
      failureReason: null,
      runId: "run_1",
    };
    const first = await recordAttempt(ledger.id, args);
    expect(first.recorded).toBe(true);
    expect(first.duplicate).toBe(false);
    const retry = await recordAttempt(ledger.id, args);
    expect(retry.recorded).toBe(true);
    expect(retry.duplicate).toBe(true);
    expect(retry.attempt.id).toBe(first.attempt.id);
    expect(retry.attempt_ordinal).toBe(1);
    expect(await attemptCount(ledger.id)).toBe(1);
    // Genuine new evidence (different outcome) mints a fresh ordinal.
    const next = await recordAttempt(ledger.id, {
      ...args,
      state: "provider_failed",
      providerMessageId: null,
      failureReason: "late failure",
    });
    expect(next.recorded).toBe(true);
    expect(next.duplicate).toBe(false);
    expect(next.attempt_ordinal).toBe(2);
  });

  it("legacy null-token rows are explicitly accepted without generation fencing", async () => {
    const ledger = await seedLedgerRow({ claimToken: null });
    const rec = await recordAttempt(ledger.id, { claimToken: "whatever" });
    expect(rec.recorded).toBe(true);
    expect(rec.attempt_ordinal).toBe(1);
    expect(rec.attempt.claim_token).toBeNull();
  });

  it("refuses a missing ledger row and rejects invalid states", async () => {
    const missing = await recordAttempt("00000000-0000-0000-0000-000000000000", {
      claimToken: "tok_A",
    });
    expect(missing.recorded).toBe(false);
    expect(missing.reason).toBe("no_ledger_row");
    const ledger = await seedLedgerRow();
    await expect(
      db.query(`select record_rental_send_attempt($1::uuid, 'del_1', 'claimed', null, null, null, 'tok_A')`, [
        ledger.id,
      ]),
    ).rejects.toThrow();
    expect(await attemptCount(ledger.id)).toBe(0);
  });

  it("restricts execute to the service role", async () => {
    const { rows } = await db.query(
      `select grantee, privilege_type from information_schema.role_routine_grants
        where routine_name = 'record_rental_send_attempt'`,
    );
    const grants = new Map(rows.map((r) => [r.grantee, r.privilege_type]));
    expect(grants.get("service_role")).toBe("EXECUTE");
    expect(grants.has("anon")).toBe(false);
    expect(grants.has("authenticated")).toBe(false);
  });

  it("RDL-004A.3: replaying the migration leaves authoritative rows byte-for-byte unchanged", async () => {
    const ledger = await seedLedgerRow();
    // Seed two attempts whose ORDINAL order deliberately differs from
    // attempted_at,id order: the authoritative latest (ordinal 2) is the
    // FAILED row even though it looks "older" by wall clock and id.
    // (The PGlite gen_random_uuid stub is constant, so ids are explicit.)
    const firstId = randomUUID();
    const secondId = randomUUID();
    await db.query(
      `insert into scheduled_send_attempts
         (id, ledger_id, delivery_id, state, provider_message_id, run_id,
          claim_token, attempt_ordinal, attempted_at)
       values
         ($1::uuid, $3::uuid, 'del_1', 'provider_accepted', 'msg_1', 'run_1',
          'tok_A', 1, '2026-10-13T12:00:00Z'),
         ($2::uuid, $3::uuid, 'del_1', 'provider_failed', null, 'run_2',
          'tok_A', 2, '2026-10-13T11:00:00Z')`,
      [firstId, secondId, ledger.id],
    );
    const snapshot = async () => {
      const { rows } = await db.query(
        `select id, ledger_id, delivery_id, state, attempt_ordinal
           from scheduled_send_attempts
          where ledger_id = $1::uuid
          order by id`,
        [ledger.id],
      );
      return rows;
    };
    const derivedLatestId = (rows) => {
      const latest = [...authoritativeLatestAttempts(rows).values()];
      expect(latest).toHaveLength(1);
      return latest[0].id;
    };
    const before = await snapshot();
    expect(derivedLatestId(before)).toBe(secondId);

    // Replay the migration: must succeed and change nothing.
    await db.exec(MIGRATION_SQL);

    const after = await snapshot();
    expect(after).toEqual(before);
    expect(derivedLatestId(after)).toBe(secondId);
  });
});

describe("atomic attempt migration: initial install backfill (RDL-004A.3)", () => {
  let installDb;

  beforeAll(async () => {
    installDb = new PGlite();
    await installDb.exec(
      `create or replace function gen_random_uuid() returns uuid language sql as
       $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;`,
    );
    await installDb.exec(BASE_SQL);
    await installDb.exec(FOLLOWUP_SQL);
    await installDb.exec(
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
    // Legacy pre-atomic rows: duplicate zero ordinals within del_1.
    const ledgerId = randomUUID();
    await installDb.query(
      `insert into scheduled_send_ledger
         (id, schedule_name, scheduled_slot, recipient_allowlist_id, state)
       values ($1::uuid, 'tenant_invite', '2026-10-13', 'legacy_r1', 'claimed')`,
      [ledgerId],
    );
    await installDb.query(
      `insert into scheduled_send_attempts
         (id, ledger_id, delivery_id, state, attempt_ordinal, attempted_at)
       values
         ($1::uuid, $4::uuid, 'del_1', 'provider_failed', 0, '2026-10-12T10:00:00Z'),
         ($2::uuid, $4::uuid, 'del_1', 'provider_accepted', 0, '2026-10-12T11:00:00Z'),
         ($3::uuid, $4::uuid, 'del_2', 'provider_failed', 0, '2026-10-12T10:30:00Z')`,
      [randomUUID(), randomUUID(), randomUUID(), ledgerId],
    );
    await installDb.exec(MIGRATION_SQL);
  });

  it("backfills distinct per-delivery ordinals for legacy zero-ordinal rows", async () => {
    const { rows } = await installDb.query(
      `select delivery_id, attempt_ordinal
         from scheduled_send_attempts
         order by delivery_id, attempt_ordinal`,
    );
    expect(rows).toEqual([
      { delivery_id: "del_1", attempt_ordinal: 1 },
      { delivery_id: "del_1", attempt_ordinal: 2 },
      { delivery_id: "del_2", attempt_ordinal: 1 },
    ]);
    const { rows: cons } = await installDb.query(
      `select conname from pg_constraint
        where conname = 'scheduled_send_attempts_ordinal_unique'`,
    );
    expect(cons).toHaveLength(1);
  });
});
