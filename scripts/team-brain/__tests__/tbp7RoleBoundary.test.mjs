// Team Brain P7 — TBP6-006 isolated-database role boundary proof.
//
// Applies the SHIPPED postgres/roles.sql (not ad-hoc test grants)
// and proves, in an isolated PGlite database (nothing production):
//   - the three roles exist, NOLOGIN (LOGIN provisioning is gated);
//   - the consolidator engine positive performs ONLY contract §4
//     effects (changed tables ⊆ P6 tables, no deletions, no P1 writes);
//   - lesser roles cannot write protected tables by raw SQL;
//   - the consolidator cannot write outside its grant set by raw SQL;
//   - the engine refuses reader and superuser connections by identity;
//   - inherited membership does NOT confer engine authority (the
//     identity check is on current_user, not membership) — which is
//     why provisioning must never GRANT tb_consolidator TO anyone;
//   - a PUBLIC grant does NOT confer engine authority either, and
//     re-applying roles.sql revokes it (raw access denied again).
// PGlite is real PostgreSQL semantics, in-memory: permission denied
// here is a real GRANT denial, not a mock.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createRepository } from "../ledger/repository.mjs";
import { migrate as migrateP5, createRetrievalRepository } from "../retrieval/repository.mjs";
import { createConsolidationEngine, migrateP6 } from "../consolidation/engine.mjs";
import { migrateWorker } from "../worker/worker.mjs";
import { exportBackup, importRestore, verifyParity, BACKUP_TABLES } from "../worker/backup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

function loadRolesSql() {
  return readFileSync(join(HERE, "..", "postgres", "roles.sql"), "utf8");
}

function episode(overrides = {}) {
  return {
    scope: "queue",
    title: "Queue ordering",
    body: "The executive queue orders open asks by filed-at time, oldest unanswered first.",
    source: {
      repo: "onyxgolden/marketplace409",
      path: "scripts/team-brain/README.md",
      commit: "f579db64bc36f8359e8e6ea7ef14456d6006c9fd",
      blob: "fixture-blob-p7",
      watermark: "main@f579db6",
    },
    capturedAt: "2026-11-01T16:00:00Z",
    ...overrides,
  };
}

const RUN_DATE = "2026-11-02";
const RUN_NOW = "2026-11-02T10:00:00Z"; // 04:00 CST — past the 03:00 Chicago slot.

async function setupDb() {
  const db = new PGlite();
  const repo = createRepository(db);
  await repo.migrate();
  await migrateP5(db);
  await migrateP6(db);
  await migrateWorker(db);
  await db.exec(loadRolesSql());
  return db;
}

async function seedPublicEpisodes(db, count) {
  const repo = createRetrievalRepository(db);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(await repo.captureEpisode(episode({ title: `Episode ${i}` })));
  }
  return out;
}

async function tableCounts(db, tables) {
  const out = {};
  for (const t of tables) {
    const { rows } = await db.query(`SELECT COUNT(*) AS n FROM ${t}`);
    out[t] = Number(rows[0].n);
  }
  return out;
}

const ALL_TABLES = [
  "team_brain_schema_version",
  "team_brain_obligations",
  "team_brain_obligation_dependencies",
  "team_brain_obligation_events",
  "team_brain_handoffs",
  "team_brain_handoff_events",
  "tb_retrieval_revisions",
  "tb_episodes",
  "tb_episode_grants",
  "tb_pins",
  "tb_working_set",
  "tb_episode_events",
  "tb_consolidation_runs",
  "tb_consolidation_lease",
  "tb_consolidated_facts",
  "tb_consolidation_proposals",
  "tb_consolidation_checkpoints",
  "tb_consolidation_run_bindings",
  "tb_consolidation_audit",
  "tb_worker_heartbeats",
];

const P6_TABLES = new Set([
  "tb_consolidation_runs",
  "tb_consolidation_lease",
  "tb_consolidated_facts",
  "tb_consolidation_proposals",
  "tb_consolidation_checkpoints",
  "tb_consolidation_run_bindings",
  "tb_consolidation_audit",
]);

describe("P7 role boundary (roles.sql)", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  });
  afterEach(async () => {
    if (db) await db.close();
  });

  it60("roles exist and are NOLOGIN (LOGIN provisioning stays gated)", async () => {
    const { rows } = await db.query(
      "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname IN ('tb_admin', 'tb_consolidator', 'tb_reader') ORDER BY rolname",
    );
    expect(rows.map((r) => [r.rolname, r.rolcanlogin])).toEqual([
      ["tb_admin", false],
      ["tb_consolidator", false],
      ["tb_reader", false],
    ]);
  });

  it60("owner handle reads all twenty team-brain tables, holds no role membership", async () => {
    // Regression for the P8 Step A NOT QUALIFIED gap: roles.sql
    // revoked team_brain_schema_version from PUBLIC and granted it
    // to nobody, so no handle could read it at all. The owner read
    // set must cover all twenty tables, not just the six the probes
    // SELECT from: migrationCatalog lists tables through
    // information_schema.tables, which hides tables the handle holds
    // no privilege on.
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'tb_admin' AND privilege_type = 'SELECT' AND table_schema = 'public'
       ORDER BY table_name`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const t of ALL_TABLES) {
      expect(tables, `tb_admin missing SELECT on ${t}`).toContain(t);
    }
    // No membership in the worker/reader roles: membership WITH
    // INHERIT (the default) would confer consolidator writes, and
    // membership WITH INHERIT FALSE hides grants from the
    // effectiveGrants probe. tb_admin holds neither, by design.
    const members = await db.query(
      `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
       JOIN pg_roles member ON member.oid = m.member
       WHERE member.rolname = 'tb_admin' AND r.rolname IN ('tb_consolidator', 'tb_reader')`,
    );
    expect(members.rows).toEqual([]);
  });

  it60("consolidator engine positive performs only contract §4 effects", async () => {
    await seedPublicEpisodes(db, 2);
    const before = await tableCounts(db, ALL_TABLES);
    const episodesBefore = await db.query("SELECT episode_id, body FROM tb_episodes ORDER BY episode_id");
    await db.query("SET ROLE tb_consolidator");
    const engine = createConsolidationEngine(db);
    const receipt = await engine.runConsolidation({ runDate: RUN_DATE, principal: "tb-worker", now: RUN_NOW });
    expect(receipt.replayed).toBe(false);
    expect(typeof receipt.receiptId).toBe("string");
    await db.query("RESET ROLE");
    const runRow = await db.query("SELECT state FROM tb_consolidation_runs WHERE run_date = $1", [RUN_DATE]);
    expect(runRow.rows[0].state).toBe("COMPLETED");
    const after = await tableCounts(db, ALL_TABLES);
    const changed = ALL_TABLES.filter((t) => before[t] !== after[t]);
    for (const t of changed) {
      expect(P6_TABLES.has(t), `engine changed non-P6 table ${t}`).toBe(true);
    }
    expect(after.tb_consolidated_facts).toBeGreaterThan(before.tb_consolidated_facts);
    // No deletions, no episode mutation, no P1 writes.
    expect(after.tb_episodes).toBe(before.tb_episodes);
    const episodesAfter = await db.query("SELECT episode_id, body FROM tb_episodes ORDER BY episode_id");
    expect(episodesAfter.rows).toEqual(episodesBefore.rows);
    expect(after.team_brain_obligations).toBe(0);
    expect(after.team_brain_handoffs).toBe(0);
  });

  it60("lesser role cannot write protected tables by raw SQL", async () => {
    await db.query("SET ROLE tb_reader");
    await expect(db.query("INSERT INTO tb_consolidated_facts (fact_id, episode_id, fact_type, fact_key, fact_value, promoted_revision, promoted_run_date) VALUES ('f1', 'e1', 'EPISODE_RECORDED', 'k', 'v', 1, '2026-11-02')")).rejects.toThrow(/permission denied/);
    await expect(db.query("UPDATE tb_consolidation_lease SET holder = 'x' WHERE id = 1")).rejects.toThrow(/permission denied/);
    await expect(db.query("DELETE FROM tb_episodes")).rejects.toThrow(/permission denied/);
    await expect(db.query("INSERT INTO tb_consolidation_audit (run_date, entry_type, payload, payload_hash, recorded_at) VALUES ('2026-11-02', 'T', '{}', 'h', '2026-11-02T10:00:00Z')")).rejects.toThrow(/permission denied/);
    await expect(db.query("INSERT INTO tb_worker_heartbeats (worker_id, recorded_at, state) VALUES ('w', '2026-11-02T10:00:00Z', 'COMPLETED')")).rejects.toThrow(/permission denied/);
    await expect(db.query("INSERT INTO team_brain_obligations (obligation_id, kind, filed_at, source_repo, source_path, retention_disposition, created_at) VALUES ('o1', 'TASK', '2026-11-02T10:00:00Z', 'r', 'p', 'd', '2026-11-02T10:00:00Z')")).rejects.toThrow(/permission denied/);
  });

  it60("consolidator raw SQL stays inside its grant set", async () => {
    await db.query("SET ROLE tb_consolidator");
    // Allowed: audit insert (plus the sequence it needs).
    await db.query("INSERT INTO tb_consolidation_audit (run_date, entry_type, payload, payload_hash, recorded_at) VALUES ('2026-11-02', 'T', '{}', 'h', '2026-11-02T10:00:00Z')");
    await db.query("INSERT INTO tb_worker_heartbeats (worker_id, recorded_at, state) VALUES ('w', '2026-11-02T10:00:00Z', 'COMPLETED')");
    // Forbidden: delete, truncate, episode writes, P1 writes.
    await expect(db.query("DELETE FROM tb_consolidated_facts")).rejects.toThrow(/permission denied/);
    await expect(db.query("TRUNCATE tb_consolidation_audit")).rejects.toThrow(/permission denied/);
    await expect(db.query("INSERT INTO tb_episodes (episode_id, scope, title, body, source_repo, source_path, source_watermark, captured_at, captured_at_ms, revision, visibility, provenance_status) VALUES ('e9', 'queue', 't', 'b', 'r', 'p', 'w', '2026-11-01T16:00:00Z', 1, 1, 'public', 'COMPLETE')")).rejects.toThrow(/permission denied/);
    await expect(db.query("UPDATE tb_episodes SET title = 'x'")).rejects.toThrow(/permission denied/);
    await expect(db.query("INSERT INTO team_brain_obligations (obligation_id, kind, filed_at, source_repo, source_path, retention_disposition, created_at) VALUES ('o1', 'TASK', '2026-11-02T10:00:00Z', 'r', 'p', 'd', '2026-11-02T10:00:00Z')")).rejects.toThrow(/permission denied/);
  });

  it60("engine refuses reader and superuser connections by identity", async () => {
    await seedPublicEpisodes(db, 1);
    const engine = createConsolidationEngine(db);
    await db.query("SET ROLE tb_reader");
    await expect(engine.runConsolidation({ runDate: RUN_DATE, principal: "tb-worker", now: RUN_NOW })).rejects.toMatchObject({ code: "ROLE_DENIED" });
    await db.query("RESET ROLE");
    await expect(engine.runConsolidation({ runDate: RUN_DATE, principal: "tb-worker", now: RUN_NOW })).rejects.toMatchObject({ code: "ROLE_DENIED" });
  });

  it60("inherited membership does not confer engine authority", async () => {
    await seedPublicEpisodes(db, 1);
    await db.query("GRANT tb_consolidator TO tb_reader");
    await db.query("SET ROLE tb_reader");
    const engine = createConsolidationEngine(db);
    // Identity is current_user, not membership: still refused.
    await expect(engine.runConsolidation({ runDate: RUN_DATE, principal: "tb-worker", now: RUN_NOW })).rejects.toMatchObject({ code: "ROLE_DENIED" });
    // Documented consequence: membership DOES confer raw SQL privilege
    // in PostgreSQL, which is why provisioning must never GRANT
    // tb_consolidator TO anyone. This assertion pins that reality
    // instead of pretending otherwise.
    await db.query("INSERT INTO tb_consolidation_audit (run_date, entry_type, payload, payload_hash, recorded_at) VALUES ('2026-11-02', 'T', '{}', 'h2', '2026-11-02T10:00:00Z')");
  });

  it60("PUBLIC grant does not confer engine authority, and roles.sql revokes it", async () => {
    await seedPublicEpisodes(db, 1);
    await db.query("GRANT INSERT ON tb_consolidated_facts TO PUBLIC");
    await db.query("SET ROLE tb_reader");
    const engine = createConsolidationEngine(db);
    await expect(engine.runConsolidation({ runDate: RUN_DATE, principal: "tb-worker", now: RUN_NOW })).rejects.toMatchObject({ code: "ROLE_DENIED" });
    await db.query("RESET ROLE");
    await db.exec(loadRolesSql());
    await db.query("SET ROLE tb_reader");
    await expect(db.query("INSERT INTO tb_consolidated_facts (fact_id, episode_id, fact_type, fact_key, fact_value, promoted_revision, promoted_run_date) VALUES ('f1', 'e1', 'EPISODE_RECORDED', 'k', 'v', 1, '2026-11-02')")).rejects.toThrow(/permission denied/);
  });

  it60("backup export succeeds as tb_admin while tb_reader still lacks the 8 tables", async () => {
    // Regression for the P8 Step A --backup 42501 gap: the export
    // covers all 20 tables, but tb_reader holds SELECT on only 12
    // by design. The fix routes --backup through the owner handle
    // (tb_admin: full 20-table read set, no writes) instead of
    // widening the reader — this test pins both halves: the reader
    // still cannot export, and the owner handle can, with the
    // reader's grant set unchanged.
    await seedPublicEpisodes(db, 1);
    await db.query("SET ROLE tb_reader");
    await expect(exportBackup(db)).rejects.toThrow(/permission denied/);
    await db.query("RESET ROLE");
    const readerTables = (
      await db.query(
        `SELECT table_name FROM information_schema.role_table_grants
         WHERE grantee = 'tb_reader' AND privilege_type = 'SELECT' AND table_schema = 'public'`,
      )
    ).rows.map((r) => r.table_name);
    const readerMissing = ALL_TABLES.filter((t) => !readerTables.includes(t));
    expect(readerMissing.sort()).toEqual([
      "tb_episode_events",
      "tb_episode_grants",
      "tb_pins",
      "tb_working_set",
      "team_brain_handoff_events",
      "team_brain_obligation_dependencies",
      "team_brain_obligation_events",
      "team_brain_schema_version",
    ]);
    await db.query("SET ROLE tb_admin");
    const backup = await exportBackup(db);
    await db.query("RESET ROLE");
    expect(backup.version).toBe("p7-backup-1");
    expect(Object.keys(backup.tables).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(backup.tables.tb_episodes.count).toBe(1);
  });

  it60("sequence privilege: consolidator uses the audit + heartbeat sequences, reader cannot", async () => {
    // PostgreSQL names a BIGSERIAL backing sequence
    // <table>_<column>_seq — the audit sequence is ..._audit_seq_seq.
    for (const seq of ["tb_consolidation_audit_seq_seq", "tb_worker_heartbeats_id_seq"]) {
      const c = await db.query(`SELECT has_sequence_privilege('tb_consolidator', '${seq}', 'USAGE') AS ok`);
      expect(c.rows[0].ok, `consolidator should use ${seq}`).toBe(true);
      const r = await db.query(`SELECT has_sequence_privilege('tb_reader', '${seq}', 'USAGE') AS ok`);
      expect(r.rows[0].ok, `reader must not use ${seq}`).toBe(false);
    }
  });

  it60("owner handle restore grant: UPDATE limited to the three SINGLETON_UPSERT tables", async () => {
    // Regression for the PR #740 fix round: the first cut granted
    // table-wide UPDATE on all twenty tables, but importRestore's only
    // UPDATE path is the three ON CONFLICT DO UPDATE singleton tables
    // (team_brain_schema_version, tb_retrieval_revisions,
    // tb_consolidation_lease) — every other table restores DO NOTHING
    // into an empty target. A WHERE false update still triggers the
    // table-privilege check with zero rows at risk, so this needs no
    // seed data and cannot corrupt anything either way.
    const SINGLETON_TABLES = new Set([
      "team_brain_schema_version",
      "tb_retrieval_revisions",
      "tb_consolidation_lease",
    ]);
    async function tryUpdate(table) {
      // Skip identity/generated columns: PostgreSQL rejects assigning
      // them to anything but DEFAULT regardless of privilege, which
      // would mask the permission check this test is after.
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
           AND is_identity = 'NO' AND is_generated = 'NEVER'
         ORDER BY ordinal_position LIMIT 1`,
        [table],
      );
      const col = rows[0].column_name;
      return db.query(`UPDATE ${table} SET "${col}" = "${col}" WHERE false`);
    }
    await db.query("SET ROLE tb_admin");
    for (const t of ALL_TABLES) {
      if (SINGLETON_TABLES.has(t)) {
        await expect(tryUpdate(t), `tb_admin should UPDATE ${t}`).resolves.toBeTruthy();
      } else {
        await expect(tryUpdate(t), `tb_admin should be denied UPDATE on ${t}`).rejects.toThrow(/permission denied/);
      }
    }
    await db.query("RESET ROLE");
  });

  it60("owner handle restore grant: sequences are USAGE only, not SELECT", async () => {
    // Regression for the PR #740 fix round: the first cut also granted
    // SELECT on the restore sequences, but importRestore never reads
    // sequence state (no currval/lastval, no SELECT on the sequence
    // relation) — only nextval() via the column DEFAULT, which needs
    // USAGE alone.
    const seqs = [
      "team_brain_obligation_events_seq_seq",
      "team_brain_handoff_events_seq_seq",
      "tb_episode_events_event_id_seq",
      "tb_consolidation_audit_seq_seq",
      "tb_worker_heartbeats_id_seq",
    ];
    for (const seq of seqs) {
      const usage = await db.query(`SELECT has_sequence_privilege('tb_admin', '${seq}', 'USAGE') AS ok`);
      expect(usage.rows[0].ok, `tb_admin should have USAGE on ${seq}`).toBe(true);
      const select = await db.query(`SELECT has_sequence_privilege('tb_admin', '${seq}', 'SELECT') AS ok`);
      expect(select.rows[0].ok, `tb_admin should NOT have SELECT on ${seq}`).toBe(false);
    }
  });

  it60("owner handle restore: full backup -> restore reaches parity, every surrogate-id table populated", async () => {
    // Proves the narrowed grant set (INSERT everywhere, UPDATE on the
    // three singletons only, sequence USAGE only) is still sufficient
    // for a real restore — not just privilege-boundary checks. Seeds
    // all five surrogate-id tables so every new sequence grant is
    // actually exercised, not vacuously untested.
    await seedPublicEpisodes(db, 1);
    const episodeId = (
      await db.query("SELECT episode_id FROM tb_episodes ORDER BY episode_id LIMIT 1")
    ).rows[0].episode_id;
    await db.query(
      "INSERT INTO team_brain_obligations (obligation_id, kind, filed_at, source_repo, source_path, retention_disposition, created_at) VALUES ('o1', 'TASK', '2026-11-02T10:00:00Z', 'r', 'p', 'd', '2026-11-02T10:00:00Z')",
    );
    await db.query(
      "INSERT INTO team_brain_obligation_events (obligation_id, actor, recorded_at, event_type, reason) VALUES ('o1', 'claude', '2026-11-02T10:00:00Z', 'FILED', 'restore parity test')",
    );
    await db.query(
      "INSERT INTO team_brain_handoffs (handoff_id, created_at, updated_at) VALUES ('h1', '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z')",
    );
    await db.query(
      "INSERT INTO team_brain_handoff_events (handoff_id, from_state, to_state, actor, recorded_at, reason) VALUES ('h1', 'OPEN', 'OPEN', 'claude', '2026-11-02T10:00:00Z', 'restore parity test')",
    );
    await db.query(
      `INSERT INTO tb_episode_events (episode_id, event_type, revision, created_at) VALUES ('${episodeId}', 'ARCHIVED', 1, '2026-11-02T10:00:00Z')`,
    );
    await db.query(
      "INSERT INTO tb_worker_heartbeats (worker_id, recorded_at, state) VALUES ('w', '2026-11-02T10:00:00Z', 'COMPLETED')",
    );
    await db.query(
      "INSERT INTO tb_consolidation_audit (run_date, entry_type, payload, payload_hash, recorded_at) VALUES ('2026-11-02', 'T', '{}', 'h', '2026-11-02T10:00:00Z')",
    );

    await db.query("SET ROLE tb_admin");
    const backup = await exportBackup(db);
    await db.query("RESET ROLE");

    const target = new PGlite();
    try {
      const repo = createRepository(target);
      await repo.migrate();
      await migrateP5(target);
      await migrateP6(target);
      await migrateWorker(target);
      await target.exec(loadRolesSql());
      await target.query("SET ROLE tb_admin");
      await importRestore(target, backup);
      await target.query("RESET ROLE");
      const parity = await verifyParity(target, backup);
      const failed = Object.entries(parity.tables)
        .filter(([, t]) => !t.ok)
        .map(([name]) => name);
      expect(parity.ok, `parity failed for tables: ${failed.join(", ") || "(none listed)"}`).toBe(true);
    } finally {
      await target.close();
    }
  });
});
