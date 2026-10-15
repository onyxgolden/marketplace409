// Migration contract test for
// 20261014060000_mfa_recovery_completion_fencing.sql, executed against an
// in-process Postgres (PGlite). Applies the base Layer-2 recovery
// migration first, then the fencing migration, and covers: the fencing
// columns, atomic first-claimer-wins in begin, refusal of a different
// chosen factor while claimed, same-factor resume with generation bump,
// stale (owner, generation) refusal on mark/finalize, the older-operation
// guard on begin and finalize, claim release (owner-bound), terminal
// replay, and the service-role-only grant posture on the new signatures.
// No linked/remote database touched.
//
// The migration is PREPARED for review only; applying it to production
// Supabase is Jason's separate explicit authorization.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const BASE_SQL = readFileSync(
  new URL("../20261013225100_mfa_recovery_and_latch.sql", import.meta.url),
  "utf8",
);
const FENCING_SQL = readFileSync(
  new URL("../20261014060000_mfa_recovery_completion_fencing.sql", import.meta.url),
  "utf8",
);

let db;

const uid = () => randomUUID();

async function begin(userId, opId, chosen, owner, auditId = "audit-1") {
  const { rows } = await db.query(
    `select * from public.mfa_recovery_begin_completion($1::uuid, $2, $3, $4, $5)`,
    [userId, opId, auditId, chosen, owner],
  );
  return rows[0];
}

async function mark(userId, opId, owner, gen, auditId = "audit-1") {
  const { rows } = await db.query(
    `select public.mfa_recovery_mark_factors_removed($1::uuid, $2, $3, $4, $5::bigint) as ok`,
    [userId, opId, auditId, owner, gen],
  );
  return rows[0].ok;
}

async function finalize(userId, opId, owner, gen, auditId = "audit-1") {
  const { rows } = await db.query(
    `select public.mfa_recovery_finalize($1::uuid, $2, $3, $4, $5::bigint) as ok`,
    [userId, opId, auditId, owner, gen],
  );
  return rows[0].ok;
}

async function release(userId, opId, owner, gen, auditId = "audit-1") {
  const { rows } = await db.query(
    `select public.mfa_recovery_release_completion($1::uuid, $2, $3, $4, $5::bigint) as ok`,
    [userId, opId, auditId, owner, gen],
  );
  return rows[0].ok;
}

async function insertOp(userId, opId, status, createdAgo) {
  await db.query(
    `insert into public.mfa_recovery_operations (id, user_id, status, created_at)
     values ($1, $2::uuid, $3, now() - ($4 || ' seconds')::interval)`,
    [opId, userId, status, String(createdAgo)],
  );
}

beforeAll(async () => {
  db = new PGlite();
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
  await db.exec(BASE_SQL);
  await db.exec(FENCING_SQL);
  // Re-runnable: second apply must not error and must not touch rows.
  await db.exec(FENCING_SQL);
}, 60000);

describe("mfa recovery completion fencing migration", () => {
  it("adds the fencing columns defaulting to NULL (unclaimed)", async () => {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = 'mfa_recovery_operations'
          and column_name in ('chosen_factor_id','completion_owner','completion_generation')`,
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual([
      "chosen_factor_id",
      "completion_generation",
      "completion_owner",
    ]);
    const userId = uid();
    await insertOp(userId, "op-cols", "latched", 60);
    const { rows: op } = await db.query(
      `select chosen_factor_id, completion_owner, completion_generation
         from public.mfa_recovery_operations where id = 'op-cols'`,
    );
    expect(op[0].chosen_factor_id).toBeNull();
    expect(op[0].completion_owner).toBeNull();
    expect(op[0].completion_generation).toBeNull();
  });

  it("L2-006A probe: begin pins one chosen factor + owner atomically (first claimer wins)", async () => {
    const userId = uid();
    const row = await begin(userId, "op-claim", "factor-A", "owner-1");
    expect(row.refused).toBe(false);
    expect(row.refused_reason).toBeNull();
    expect(row.chosen_factor_id).toBe("factor-A");
    expect(row.completion_owner).toBe("owner-1");
    expect(row.completion_generation).toBe(1);
    expect(row.terminal).toBe(false);
  });

  it("L2-006A probe: a different chosen factor is refused while the claim stands", async () => {
    const userId = uid();
    await begin(userId, "op-duel", "factor-A", "owner-1");
    const row = await begin(userId, "op-duel", "factor-B", "owner-2");
    expect(row.refused).toBe(true);
    expect(row.refused_reason).toBe("claimed");
    // The stored fence is untouched.
    expect(row.chosen_factor_id).toBe("factor-A");
    expect(row.completion_owner).toBe("owner-1");
  });

  it("L2-006A probe: same-factor resume re-enters and bumps the generation", async () => {
    const userId = uid();
    const first = await begin(userId, "op-resume", "factor-A", "owner-1");
    expect(first.completion_generation).toBe(1);
    // Same chosen factor, different owner (a retry is a new ceremony):
    // allowed, adopts the STORED owner, generation bumps.
    const second = await begin(userId, "op-resume", "factor-A", "owner-2");
    expect(second.refused).toBe(false);
    expect(second.completion_owner).toBe("owner-1");
    expect(second.completion_generation).toBe(2);
  });

  it("L2-006A probe: stale (owner, generation) is refused on mark and finalize", async () => {
    const userId = uid();
    const row = await begin(userId, "op-stale", "factor-A", "owner-1");
    expect(row.completion_generation).toBe(1);
    // Wrong owner.
    expect(await mark(userId, "op-stale", "owner-evil", 1)).toBe(false);
    expect(await finalize(userId, "op-stale", "owner-evil", 1)).toBe(false);
    // Right owner, wrong generation (after a resume bumped it).
    await begin(userId, "op-stale", "factor-A", "owner-2");
    expect(await mark(userId, "op-stale", "owner-1", 1)).toBe(false);
    // Current lineage advances.
    expect(await mark(userId, "op-stale", "owner-1", 2)).toBe(true);
    expect(await finalize(userId, "op-stale", "owner-1", 2)).toBe(true);
  });

  it("L2-006A probe: an older operation cannot begin when a newer non-terminal operation exists", async () => {
    const userId = uid();
    await insertOp(userId, "op-old", "latched", 3600);
    await insertOp(userId, "op-new", "latched", 60);
    const row = await begin(userId, "op-old", "factor-A", "owner-1");
    expect(row.refused).toBe(true);
    expect(row.refused_reason).toBe("stale_operation");
    // The newer operation begins normally.
    const rowNew = await begin(userId, "op-new", "factor-B", "owner-2");
    expect(rowNew.refused).toBe(false);
    expect(rowNew.chosen_factor_id).toBe("factor-B");
  });

  it("L2-006A probe: finalize refuses when a newer non-terminal operation appeared after begin", async () => {
    const userId = uid();
    await insertOp(userId, "op-old-2", "latched", 3600);
    const row = await begin(userId, "op-old-2", "factor-A", "owner-1");
    expect(row.refused).toBe(false);
    expect(await mark(userId, "op-old-2", "owner-1", 1)).toBe(true);
    // A newer recovery starts before finalize: the older operation must
    // not clear the newer latch.
    await insertOp(userId, "op-new-2", "latched", 1);
    expect(await finalize(userId, "op-old-2", "owner-1", 1)).toBe(false);
    const { rows } = await db.query(
      `select status from public.mfa_recovery_operations where id = 'op-old-2'`,
    );
    expect(rows[0].status).toBe("factor_removed");
  });

  it("L2-006A probe: release clears the claim for the owning lineage only", async () => {
    const userId = uid();
    await begin(userId, "op-release", "factor-A", "owner-1");
    // A stale ceremony cannot evict the live claim.
    expect(await release(userId, "op-release", "owner-evil", 1)).toBe(false);
    const still = await begin(userId, "op-release", "factor-B", "owner-2");
    expect(still.refused).toBe(true);
    // The owning lineage releases; a new ceremony can claim fresh.
    expect(await release(userId, "op-release", "owner-1", 1)).toBe(true);
    const fresh = await begin(userId, "op-release", "factor-B", "owner-2");
    expect(fresh.refused).toBe(false);
    expect(fresh.chosen_factor_id).toBe("factor-B");
    expect(fresh.completion_generation).toBe(1);
  });

  it("L2-006A probe: release never touches terminal operations", async () => {
    const userId = uid();
    await insertOp(userId, "op-term", "completed", 60);
    expect(await release(userId, "op-term", "owner-1", 1)).toBe(false);
  });

  it("L2-006A probe: terminal operations still replay through the fenced begin", async () => {
    const userId = uid();
    await insertOp(userId, "op-done", "completed", 60);
    const row = await begin(userId, "op-done", "factor-A", "owner-1");
    expect(row.terminal).toBe(true);
    expect(row.refused).toBe(false);
    expect(row.status).toBe("completed");
  });

  it("L2-006A probe: full fenced flow completes and clears the latch", async () => {
    const userId = uid();
    await db.query(
      `insert into public.mfa_security_latch (user_id, reason, audit_id)
       values ($1::uuid, 'test', 'audit-1')`,
      [userId],
    );
    const row = await begin(userId, "op-full", "factor-A", "owner-1");
    expect(row.refused).toBe(false);
    expect(await mark(userId, "op-full", "owner-1", 1)).toBe(true);
    expect(await finalize(userId, "op-full", "owner-1", 1)).toBe(true);
    const { rows: op } = await db.query(
      `select status from public.mfa_recovery_operations where id = 'op-full'`,
    );
    expect(op[0].status).toBe("completed");
    const { rows: latch } = await db.query(
      `select user_id from public.mfa_security_latch where user_id = $1::uuid`,
      [userId],
    );
    expect(latch).toHaveLength(0);
  });

  it("the fenced RPCs are service-role only", async () => {
    const sigs = [
      "public.mfa_recovery_begin_completion(uuid,text,text,text,text)",
      "public.mfa_recovery_mark_factors_removed(uuid,text,text,text,bigint)",
      "public.mfa_recovery_finalize(uuid,text,text,text,bigint)",
      "public.mfa_recovery_release_completion(uuid,text,text,text,bigint)",
    ];
    for (const sig of sigs) {
      const { rows } = await db.query(
        `select grantee, privilege_type from information_schema.role_routine_grants
          where specific_schema = 'public'
            and routine_name = split_part(split_part($1, '(', 1), '.', 2)`,
        [sig],
      );
      const grants = rows.map((r) => `${r.grantee}:${r.privilege_type}`);
      expect(grants).toContain("service_role:EXECUTE");
      expect(grants.filter((g) => g.startsWith("anon:") || g.startsWith("authenticated:"))).toHaveLength(0);
    }
    // The round-2 three-arg signatures are gone (replaced, not overloaded).
    const { rows } = await db.query(
      `select p.oid::regprocedure::text as sig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('mfa_recovery_begin_completion','mfa_recovery_mark_factors_removed','mfa_recovery_finalize')`,
    );
    for (const r of rows) {
      expect(r.sig).not.toMatch(/\(uuid,text,text\)$/);
    }
  });
});
