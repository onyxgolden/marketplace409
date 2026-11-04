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
});
