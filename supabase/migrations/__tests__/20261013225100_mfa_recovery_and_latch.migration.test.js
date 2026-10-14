// Migration contract test for
// 20261013225100_mfa_recovery_and_latch.sql, executed against an
// in-process Postgres (PGlite). Covers: table/RLS/policy posture
// (service-role only, no client policies), the append-only audit log
// (trigger + privilege revokes), one-active-generation-per-user,
// atomic recovery-code consume (one winner, idempotent replay via
// unique operation id, dead generations rejected), the security latch,
// the grandfather registry PK, and RPC grant posture.
// No linked/remote database touched.
//
// The migration is PREPARED for review only; applying it to production
// Supabase is Jason's separate explicit authorization.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_SQL = readFileSync(
  new URL("../20261013225100_mfa_recovery_and_latch.sql", import.meta.url),
  "utf8",
);

let db;

const TABLES = [
  "mfa_recovery_generations",
  "mfa_recovery_codes",
  "mfa_recovery_operations",
  "mfa_security_latch",
  "mfa_audit_log",
  "session_grandfather_registry",
];

async function consume(userId, digest, opId) {
  const { rows } = await db.query(
    `select * from public.mfa_consume_recovery_code($1::uuid, $2, $3)`,
    [userId, digest, opId],
  );
  return rows[0];
}

async function seedGeneration(userId, keyVersion = 1, codeCount = 3) {
  const genId = randomUUID();
  await db.query(
    `insert into public.mfa_recovery_generations (id, user_id, key_version)
     values ($1::uuid, $2::uuid, $3)`,
    [genId, userId, keyVersion],
  );
  const digests = [];
  for (let i = 0; i < codeCount; i++) {
    const id = randomUUID();
    const digest = `digest-${genId}-${i}`;
    await db.query(
      `insert into public.mfa_recovery_codes (id, generation_id, code_digest)
       values ($1::uuid, $2::uuid, $3)`,
      [id, genId, digest],
    );
    digests.push(digest);
  }
  return { genId, digests };
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

describe("mfa recovery and latch migration", () => {
  it("creates all six tables with RLS enabled and a service-role-only policy", async () => {
    const { rows } = await db.query(
      `select tablename from pg_tables
        where schemaname = 'public' and tablename = any ($1)`,
      [TABLES],
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([...TABLES].sort());

    const rls = await db.query(
      `select relname from pg_class
        where relnamespace = 'public'::regnamespace
          and relname = any ($1) and relrowsecurity`,
      [TABLES],
    );
    expect(rls.rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());

    const pol = await db.query(
      `select tablename, roles from pg_policies
        where schemaname = 'public' and tablename = any ($1)`,
      [TABLES],
    );
    expect(pol.rows).toHaveLength(TABLES.length);
    for (const p of pol.rows) {
      expect(p.roles).toEqual(["service_role"]);
    }
  });

  it("grants nothing to anon/authenticated and full access to service_role", async () => {
    for (const t of TABLES) {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await db.query(
          `select has_table_privilege($1, $2, 'select, insert, update, delete') as p`,
          [role, `public.${t}`],
        );
        expect(rows[0].p).toBe(false);
      }
      const { rows } = await db.query(
        `select has_table_privilege('service_role', $1, 'select, insert, update, delete') as p`,
        [`public.${t}`],
      );
      // mfa_audit_log is append-only: service_role keeps insert/select
      // but loses update/delete even at the privilege level. (A
      // comma-separated privilege list returns true when ANY is held,
      // so update/delete are checked individually.)
      if (t === "mfa_audit_log") {
        for (const priv of ["update", "delete"]) {
          const denied = await db.query(
            `select has_table_privilege('service_role', 'public.mfa_audit_log', $1) as p`,
            [priv],
          );
          expect(denied.rows[0].p).toBe(false);
        }
        const ins = await db.query(
          `select has_table_privilege('service_role', 'public.mfa_audit_log', 'select') as s,
                  has_table_privilege('service_role', 'public.mfa_audit_log', 'insert') as i`,
        );
        expect(ins.rows[0]).toMatchObject({ s: true, i: true });
      } else {
        expect(rows[0].p).toBe(true);
      }
    }

    const { rows } = await db.query(
      `select has_function_privilege('service_role',
               'public.mfa_consume_recovery_code(uuid,text,text)', 'execute') as srv,
              has_function_privilege('anon',
               'public.mfa_consume_recovery_code(uuid,text,text)', 'execute') as anon,
              has_function_privilege('authenticated',
               'public.mfa_consume_recovery_code(uuid,text,text)', 'execute') as auth`,
    );
    expect(rows[0]).toMatchObject({ srv: true, anon: false, auth: false });
  });

  it("keeps the audit log append-only: inserts pass, updates/deletes raise", async () => {
    const id = randomUUID();
    const userId = randomUUID();
    await db.query(
      `insert into public.mfa_audit_log (id, user_id, action, actor, audit_id, metadata)
       values ($1::uuid, $2::uuid, 'recovery_started', 'gateway', 'audit-1', '{"op":"op-1"}'::jsonb)`,
      [id, userId],
    );
    await expect(
      db.query(`update public.mfa_audit_log set action = 'x' where id = $1::uuid`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query(`delete from public.mfa_audit_log where id = $1::uuid`, [id]),
    ).rejects.toThrow(/append-only/);
    const { rows } = await db.query(
      `select count(*)::int as n from public.mfa_audit_log where id = $1::uuid`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("allows exactly one active recovery generation per user", async () => {
    const userId = randomUUID();
    await seedGeneration(userId, 1, 1);
    // A second ACTIVE generation is rejected by the partial unique index.
    await expect(seedGeneration(userId, 2, 1)).rejects.toThrow();
    // Invalidating the old generation frees the slot for regeneration.
    await db.query(
      `update public.mfa_recovery_generations
          set invalidated_at = now()
        where user_id = $1::uuid and invalidated_at is null`,
      [userId],
    );
    const { genId } = await seedGeneration(userId, 2, 1);
    expect(genId).toBeTruthy();
  });

  it("consumes a recovery code exactly once and replays idempotently", async () => {
    const userId = randomUUID();
    const { genId, digests } = await seedGeneration(userId, 1, 2);

    const first = await consume(userId, digests[0], "rec-op-1");
    expect(first).toMatchObject({ consumed: true, generation_id: genId });
    expect(first.code_id).toBeTruthy();

    // Same operation id replays as success without consuming a 2nd code.
    const replay = await consume(userId, digests[1], "rec-op-1");
    expect(replay).toMatchObject({
      consumed: true,
      code_id: first.code_id,
      generation_id: genId,
    });

    // A different operation cannot reuse the consumed code...
    const reuse = await consume(userId, digests[0], "rec-op-2");
    expect(reuse.consumed).toBe(false);

    // ...but the sibling code from the same generation still works.
    const sibling = await consume(userId, digests[1], "rec-op-3");
    expect(sibling.consumed).toBe(true);

    // Unknown digest, wrong user, and null inputs all fail closed with
    // an indistinguishable false.
    expect((await consume(userId, "digest-nope", "rec-op-4")).consumed).toBe(false);
    expect((await consume(randomUUID(), digests[1], "rec-op-5")).consumed).toBe(false);
    expect((await consume(null, digests[1], "rec-op-6")).consumed).toBe(false);
  });

  it("rejects codes from invalidated generations", async () => {
    const userId = randomUUID();
    const { digests } = await seedGeneration(userId, 1, 1);
    await db.query(
      `update public.mfa_recovery_generations
          set invalidated_at = now()
        where user_id = $1::uuid`,
      [userId],
    );
    const r = await consume(userId, digests[0], "rec-op-old-gen");
    expect(r.consumed).toBe(false);
  });

  it("tracks recovery operations through the lifecycle and latches the user", async () => {
    const userId = randomUUID();
    const opId = "rec-op-lifecycle";

    await db.query(
      `insert into public.mfa_recovery_operations (id, user_id, status)
       values ($1, $2::uuid, 'started')`,
      [opId, userId],
    );
    await db.query(
      `update public.mfa_recovery_operations set status = 'latched', updated_at = now()
        where id = $1`,
      [opId],
    );
    await db.query(
      `insert into public.mfa_security_latch (user_id, reason, audit_id)
       values ($1::uuid, 'recovery_pending', 'audit-latch-1')`,
      [userId],
    );

    const { rows } = await db.query(
      `select reason, audit_id from public.mfa_security_latch where user_id = $1::uuid`,
      [userId],
    );
    expect(rows[0]).toMatchObject({ reason: "recovery_pending", audit_id: "audit-latch-1" });

    // One latch per user: a second latch row is rejected.
    await expect(
      db.query(
        `insert into public.mfa_security_latch (user_id, reason, audit_id)
         values ($1::uuid, 'x', 'y')`,
        [userId],
      ),
    ).rejects.toThrow();

    // Invalid status transitions are rejected by the check constraint.
    await expect(
      db.query(`update public.mfa_recovery_operations set status = 'bogus' where id = $1`, [opId]),
    ).rejects.toThrow();
  });

  it("snapshots grandfathered sessions keyed by user + session", async () => {
    const userId = randomUUID();
    await db.query(
      `insert into public.session_grandfather_registry (user_id, session_id, family_id)
       values ($1::uuid, 'sess-1', 'fam-1'), ($1::uuid, 'sess-2', 'fam-1')`,
      [userId],
    );
    // Same session re-snapshotted: PK prevents duplicates.
    await expect(
      db.query(
        `insert into public.session_grandfather_registry (user_id, session_id, family_id)
         values ($1::uuid, 'sess-1', 'fam-1')`,
        [userId],
      ),
    ).rejects.toThrow();
    const { rows } = await db.query(
      `select count(*)::int as n from public.session_grandfather_registry
        where user_id = $1::uuid`,
      [userId],
    );
    expect(rows[0].n).toBe(2);
  });
});
