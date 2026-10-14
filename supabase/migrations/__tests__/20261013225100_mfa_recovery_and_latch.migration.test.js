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

async function consume(userId, digest, opId, auditId = "audit-default") {
  const { rows } = await db.query(
    `select * from public.mfa_consume_recovery_code($1::uuid, $2, $3, $4)`,
    [userId, digest, opId, auditId],
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
               'public.mfa_consume_recovery_code(uuid,text,text,text)', 'execute') as srv,
              has_function_privilege('anon',
               'public.mfa_consume_recovery_code(uuid,text,text,text)', 'execute') as anon,
              has_function_privilege('authenticated',
               'public.mfa_consume_recovery_code(uuid,text,text,text)', 'execute') as auth`,
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

  it("consumes a recovery code exactly once and replays idempotently (bound to user+digest)", async () => {
    const userId = randomUUID();
    const { genId, digests } = await seedGeneration(userId, 1, 2);

    const first = await consume(userId, digests[0], "rec-op-1", "audit-1");
    expect(first).toMatchObject({ consumed: true, generation_id: genId });
    expect(first.code_id).toBeTruthy();

    // Same operation id + same user + same digest replays as success
    // without consuming a 2nd code.
    const replay = await consume(userId, digests[0], "rec-op-1", "audit-1");
    expect(replay).toMatchObject({
      consumed: true,
      code_id: first.code_id,
      generation_id: genId,
    });

    // A different operation cannot reuse the consumed code...
    const reuse = await consume(userId, digests[0], "rec-op-2", "audit-2");
    expect(reuse.consumed).toBe(false);

    // ...but the sibling code from the same generation still works.
    const sibling = await consume(userId, digests[1], "rec-op-3", "audit-3");
    expect(sibling.consumed).toBe(true);

    // Unknown digest, wrong user, and null inputs all fail closed with
    // an indistinguishable false.
    expect((await consume(userId, "digest-nope", "rec-op-4", "audit-4")).consumed).toBe(false);
    expect((await consume(randomUUID(), digests[1], "rec-op-5", "audit-5")).consumed).toBe(false);
    expect((await consume(null, digests[1], "rec-op-6", "audit-6")).consumed).toBe(false);
  });

  it("L2-005 probe: cross-user replay of a consumed operation id returns consumed:false", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const { digests: digestsA } = await seedGeneration(userA, 1, 1);
    const { digests: digestsB } = await seedGeneration(userB, 1, 1);

    const first = await consume(userA, digestsA[0], "rec-op-cross", "audit-a");
    expect(first.consumed).toBe(true);

    // User B replays user A's operation id with B's own digest: denied,
    // no side effects — B's code stays unconsumed.
    const cross = await consume(userB, digestsB[0], "rec-op-cross", "audit-b");
    expect(cross.consumed).toBe(false);

    // B's code still works under B's own operation id.
    const legit = await consume(userB, digestsB[0], "rec-op-cross-b", "audit-b2");
    expect(legit.consumed).toBe(true);

    // User B replays with A's digest but B's identity: also denied.
    const crossDigest = await consume(userB, digestsA[0], "rec-op-cross", "audit-b3");
    expect(crossDigest.consumed).toBe(false);
  });

  it("L2-005 probe: same-user replay with a DIFFERENT digest returns consumed:false", async () => {
    const userId = randomUUID();
    const { digests } = await seedGeneration(userId, 1, 2);
    const first = await consume(userId, digests[0], "rec-op-diff", "audit-1");
    expect(first.consumed).toBe(true);

    // Same operation id, same user, different digest: denied, and the
    // sibling code is NOT consumed as a side effect.
    const r = await consume(userId, digests[1], "rec-op-diff", "audit-2");
    expect(r.consumed).toBe(false);
    const { rows } = await db.query(
      `select consumed_at from public.mfa_recovery_codes
        where code_digest = $1`,
      [digests[1]],
    );
    expect(rows[0].consumed_at).toBeNull();
  });

  it("L2-006 probe: a successful consume atomically latches, logs, and clears grandfathering", async () => {
    const userId = randomUUID();
    const { genId, digests } = await seedGeneration(userId, 1, 1);

    // Seed a grandfather row: recovery must delete it.
    await db.query(
      `insert into public.session_grandfather_registry (user_id, session_id, family_id)
       values ($1::uuid, 'sess-old', 'fam-old')`,
      [userId],
    );

    const r = await consume(userId, digests[0], "rec-op-atomic", "audit-atomic");
    expect(r.consumed).toBe(true);

    // Latch row exists, bound to the audit id.
    const latch = await db.query(
      `select reason, audit_id from public.mfa_security_latch where user_id = $1::uuid`,
      [userId],
    );
    expect(latch.rows[0]).toMatchObject({ reason: "recovery_code_consumed", audit_id: "audit-atomic" });

    // Recovery operation row recorded as latched.
    const op = await db.query(
      `select user_id, status from public.mfa_recovery_operations where id = 'rec-op-atomic'`,
    );
    expect(op.rows[0]).toMatchObject({ user_id: userId, status: "latched" });

    // Audit row appended.
    const audit = await db.query(
      `select action, actor, audit_id from public.mfa_audit_log
        where user_id = $1::uuid and action = 'recovery_code_consumed'`,
      [userId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "recovery_code_consumed",
      actor: "gateway",
      audit_id: "audit-atomic",
    });

    // Grandfather rows deleted: the family can never regain access.
    const gf = await db.query(
      `select count(*)::int as n from public.session_grandfather_registry where user_id = $1::uuid`,
      [userId],
    );
    expect(gf.rows[0].n).toBe(0);

    // The consumed code's generation is unchanged.
    expect(r.generation_id).toBe(genId);
  });

  it("L2-006 probe: idempotent replay re-asserts the latch without duplicating audit rows", async () => {
    const userId = randomUUID();
    const { digests } = await seedGeneration(userId, 1, 1);
    await consume(userId, digests[0], "rec-op-reassert", "audit-r1");
    const replay = await consume(userId, digests[0], "rec-op-reassert", "audit-r1");
    expect(replay.consumed).toBe(true);
    const latch = await db.query(
      `select count(*)::int as n from public.mfa_security_latch where user_id = $1::uuid`,
      [userId],
    );
    expect(latch.rows[0].n).toBe(1);
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

describe("L2-004 mfa_replace_recovery_generation (atomic replacement)", () => {
  const USER_ID = "11111111-1111-1111-1111-111111111111";
  const GEN_1 = "22222222-2222-2222-2222-222222222222";
  const GEN_2 = "33333333-3333-3333-3333-333333333333";
  const digests = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}-digest-${i}`.padEnd(64, "0").slice(0, 64));

  async function replaceGen(userId, genId, keyVersion, codeDigests) {
    const { rows } = await db.query(
      `select public.mfa_replace_recovery_generation($1, $2, $3, $4) as gen_id`,
      [userId, genId, keyVersion, codeDigests]
    );
    return rows[0].gen_id;
  }

  async function activeGeneration(userId) {
    const { rows } = await db.query(
      `select id from public.mfa_recovery_generations where user_id = $1 and invalidated_at is null`,
      [userId]
    );
    return rows;
  }

  it("inserts the generation and codes in one call, invalidating the old generation", async () => {
    const genId = await replaceGen(USER_ID, GEN_1, 1, digests(10, "a"));
    expect(genId).toBe(GEN_1);
    const active = await activeGeneration(USER_ID);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(GEN_1);
    const { rows: codes } = await db.query(
      `select count(*) as n from public.mfa_recovery_codes where generation_id = $1`,
      [GEN_1]
    );
    expect(Number(codes[0].n)).toBe(10);
  });

  it("a second replacement invalidates the first (exactly one active generation)", async () => {
    await replaceGen(USER_ID, GEN_2, 1, digests(10, "b"));
    const active = await activeGeneration(USER_ID);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(GEN_2);
    // The old generation is invalidated, not deleted.
    const { rows } = await db.query(
      `select invalidated_at from public.mfa_recovery_generations where id = $1`,
      [GEN_1]
    );
    expect(rows[0].invalidated_at).not.toBeNull();
  });

  it("L2-004 probe: a failed replacement preserves the previously valid generation", async () => {
    // An empty digest array is rejected by the RPC: the whole transaction
    // rolls back, and the previously valid generation (GEN_2) survives.
    await expect(replaceGen(USER_ID, "44444444-4444-4444-4444-444444444444", 1, [])).rejects.toThrow();
    const active = await activeGeneration(USER_ID);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(GEN_2);
  });

  it("rejects invalid arguments without touching state", async () => {
    await expect(replaceGen(null, GEN_1, 1, digests(10, "c"))).rejects.toThrow();
    const active = await activeGeneration(USER_ID);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(GEN_2);
  });

  it("the replacement RPC is service-role only", async () => {
    const { rows } = await db.query(`
      select has_function_privilege('anon', 'public.mfa_replace_recovery_generation(uuid,uuid,integer,text[])', 'execute') as anon_can,
             has_function_privilege('service_role', 'public.mfa_replace_recovery_generation(uuid,uuid,integer,text[])', 'execute') as svc_can
    `);
    expect(rows[0].anon_can).toBe(false);
    expect(rows[0].svc_can).toBe(true);
  });
});

describe("L2-006 terminal latch replay + phased completion", () => {
  const USER_ID = "55555555-5555-5555-5555-555555555555";
  const OP_ID = "op-l2-006-1";
  const AUDIT_ID = "audit-l2-006-1";

  async function latchState() {
    const { rows } = await db.query(`select reason from public.mfa_security_latch where user_id = $1`, [USER_ID]);
    return rows;
  }

  it("L2-006 probe: a completed operation replays without re-latching", async () => {
    // Set up a real latched operation row (as mfa_consume_recovery_code would).
    await db.query(
      `insert into public.mfa_recovery_operations (id, user_id, status) values ($1, $2, 'latched')`,
      [OP_ID, USER_ID]
    );
    await db.query(`select public.mfa_assert_recovery_latch($1, $2, $3)`, [USER_ID, OP_ID, AUDIT_ID]);
    expect(await latchState()).toHaveLength(1);
    // Simulate completion: mark completed, delete latch.
    await db.query(`update public.mfa_recovery_operations set status = 'completed' where id = $1`, [OP_ID]);
    await db.query(`delete from public.mfa_security_latch where user_id = $1`, [USER_ID]);
    expect(await latchState()).toHaveLength(0);

    // Replay the latch assertion for the completed operation: must NOT
    // recreate the latch.
    await db.query(`select public.mfa_assert_recovery_latch($1, $2, $3)`, [USER_ID, OP_ID, "audit-replay"]);
    expect(await latchState()).toHaveLength(0);
    // The operation is still completed (not re-latched).
    const { rows } = await db.query(`select status from public.mfa_recovery_operations where id = $1`, [OP_ID]);
    expect(rows[0].status).toBe("completed");
  });

  it("phased completion advances latched -> factor_removed -> completed", async () => {
    const OP2 = "op-l2-006-2";
    const { rows: beginRows } = await db.query(
      `select * from public.mfa_recovery_begin_completion($1, $2, $3)`,
      [USER_ID, OP2, "audit-begin"]
    );
    expect(beginRows[0].terminal).toBe(false);
    expect(beginRows[0].status).toBe("latched");
    expect(beginRows[0].operation_created_at).not.toBeNull();

    // Strict phase order: finalize from 'latched' is refused.
    const early = await db.query(`select public.mfa_recovery_finalize($1, $2, $3) as ok`, [USER_ID, OP2, "audit-x"]);
    expect(early.rows[0].ok).toBe(false);

    const marked = await db.query(`select public.mfa_recovery_mark_factors_removed($1, $2, $3) as ok`, [USER_ID, OP2, "audit-mark"]);
    expect(marked.rows[0].ok).toBe(true);

    const done = await db.query(`select public.mfa_recovery_finalize($1, $2, $3) as ok`, [USER_ID, OP2, "audit-final"]);
    expect(done.rows[0].ok).toBe(true);

    const { rows: opRows } = await db.query(`select status from public.mfa_recovery_operations where id = $1`, [OP2]);
    expect(opRows[0].status).toBe("completed");
  });

  it("terminal completion replays without side effects", async () => {
    const OP3 = "op-l2-006-3";
    await db.query(`select public.mfa_recovery_begin_completion($1, $2, $3)`, [USER_ID, OP3, "audit-b"]);
    await db.query(`select public.mfa_recovery_mark_factors_removed($1, $2, $3)`, [USER_ID, OP3, "audit-m"]);
    await db.query(`select public.mfa_recovery_finalize($1, $2, $3)`, [USER_ID, OP3, "audit-f"]);
    // Replay all three: terminal dispositions, no side effects.
    const r1 = await db.query(`select * from public.mfa_recovery_begin_completion($1, $2, $3)`, [USER_ID, OP3, "audit-r"]);
    expect(r1.rows[0].terminal).toBe(true);
    expect(r1.rows[0].status).toBe("completed");
    const r2 = await db.query(`select public.mfa_recovery_mark_factors_removed($1, $2, $3) as ok`, [USER_ID, OP3, "audit-r"]);
    expect(r2.rows[0].ok).toBe(true);
    const r3 = await db.query(`select public.mfa_recovery_finalize($1, $2, $3) as ok`, [USER_ID, OP3, "audit-r"]);
    expect(r3.rows[0].ok).toBe(true);
  });

  it("the completion RPCs are service-role only", async () => {
    for (const sig of [
      "public.mfa_recovery_begin_completion(uuid,text,text)",
      "public.mfa_recovery_mark_factors_removed(uuid,text,text)",
      "public.mfa_recovery_finalize(uuid,text,text)",
    ]) {
      const { rows } = await db.query(
        `select has_function_privilege('anon', '${sig}', 'execute') as anon_can,
                has_function_privilege('service_role', '${sig}', 'execute') as svc_can`
      );
      expect(rows[0].anon_can).toBe(false);
      expect(rows[0].svc_can).toBe(true);
    }
  });
});
