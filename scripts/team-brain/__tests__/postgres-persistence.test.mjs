// Team Brain P1 — real-PostgreSQL persistence tests.
//
// These tests run against a REAL PostgreSQL server (not PGlite), as required
// by the P1 acceptance criteria. Connection via TEST_POSTGRES_URL env, or
// defaults to localhost:5432 with the current OS user.
//
// Each test gets a FRESH database (created per test file run, tables
// truncated between tests) so tests are isolated and repeatable.
//
// Coverage (36+ tests):
//   1. Migration: fresh install, idempotent replay, schema snapshot
//   2. Roles: least-privilege grants, negative grants on domain tables,
//      append-only (no UPDATE/DELETE on history for worker roles)
//   3. Transactions: BEGIN/COMMIT/ROLLBACK on same connection, row locks,
//      serialization retry, deadlock retry
//   4. Idempotency: same operation ID never double-applies
//   5. Concurrency: same-ID winner, conflicting replay rejected,
//      dependency race (no cycle accepted)
//   6. Prototype compatibility: all ledger operations work via pg adapter
//   7. Guarded transition functions (fix round 2, TBP1-002): direct calls
//      AS tb_coordinator are refused by the database itself — wrong-kind
//      close/revoke, missing verification/evidence, same-head and
//      binding-mismatched supersession, out-of-policy retention, and
//      untrusted/revoked/mis-bound overrides all raise TB2xx errcodes
//   8. Adapter provenance boundary (fix round 2, TBP1-004): the normalized
//      filing contract — sourceId or a REGISTERED source identity only;
//      incomplete or unregistered provenance is refused, never synthesized
//   9. Fix round 3 (TBP1-002A/B/C): the full override structure enforced
//      inside tb_upsert_override (TB220/TB221/TB222 refusals, prior row
//      preserved byte-for-byte, accepted payloads project cleanly);
//      tb_close_task coverage requires a JSON array of valid reference
//      strings (TB223 — object/scalar/malformed/invalid-member evidence
//      fails closed); close/revoke/retention append their immutable event
//      inside the guarded function (exactly one event per transition,
//      TB224 metadata refusals, repeat close refused with no second event)
//  10. Two test-authoring fixes from Claude's round-2 receipt (47/49 raw):
//      the TDZ shadowing of the `filed` helper in the idempotency test,
//      and the auth-override test asserting a typed code against the
//      error message instead of its .code property

import { describe, test, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

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

const HEX40 = (ch) => ch.repeat(40);

// Normalized filing contract (fix round 2): obligations file against a
// REGISTERED source identity. Tests seed synthetic source rows explicitly —
// deterministic 40-hex commit/blob derived from the key — through whatever
// pool is passed (admin pool for worker-role tests, so the worker only ever
// resolves an existing source_id, exactly like production ingress).
async function seedSourceObject(pool, key, extra = {}) {
  const commit = extra.commit ?? createHash("sha1").update(`commit-${key}`).digest("hex");
  const blob = extra.blob ?? createHash("sha1").update(`blob-${key}`).digest("hex");
  const sourceId = `src-${key}`;
  const repo = "onyxgolden/marketplace409";
  const path = `results/team-brain/${key}.md`;
  await pool.query(
    `insert into team_brain.source_objects
       (source_id, repo, path, commit, blob, algorithm, reviewed_head, byte_length,
        content_sha256, source_class, observed_at, transport_receipt, provenance_status)
     values ($1, $2, $3, $4, $5, 'git-sha1', null, 128, $6, 'TEST_FIXTURE', $7,
             'test-transport', 'UNVERIFIED')
     on conflict (source_id) do nothing`,
    [
      sourceId,
      repo,
      path,
      commit,
      blob,
      createHash("sha256").update(`content-${key}`).digest("hex"),
      T0,
    ],
  );
  return { sourceId, repo, path, commit, blob };
}

function taskRecord(id, filedAt = T0, extra = {}) {
  return {
    id,
    kind: "TASK",
    filedAt,
    owner: "p1-test",
    retentionDisposition: "PERMANENT",
    filedBy: "p1-test",
    filedReason: "p1-test",
    ...extra,
  };
}

// File a record against a freshly seeded source identity for its id.
async function filed(repo, pool, record) {
  const s = await seedSourceObject(pool, record.id);
  return repo.fileObligation({ sourceId: s.sourceId, ...record });
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
        team_brain.obligation_supersessions,
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
          "obligation_supersessions",
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
        const ob = await filed(repo, pool, taskRecord("p1-t1"));
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
        await expect(filed(repo, pool, { ...taskRecord("p1-bad"), kind: "NOPE" })).rejects.toThrow(/Invalid obligation kind/);
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
          filed(repo, pool, taskRecord("p1-race")),
          filed(repo, pool, taskRecord("p1-race")),
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
        await filed(repo, pool, taskRecord("p1-idem"));
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
        // (Fix round 3 test-authoring fix, per Claude's round-2 receipt:
        // the local was named `filed`, shadowing the module-scope helper
        // `filed(repo, pool, record)` for the whole block via TDZ and
        // throwing ReferenceError before this assertion could run. Renamed
        // to `filedEvents`.)
        const events = await repo.getEvents("p1-idem");
        const filedEvents = events.filter((e) => e.eventType === "FILED");
        expect(filedEvents.length).toBe(1);
      } finally {
        await pool.end();
      }
    });

    test("row_version increments on lifecycle transition", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const before = await filed(repo, pool, taskRecord("p1-rv"));
        const v0 = await pool.query(
          "select row_version from team_brain.obligations where obligation_id = 'p1-rv'",
        );
        await repo.setRetentionDisposition("p1-rv", {
          actor: "tester",
          recordedAt: T1,
          reason: "test",
          disposition: "RETAIN_1Y",
        });
        const v1 = await pool.query(
          "select row_version from team_brain.obligations where obligation_id = 'p1-rv'",
        );
        expect(Number(v1.rows[0].row_version)).toBeGreaterThan(Number(v0.rows[0].row_version));
        // Fix round 3 (TBP1-002C): the RETENTION_DECIDED event is written
        // by the guarded function itself — exactly one, no adapter
        // duplicate.
        const retEvents = (await repo.getEvents("p1-rv")).filter(
          (e) => e.eventType === "RETENTION_DECIDED",
        );
        expect(retEvents.length).toBe(1);
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
        await filed(repo, pool, taskRecord("p1-close"));
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
        // Fix round 3 (TBP1-002C): exactly one CLOSED event, written by
        // the guarded function — the adapter no longer adds a second.
        const closedEvents = (await repo.getEvents("p1-close")).filter(
          (e) => e.eventType === "CLOSED",
        );
        expect(closedEvents.length).toBe(1);
        expect(closedEvents[0].actor).toBe("tester");
        expect(closedEvents[0].reason).toBe("done");
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
        // (Fix round 3 test-authoring fix, per Claude's round-2 receipt:
        // this asserted the typed code against the error MESSAGE via
        // toThrow(/UNKNOWN_AUTHORITY|INVALID_OVERRIDE/), but neither
        // literal appears in the message text — the code lives on the
        // error's .code property. Assert on .code instead.)
        await expect(
          filed(
            repo,
            pool,
            taskRecord("p1-auth", T0, {
              priorityOverride: {
                authorityRef: "unknown-grant",
                actor: "tester",
                recordedAt: T0,
                reason: "test",
                rank: 1,
              },
            }),
          ),
        ).rejects.toMatchObject({
          code: expect.stringMatching(/^(UNKNOWN_AUTHORITY|INVALID_OVERRIDE)$/),
        });
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
        await filed(repo, pool, taskRecord("p1-d1"));
        await filed(repo, pool, taskRecord("p1-d2"));
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
        // Source identities are seeded through the ADMIN pool; the worker
        // repo only resolves existing source_ids (it has SELECT on
        // source_objects), exactly like production ingress.
        await filed(repo, admin, taskRecord("p1-worker-1"));
        await filed(
          repo,
          admin,
          taskRecord("p1-worker-2", T0, { dependencies: ["p1-worker-1"] }),
        );
        await repo.setRetentionDisposition("p1-worker-1", {
          actor: "t",
          recordedAt: T1,
          reason: "t",
          disposition: "PERMANENT",
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

        await filed(repo, admin, { ...taskRecord("p1-worker-auth"), kind: "AUTHORIZATION" });
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
        const s1 = await seedSourceObject(pool, "p1-v1");
        const v1 = {
          id: "p1-v1",
          kind: "VERDICT",
          filedAt: T0,
          owner: "p1-test",
          sourceId: s1.sourceId,
          resourceRepo: "onyxgolden/marketplace409",
          reviewedHead: HEX40("a"),
          retentionDisposition: "UNTIL_SUPERSEDED_AT_NEW_HEAD",
          filedBy: "t",
          filedReason: "t",
        };
        await repo.fileObligation(v1);
        await expect(
          repo.supersedeVerdict(
            "p1-v1",
            { ...v1, id: "p1-v2", filedAt: T1 },
            { actor: "t", recordedAt: T1, reason: "t" },
          ),
        ).rejects.toThrow(/same head/);
        const s2 = await seedSourceObject(pool, "p1-v2");
        const { next } = await repo.supersedeVerdict(
          "p1-v1",
          { ...v1, id: "p1-v2", filedAt: T1, sourceId: s2.sourceId, reviewedHead: HEX40("b") },
          { actor: "t", recordedAt: T1, reason: "new head" },
        );
        expect(next.id).toBe("p1-v2");
        const old = await repo.getObligation("p1-v1");
        expect(old.state).toBe("SUPERSEDED");
        // The supersession is a first-class relation row, and both ends of
        // it are visible through the adapter's obligation view.
        const rel = await pool.query(
          `select count(*)::int as n from team_brain.obligation_supersessions
           where old_obligation_id = 'p1-v1' and new_obligation_id = 'p1-v2'`,
        );
        expect(rel.rows[0].n).toBe(1);
        expect(old.supersededBy).toBe("p1-v2");
        expect(next.supersedes).toBe("p1-v1");
      } finally {
        await pool.end();
      }
    });

    test("evidence correction links without rewriting original", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await filed(repo, pool, { ...taskRecord("p1-e1"), kind: "EVIDENCE" });
        const s2 = await seedSourceObject(pool, "p1-e2");
        const { correction } = await repo.correctEvidence(
          "p1-e1",
          { ...taskRecord("p1-e2"), kind: "EVIDENCE", sourceId: s2.sourceId },
          { actor: "t", recordedAt: T1, reason: "fix" },
        );
        expect(correction.id).toBe("p1-e2");
        expect(correction.supersedes).toBe("p1-e1");
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
        await filed(repo, pool, { ...taskRecord("p1-a1"), kind: "AUTHORIZATION" });
        const revoked = await repo.revokeAuthorization("p1-a1", {
          actor: "t",
          recordedAt: T1,
          reason: "test",
        });
        expect(revoked.state).toBe("REVOKED");
        // Fix round 3 (TBP1-002C): exactly one REVOKED event, written by
        // the guarded function — the adapter no longer adds a second.
        const revokedEvents = (await repo.getEvents("p1-a1")).filter(
          (e) => e.eventType === "REVOKED",
        );
        expect(revokedEvents.length).toBe(1);
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
          "obligation_supersessions",
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

  describe("guarded transition functions (direct calls as tb_coordinator)", () => {
    // Fix round 2 (TBP1-002): the lifecycle predicates live in the database.
    // These tests connect AS tb_coordinator and call the SECURITY DEFINER
    // functions DIRECTLY — no adapter pre-checks in the path — and require
    // the database itself to refuse every guard violation with its TB2xx
    // errcode. pg surfaces the errcode on error.code (the message text does
    // not embed it), so refusals are asserted with toMatchObject({ code }).
    let admin;
    let worker;
    let adminRepo;
    let workerRepo;

    const T3 = "2026-10-15T18:03:00.000Z";

    function verdictRecord(id, filedAt, head, extra = {}) {
      return {
        id,
        kind: "VERDICT",
        filedAt,
        owner: "p1-test",
        resourceRepo: "onyxgolden/marketplace409",
        reviewedHead: head,
        retentionDisposition: "UNTIL_SUPERSEDED_AT_NEW_HEAD",
        filedBy: "p1-test",
        filedReason: "p1-test",
        ...extra,
      };
    }

    async function seedGrants(targetId) {
      await admin.query(
        `insert into team_brain.trusted_authorizations
           (grant_id, granter_principal_id, subject_ref, resource_repo,
            allowed_operations, override_item, override_rank)
         values
           ('grant-valid', 'Jason', 'test', 'onyxgolden/marketplace409', 'OVERRIDE', $1, 1),
           ('grant-revoked', 'Jason', 'test', 'onyxgolden/marketplace409', 'OVERRIDE', $1, 1),
           ('grant-mallory', 'Mallory', 'test', 'onyxgolden/marketplace409', 'OVERRIDE', $1, 1),
           ('grant-other-item', 'Jason', 'test', 'onyxgolden/marketplace409', 'OVERRIDE', 'someone-else', 1)`,
        [targetId],
      );
      await admin.query(
        "update team_brain.trusted_authorizations set revoked_at = now() where grant_id = 'grant-revoked'",
      );
    }

    function overridePayload(extra = {}) {
      return JSON.stringify({
        authorityRef: "grant-valid",
        actor: "t",
        recordedAt: T0,
        reason: "t",
        rank: 1,
        ...extra,
      });
    }

    // Fix round 3 (TBP1-002A): build an override payload from the valid
    // base with fields patched or omitted entirely.
    function overrideJson(patch = {}, omit = []) {
      const o = {
        authorityRef: "grant-valid",
        actor: "t",
        recordedAt: T0,
        reason: "t",
        rank: 1,
        ...patch,
      };
      for (const k of omit) delete o[k];
      return JSON.stringify(o);
    }

    // Insert a VERIFICATION event directly (admin pool), bypassing the
    // adapter's recordVerification contract — the exact direct-write path
    // TBP1-002B is about.
    async function insertVerificationEvent(id, evidenceLinks) {
      await admin.query(
        `insert into team_brain.obligation_events
           (event_id, obligation_id, actor_principal, event_type, reason, evidence_links)
         values ($1, $2, 't', 'VERIFICATION', 't', $3)`,
        [randomUUID(), id, evidenceLinks],
      );
    }

    async function obligationState(id) {
      const res = await admin.query(
        "select state from team_brain.obligations where obligation_id = $1",
        [id],
      );
      return res.rows[0].state;
    }

    async function transitionEventCount(id, eventType) {
      const res = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = $2`,
        [id, eventType],
      );
      return res.rows[0].n;
    }

    beforeAll(async () => {
      admin = await freshMigratedPool();
      // Test-only credential, provisioned outside the migration (TBP1-001)
      // and reset in afterAll.
      await admin.query("alter role tb_coordinator login password 'tb_p1_test_only'");
      const url = new URL(TEST_URL);
      url.pathname = `/${testDbName}`;
      url.username = "tb_coordinator";
      url.password = "tb_p1_test_only";
      worker = new PgPool({ connectionString: url.toString(), max: 3 });
      const { createPostgresRepository } = await import("../postgres/repository.mjs");
      adminRepo = createPostgresRepository(admin);
      workerRepo = createPostgresRepository(worker);
    });

    afterAll(async () => {
      if (worker) await worker.end();
      if (admin) {
        await admin.query("alter role tb_coordinator nologin").catch(() => {});
        await admin.end();
      }
    });

    beforeEach(async () => {
      await truncateAll(admin);
    });

    test("tb_close_task refuses a non-TASK obligation (TB202) and changes nothing", async () => {
      const auth = await filed(adminRepo, admin, { ...taskRecord("g-auth"), kind: "AUTHORIZATION" });
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          auth.id,
          ["e1"],
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB202" });
      const res = await admin.query(
        "select state from team_brain.obligations where obligation_id = $1",
        [auth.id],
      );
      expect(res.rows[0].state).toBe("OPEN");
      // Fix round 3 (TBP1-002C): a refused transition writes zero events.
      const ev = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'CLOSED'`,
        [auth.id],
      );
      expect(ev.rows[0].n).toBe(0);
    });

    test("tb_close_task refuses a task with no verification event (TB204)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-noverify"));
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          task.id,
          ["e1"],
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB204" });
    });

    test("tb_close_task refuses evidence not covered by verification (TB206)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-uncovered"));
      await adminRepo.recordVerification(task.id, {
        verifier: "t",
        verifiedAt: T1,
        reason: "t",
        evidenceRefs: ["e1"],
      });
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          task.id,
          ["e2"],
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB206" });
      // Refused: state unchanged, zero CLOSED events (TBP1-002C).
      const res = await admin.query(
        "select state from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(res.rows[0].state).toBe("OPEN");
      const ev = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'CLOSED'`,
        [task.id],
      );
      expect(ev.rows[0].n).toBe(0);
    });

    test("tb_close_task closes directly when verification covers the evidence", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-close-ok"));
      await workerRepo.recordVerification(task.id, {
        verifier: "t",
        verifiedAt: T1,
        reason: "t",
        evidenceRefs: ["e1"],
      });
      await worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
        task.id,
        ["e1"],
        "closer",
        "direct close",
        T2,
      ]);
      const res = await admin.query(
        "select state from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(res.rows[0].state).toBe("CLOSED");
      // Fix round 3 (TBP1-002C): the direct call itself appends exactly
      // one CLOSED event carrying the supplied actor/reason/evidence.
      const ev = await admin.query(
        `select actor_principal, reason, evidence_links from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'CLOSED'`,
        [task.id],
      );
      expect(ev.rows.length).toBe(1);
      expect(ev.rows[0].actor_principal).toBe("closer");
      expect(ev.rows[0].reason).toBe("direct close");
      expect(JSON.parse(ev.rows[0].evidence_links)).toEqual(["e1"]);
      // Repeat direct close: terminal-state refusal (TB203), no second
      // event.
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          task.id,
          ["e1"],
          "closer",
          "direct close again",
          T3,
        ]),
      ).rejects.toMatchObject({ code: "TB203" });
      const ev2 = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'CLOSED'`,
        [task.id],
      );
      expect(ev2.rows[0].n).toBe(1);
    });

    test("tb_close_task refuses object evidence_links: object keys are not array coverage (TB223, TBP1-002B probe case)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ev-object"));
      // The ChatGPT/Claude probe case: a VERIFICATION event whose
      // evidence_links is a JSON OBJECT. The round-2 `?` predicate matched
      // the object key 'artifact' and closed the task.
      await insertVerificationEvent(task.id, '{"artifact":false}');
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          task.id,
          ["artifact"],
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB223" });
      expect(await obligationState(task.id)).toBe("OPEN");
      expect(await transitionEventCount(task.id, "CLOSED")).toBe(0);
    });

    test("tb_close_task refuses scalar, malformed, and invalid-member evidence (TB223, TBP1-002B)", async () => {
      const cases = [
        ["g-ev-scalar", '"artifact"'],
        ["g-ev-malformed", "not json{"],
        ["g-ev-nonstr", '["artifact",42]'],
        ["g-ev-blank", '["artifact"," "]'],
        ["g-ev-nullmember", '["artifact",null]'],
      ];
      for (const [id, links] of cases) {
        const task = await filed(adminRepo, admin, taskRecord(id));
        await insertVerificationEvent(task.id, links);
        await expect(
          worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
            task.id,
            ["artifact"],
            "t",
            "t",
            T2,
          ]),
        ).rejects.toMatchObject({ code: "TB223" });
        expect(await obligationState(task.id)).toBe("OPEN");
        expect(await transitionEventCount(task.id, "CLOSED")).toBe(0);
      }
    });

    test("tb_revoke_authorization refuses a non-AUTHORIZATION obligation (TB202)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-task"));
      await expect(
        worker.query("select team_brain.tb_revoke_authorization($1, $2, $3, $4)", [
          task.id,
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB202" });
    });

    test("tb_revoke_authorization refuses an already-terminal authorization (TB203)", async () => {
      const auth = await filed(adminRepo, admin, { ...taskRecord("g-auth2"), kind: "AUTHORIZATION" });
      await adminRepo.revokeAuthorization(auth.id, { actor: "t", recordedAt: T1, reason: "t" });
      await expect(
        worker.query("select team_brain.tb_revoke_authorization($1, $2, $3, $4)", [
          auth.id,
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB203" });
    });

    test("tb_revoke_authorization revokes directly and appends exactly one REVOKED event (TBP1-002C)", async () => {
      const auth = await filed(adminRepo, admin, { ...taskRecord("g-revoke-ok"), kind: "AUTHORIZATION" });
      await worker.query("select team_brain.tb_revoke_authorization($1, $2, $3, $4)", [
        auth.id,
        "revoker",
        "direct revoke",
        T2,
      ]);
      const res = await admin.query(
        "select state from team_brain.obligations where obligation_id = $1",
        [auth.id],
      );
      expect(res.rows[0].state).toBe("REVOKED");
      const ev = await admin.query(
        `select actor_principal, reason from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'REVOKED'`,
        [auth.id],
      );
      expect(ev.rows.length).toBe(1);
      expect(ev.rows[0].actor_principal).toBe("revoker");
      expect(ev.rows[0].reason).toBe("direct revoke");
    });

    test("tb_supersede_verdict refuses a same-head supersession (TB209)", async () => {
      await filed(adminRepo, admin, verdictRecord("g-v1", T0, HEX40("a")));
      await filed(adminRepo, admin, verdictRecord("g-v2", T1, HEX40("a")));
      await expect(
        worker.query("select team_brain.tb_supersede_verdict($1, $2, $3, $4, $5)", [
          "g-v1",
          "g-v2",
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB209" });
    });

    test("tb_supersede_verdict refuses a scope mismatch (TB207)", async () => {
      await filed(adminRepo, admin, verdictRecord("g-s1", T0, HEX40("a"), { resourceScope: "scope-a" }));
      await filed(adminRepo, admin, verdictRecord("g-s2", T1, HEX40("b"), { resourceScope: "scope-b" }));
      await expect(
        worker.query("select team_brain.tb_supersede_verdict($1, $2, $3, $4, $5)", [
          "g-s1",
          "g-s2",
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB207" });
    });

    test("tb_supersede_verdict records relation + events + state atomically; a second supersession is refused (TB203)", async () => {
      await filed(adminRepo, admin, verdictRecord("g-h1", T0, HEX40("a")));
      await filed(adminRepo, admin, verdictRecord("g-h2", T1, HEX40("b")));
      await filed(adminRepo, admin, verdictRecord("g-h3", T2, HEX40("c")));
      await worker.query("select team_brain.tb_supersede_verdict($1, $2, $3, $4, $5)", [
        "g-h1",
        "g-h2",
        "t",
        "new head",
        T2,
      ]);
      const rel = await admin.query(
        `select count(*)::int as n from team_brain.obligation_supersessions
         where old_obligation_id = 'g-h1' and new_obligation_id = 'g-h2'`,
      );
      expect(rel.rows[0].n).toBe(1);
      const old = await admin.query(
        "select state from team_brain.obligations where obligation_id = 'g-h1'",
      );
      expect(old.rows[0].state).toBe("SUPERSEDED");
      const ev = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = 'g-h1' and event_type = 'SUPERSEDED'`,
      );
      expect(ev.rows[0].n).toBe(1);
      await expect(
        worker.query("select team_brain.tb_supersede_verdict($1, $2, $3, $4, $5)", [
          "g-h1",
          "g-h3",
          "t",
          "t",
          T3,
        ]),
      ).rejects.toMatchObject({ code: "TB203" });
    });

    test("tb_set_retention_disposition enforces the policy set (TB208)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ret"));
      await expect(
        worker.query("select team_brain.tb_set_retention_disposition($1, $2, $3, $4, $5)", [
          task.id,
          "whenever lol",
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB208" });
      // Refused: zero RETENTION_DECIDED events (TBP1-002C).
      const ev0 = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED'`,
        [task.id],
      );
      expect(ev0.rows[0].n).toBe(0);
      await worker.query("select team_brain.tb_set_retention_disposition($1, $2, $3, $4, $5)", [
        task.id,
        "RETAIN_1Y",
        "decider",
        "direct retention",
        T2,
      ]);
      const res = await admin.query(
        "select retention_disposition from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(res.rows[0].retention_disposition).toBe("RETAIN_1Y");
      // Fix round 3 (TBP1-002C): the direct call appends exactly one
      // RETENTION_DECIDED event carrying the supplied actor/reason.
      const ev = await admin.query(
        `select actor_principal, reason from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED'`,
        [task.id],
      );
      expect(ev.rows.length).toBe(1);
      expect(ev.rows[0].actor_principal).toBe("decider");
      expect(ev.rows[0].reason).toBe("direct retention");
    });

    test("transition functions refuse invalid transition metadata (TB224) and write nothing", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-meta"));
      await adminRepo.recordVerification(task.id, {
        verifier: "t",
        verifiedAt: T1,
        reason: "t",
        evidenceRefs: ["e1"],
      });
      // Blank actor on close.
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          task.id,
          ["e1"],
          "  ",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB224" });
      // Malformed claimed_at on close.
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          task.id,
          ["e1"],
          "t",
          "t",
          "not-a-timestamp",
        ]),
      ).rejects.toMatchObject({ code: "TB224" });
      const auth = await filed(adminRepo, admin, { ...taskRecord("g-meta-auth"), kind: "AUTHORIZATION" });
      // Blank reason on revoke.
      await expect(
        worker.query("select team_brain.tb_revoke_authorization($1, $2, $3, $4)", [
          auth.id,
          "t",
          "",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB224" });
      // Missing claimed_at on retention.
      await expect(
        worker.query("select team_brain.tb_set_retention_disposition($1, $2, $3, $4, $5)", [
          task.id,
          "RETAIN_1Y",
          "t",
          "t",
          null,
        ]),
      ).rejects.toMatchObject({ code: "TB224" });
      // Nothing changed, no transition events.
      const t = await admin.query(
        "select state from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(t.rows[0].state).toBe("OPEN");
      const a = await admin.query(
        "select state, retention_disposition from team_brain.obligations where obligation_id = $1",
        [auth.id],
      );
      expect(a.rows[0].state).toBe("OPEN");
      const ev = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where event_type in ('CLOSED', 'REVOKED', 'RETENTION_DECIDED')`,
      );
      expect(ev.rows[0].n).toBe(0);
    });

    test("tb_upsert_override refuses an unknown authority grant (TB215)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr"));
      await seedGrants(task.id);
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overridePayload({ authorityRef: "nope" }),
        ]),
      ).rejects.toMatchObject({ code: "TB215" });
    });

    test("tb_upsert_override refuses a revoked grant (TB217)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr"));
      await seedGrants(task.id);
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overridePayload({ authorityRef: "grant-revoked" }),
        ]),
      ).rejects.toMatchObject({ code: "TB217" });
    });

    test("tb_upsert_override refuses a grant not from Jason (TB216)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr"));
      await seedGrants(task.id);
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overridePayload({ authorityRef: "grant-mallory" }),
        ]),
      ).rejects.toMatchObject({ code: "TB216" });
    });

    test("tb_upsert_override refuses a grant bound to a different item (TB218)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr"));
      const other = await filed(adminRepo, admin, taskRecord("g-ovr-other"));
      await seedGrants(task.id);
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          other.id,
          overridePayload({ authorityRef: "grant-valid" }),
        ]),
      ).rejects.toMatchObject({ code: "TB218" });
    });

    test("tb_upsert_override accepts a valid Jason grant and stores the row", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr"));
      await seedGrants(task.id);
      await worker.query("select team_brain.tb_upsert_override($1, $2)", [
        task.id,
        overridePayload(),
      ]);
      const res = await admin.query(
        "select count(*)::int as n from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(res.rows[0].n).toBe(1);
    });

    test("tb_upsert_override refuses the probe payload {authorityRef, rank} and stores nothing (TBP1-002A)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr-probe"));
      await seedGrants(task.id);
      // The exact ChatGPT/Claude probe payload: valid grant + rank, but no
      // actor / recordedAt / reason. Round 2 persisted it verbatim and the
      // queue projection then failed INVALID_OVERRIDE.
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          JSON.stringify({ authorityRef: "grant-valid", rank: 1 }),
        ]),
      ).rejects.toMatchObject({ code: "TB220" });
      const res = await admin.query(
        "select count(*)::int as n from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(res.rows[0].n).toBe(0);
    });

    test("tb_upsert_override enforces the full structural contract (TB220/TB221/TB222, TBP1-002A)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr-struct"));
      await seedGrants(task.id);
      const cases = [
        // [payload, expected errcode]
        [overrideJson({}, ["actor"]), "TB220"],
        [overrideJson({}, ["reason"]), "TB220"],
        [overrideJson({ actor: " " }), "TB220"],
        [overrideJson({ reason: "" }), "TB220"],
        [overrideJson({ authorityRef: 42 }), "TB220"],
        [overrideJson({ authority: "Jason said so" }), "TB220"],
        [overrideJson({}, ["recordedAt"]), "TB221"],
        [overrideJson({ recordedAt: "not-a-date" }), "TB221"],
        [overrideJson({ recordedAt: "2026-02-30T00:00:00.000Z" }), "TB221"],
        [overrideJson({}, ["rank"]), "TB222"],
        [overrideJson({ rank: "1" }), "TB222"],
        [overrideJson({ rank: 1.5 }), "TB222"],
        [overrideJson({ rank: -1 }), "TB222"],
        ["[]", "TB220"],
        ['"just-a-string"', "TB220"],
      ];
      for (const [payload, code] of cases) {
        await expect(
          worker.query("select team_brain.tb_upsert_override($1, $2)", [task.id, payload]),
        ).rejects.toMatchObject({ code });
      }
      // Every refusal left state unchanged: no override row was stored.
      const res = await admin.query(
        "select count(*)::int as n from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(res.rows[0].n).toBe(0);
    });

    test("a refused tb_upsert_override preserves the prior override byte-for-byte (TBP1-002A)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr-keep"));
      await seedGrants(task.id);
      const good = overridePayload();
      await worker.query("select team_brain.tb_upsert_override($1, $2)", [task.id, good]);
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overrideJson({}, ["actor"]),
        ]),
      ).rejects.toMatchObject({ code: "TB220" });
      const res = await admin.query(
        "select override_json from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].override_json).toBe(good);
    });

    test("a valid full override payload is accepted and passes queue projection (TBP1-002A)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr-project"));
      await seedGrants(task.id);
      await worker.query("select team_brain.tb_upsert_override($1, $2)", [
        task.id,
        overridePayload(),
      ]);
      const res = await admin.query(
        "select override_json from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(res.rows.length).toBe(1);
      // The persisted payload must survive the JS queue projection — no
      // INVALID_OVERRIDE (the round-2 queue-poison failure mode).
      const { projectQueue } = await import("../queue/projection.mjs");
      const projection = projectQueue({
        obligations: [
          {
            id: task.id,
            kind: "TASK",
            filedAt: T0,
            state: "OPEN",
            override: JSON.parse(res.rows[0].override_json),
          },
        ],
        now: T3,
        trustedAuthorizations: [
          { id: "grant-valid", granter: "Jason", itemId: task.id, rank: 1, revoked: false },
        ],
      });
      expect(projection.overrides.length).toBe(1);
      expect(projection.overrides[0].rank).toBe(1);
      expect(projection.overrides[0].authorityRef).toBe("grant-valid");
    });

    // Fix round 4 (TBP1-002A.1): the timestamptz cast normalizes
    // out-of-range civil components (10:00:60Z, 24:00:00Z) and the JS
    // round-trip refuses 1-2-digit fractions ('.1Z') while the stored
    // string stays invalid — the string-first strict-UTC contract refuses
    // all of these with TB221 before any cast, and nothing is stored.
    test("tb_upsert_override refuses normalized-out-of-range and JS-rejected fractional timestamps (TB221, TBP1-002A.1)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ovr-ts"));
      await seedGrants(task.id);
      const probes = [
        "2026-10-21T10:00:60Z", // leap-second spelling: PG normalizes, JS refuses
        "2026-10-21T24:00:00Z", // hour 24: PG rolls to next day, JS refuses
        "2026-10-21T10:00:00.1Z", // 1-digit fraction: JS round-trip refuses
        "2026-10-21T10:00:00.12Z", // 2-digit fraction: JS round-trip refuses
        "2026-10-21T10:99:00Z", // minute 99
        "2026-13-01T10:00:00Z", // month 13
      ];
      for (const recordedAt of probes) {
        await expect(
          worker.query("select team_brain.tb_upsert_override($1, $2)", [
            task.id,
            overrideJson({ recordedAt }),
          ]),
        ).rejects.toMatchObject({ code: "TB221" });
      }
      // Every refusal stored nothing.
      const res = await admin.query(
        "select count(*)::int as n from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(res.rows[0].n).toBe(0);
      // The spellings the JS contract accepts are still accepted, and the
      // persisted payload passes queue projection (no MALFORMED_TIMESTAMP).
      const { projectQueue } = await import("../queue/projection.mjs");
      for (const recordedAt of ["2026-10-21T10:00:00Z", "2026-10-21T10:00:00.123Z"]) {
        await worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overrideJson({ recordedAt }),
        ]);
        const stored = await admin.query(
          "select override_json from team_brain.obligation_overrides where obligation_id = $1",
          [task.id],
        );
        const projection = projectQueue({
          obligations: [
            {
              id: task.id,
              kind: "TASK",
              filedAt: T0,
              state: "OPEN",
              override: JSON.parse(stored.rows[0].override_json),
            },
          ],
          now: T3,
          trustedAuthorizations: [
            { id: "grant-valid", granter: "Jason", itemId: task.id, rank: 1, revoked: false },
          ],
        });
        expect(projection.overrides.length).toBe(1);
      }
      // A timestamp refusal after a valid store preserves the prior
      // override byte-for-byte.
      const good = overrideJson({ recordedAt: "2026-10-21T10:00:00.123Z" });
      await worker.query("select team_brain.tb_upsert_override($1, $2)", [task.id, good]);
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overrideJson({ recordedAt: "2026-10-21T10:00:60Z" }),
        ]),
      ).rejects.toMatchObject({ code: "TB221" });
      const kept = await admin.query(
        "select override_json from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(kept.rows[0].override_json).toBe(good);
    });

    // Fix round 4 (TBP1-002A.1): the same string-first contract guards
    // claimed_at on the transition functions (TB224 path).
    test("transition functions refuse normalized-out-of-range and JS-rejected fractional claimed_at (TB224, TBP1-002A.1)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-meta-ts"));
      for (const claimedAt of [
        "2026-10-21T10:00:60Z",
        "2026-10-21T24:00:00Z",
        "2026-10-21T10:00:00.1Z",
      ]) {
        await expect(
          worker.query("select team_brain.tb_set_retention_disposition($1, $2, $3, $4, $5)", [
            task.id,
            "RETAIN_1Y",
            "t",
            "t",
            claimedAt,
          ]),
        ).rejects.toMatchObject({ code: "TB224" });
      }
      // Refusals wrote nothing: no event, disposition and version untouched.
      const ev = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED'`,
        [task.id],
      );
      expect(ev.rows[0].n).toBe(0);
      const st = await admin.query(
        "select retention_disposition, row_version from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(st.rows[0].retention_disposition).toBe("PERMANENT");
      expect(Number(st.rows[0].row_version)).toBe(1);
    });

    // Fix round 4 (TBP1-002A.2 / TBP1-002B): btrim() strips only 0x20; the
    // DB boundary now enforces the JS String.trim() whitespace class
    // (TAB/LF/VT/FF/CR + U+00A0 U+1680 U+2000–U+200A U+2028 U+2029 U+202F
    // U+205F U+3000 U+FEFF) via team_brain.tb_is_blank. Whitespace-only
    // actor/reason/refs/members refuse; ordinary nonblank values still
    // pass and are stored byte-for-byte (no trim-and-store).
    test("nonblank checks enforce the JS trim() whitespace class at the DB boundary (TBP1-002A.2/002B)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ws"));
      await seedGrants(task.id);
      const ws = {
        tab: "\u0009",
        lf: "\u000a",
        nbsp: "\u00a0",
        emspace: "\u2003",
        crff: "\u000d\u000c",
      };
      // actor/reason on the override path (TB220).
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overrideJson({ actor: ws.tab }),
        ]),
      ).rejects.toMatchObject({ code: "TB220" });
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overrideJson({ reason: ws.lf }),
        ]),
      ).rejects.toMatchObject({ code: "TB220" });
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overrideJson({ actor: ws.nbsp }),
        ]),
      ).rejects.toMatchObject({ code: "TB220" });
      await expect(
        worker.query("select team_brain.tb_upsert_override($1, $2)", [
          task.id,
          overrideJson({ reason: ws.emspace }),
        ]),
      ).rejects.toMatchObject({ code: "TB220" });
      const ovr = await admin.query(
        "select count(*)::int as n from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(ovr.rows[0].n).toBe(0);
      // actor/reason on the transition path (TB224).
      await expect(
        worker.query("select team_brain.tb_set_retention_disposition($1, $2, $3, $4, $5)", [
          task.id,
          "RETAIN_1Y",
          ws.tab,
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB224" });
      await expect(
        worker.query("select team_brain.tb_set_retention_disposition($1, $2, $3, $4, $5)", [
          task.id,
          "RETAIN_1Y",
          "t",
          ws.nbsp,
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB224" });
      // Requested refs must be nonblank (TB205) and verification evidence
      // members must be valid reference strings (TB223).
      const closeTask = await filed(adminRepo, admin, taskRecord("g-ws-close"));
      await insertVerificationEvent(closeTask.id, JSON.stringify([ws.tab]));
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          closeTask.id,
          ["artifact"],
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB223" });
      const closeRef = await filed(adminRepo, admin, taskRecord("g-ws-ref"));
      await insertVerificationEvent(closeRef.id, JSON.stringify(["artifact"]));
      await expect(
        worker.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
          closeRef.id,
          [ws.tab],
          "t",
          "t",
          T2,
        ]),
      ).rejects.toMatchObject({ code: "TB205" });
      // Refusals changed nothing: both tasks still OPEN, no transition events.
      for (const id of [closeTask.id, closeRef.id]) {
        expect(await obligationState(id)).toBe("OPEN");
      }
      const ev = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = any($1) and event_type = 'CLOSED'`,
        [[closeTask.id, closeRef.id]],
      );
      expect(ev.rows[0].n).toBe(0);
      // Positive: padded-but-nonblank values are accepted AND stored
      // verbatim — the boundary never trims and restores evidence identity.
      const padded = overrideJson({ actor: " padded actor ", reason: " padded reason " });
      await worker.query("select team_brain.tb_upsert_override($1, $2)", [task.id, padded]);
      const stored = await admin.query(
        "select override_json from team_brain.obligation_overrides where obligation_id = $1",
        [task.id],
      );
      expect(stored.rows[0].override_json).toBe(padded);
    });

    // Fix round 4 (TBP1-002C): retention idempotency is keyed by the
    // OPERATION — retention:<obligation_id>:<actor>:<reason>:<claimed_at>.
    // Distinct decisions (A→B→A) each persist exactly one immutable event;
    // an exact replay is an idempotent no-op (no new event, no version
    // increment, no raw 23505); the same operation identity with a
    // different disposition refuses atomically with TB225.
    test("tb_set_retention_disposition is idempotent by operation identity: A→B→A, exact replay, TB225 conflict (TBP1-002C)", async () => {
      const task = await filed(adminRepo, admin, taskRecord("g-ret-idem"));
      const TA = "2026-10-15T18:10:00.000Z";
      const TB = "2026-10-15T18:11:00.000Z";
      const TC = "2026-10-15T18:12:00.000Z";
      const call = (disposition, actor, reason, claimedAt) =>
        worker.query("select team_brain.tb_set_retention_disposition($1, $2, $3, $4, $5)", [
          task.id,
          disposition,
          actor,
          reason,
          claimedAt,
        ]);
      await call("RETAIN_1Y", "reviewer", "first decision", TA);
      await call("PERMANENT", "reviewer", "second decision", TB);
      await call("RETAIN_1Y", "reviewer", "third decision", TC);
      // A→B→A persisted three events with operation keys and per-event
      // dispositions; the projection reflects the last decision.
      const events = await admin.query(
        `select idempotency_key, retention_disposition from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED' order by seq`,
        [task.id],
      );
      expect(events.rows.map((r) => r.idempotency_key)).toEqual([
        `retention:${task.id}:reviewer:first decision:${TA}`,
        `retention:${task.id}:reviewer:second decision:${TB}`,
        `retention:${task.id}:reviewer:third decision:${TC}`,
      ]);
      expect(events.rows.map((r) => r.retention_disposition)).toEqual([
        "RETAIN_1Y",
        "PERMANENT",
        "RETAIN_1Y",
      ]);
      const after3 = await admin.query(
        "select retention_disposition, row_version from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(after3.rows[0].retention_disposition).toBe("RETAIN_1Y");
      expect(Number(after3.rows[0].row_version)).toBe(4);
      // Exact replay of the first operation: success, no new event, no
      // version increment.
      await call("RETAIN_1Y", "reviewer", "first decision", TA);
      const replayed = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED'`,
        [task.id],
      );
      expect(replayed.rows[0].n).toBe(3);
      const afterReplay = await admin.query(
        "select retention_disposition, row_version from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(afterReplay.rows[0].retention_disposition).toBe("RETAIN_1Y");
      expect(Number(afterReplay.rows[0].row_version)).toBe(4);
      // Same operation identity, different disposition: named TB225
      // refusal, atomically — nothing persisted, nothing changed.
      await expect(call("PERMANENT", "reviewer", "first decision", TA)).rejects.toMatchObject({
        code: "TB225",
      });
      const conflicted = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED'`,
        [task.id],
      );
      expect(conflicted.rows[0].n).toBe(3);
      const afterConflict = await admin.query(
        "select retention_disposition, row_version from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(afterConflict.rows[0].retention_disposition).toBe("RETAIN_1Y");
      expect(Number(afterConflict.rows[0].row_version)).toBe(4);
    });

    // Fix round 4 (TBP1-002C): the adapter inherits the operation
    // idempotency — A→B→A through setRetentionDisposition, retry no-op,
    // and the TB225 conflict surfaces as typed CONFLICTING_REPLAY.
    test("adapter setRetentionDisposition: A→B→A persists three events, retry is a no-op, conflict maps to CONFLICTING_REPLAY (TBP1-002C)", async () => {
      const task = await filed(workerRepo, admin, taskRecord("g-ret-adapter"));
      const TA = "2026-10-15T18:20:00.000Z";
      const TB = "2026-10-15T18:21:00.000Z";
      const TC = "2026-10-15T18:22:00.000Z";
      const set = (disposition, reason, recordedAt) =>
        workerRepo.setRetentionDisposition(task.id, {
          actor: "reviewer",
          recordedAt,
          reason,
          disposition,
        });
      await set("RETAIN_1Y", "first decision", TA);
      await set("PERMANENT", "second decision", TB);
      await set("RETAIN_1Y", "third decision", TC);
      const events = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED'`,
        [task.id],
      );
      expect(events.rows[0].n).toBe(3);
      const after3 = await admin.query(
        "select retention_disposition, row_version from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(after3.rows[0].retention_disposition).toBe("RETAIN_1Y");
      const v3 = Number(after3.rows[0].row_version);
      // Exact retry: still three events, version untouched.
      await set("RETAIN_1Y", "first decision", TA);
      const retried = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED'`,
        [task.id],
      );
      expect(retried.rows[0].n).toBe(3);
      const afterRetry = await admin.query(
        "select row_version from team_brain.obligations where obligation_id = $1",
        [task.id],
      );
      expect(Number(afterRetry.rows[0].row_version)).toBe(v3);
      // Changed payload under the same operation: typed conflict.
      await expect(set("PERMANENT", "first decision", TA)).rejects.toMatchObject({
        code: "CONFLICTING_REPLAY",
      });
      const afterConflict = await admin.query(
        `select count(*)::int as n from team_brain.obligation_events
         where obligation_id = $1 and event_type = 'RETENTION_DECIDED'`,
        [task.id],
      );
      expect(afterConflict.rows[0].n).toBe(3);
    });

    test("tb_record_obligation_supersession refuses verdict endpoints (TB212)", async () => {
      await filed(adminRepo, admin, verdictRecord("g-r1", T0, HEX40("a")));
      await filed(adminRepo, admin, verdictRecord("g-r2", T1, HEX40("b")));
      await expect(
        worker.query("select team_brain.tb_record_obligation_supersession($1, $2, $3, $4)", [
          "g-r1",
          "g-r2",
          "t",
          "t",
        ]),
      ).rejects.toMatchObject({ code: "TB212" });
    });

    test("tb_mark_superseded no longer exists (unguarded marker removed in fix round 2)", async () => {
      const res = await admin.query(
        `select count(*)::int as n from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'team_brain' and p.proname = 'tb_mark_superseded'`,
      );
      expect(res.rows[0].n).toBe(0);
    });
  });

  describe("adapter provenance boundary (normalized filing contract)", () => {
    test("filing with a bare { repo, path } source is refused as INCOMPLETE_PROVENANCE and persists nothing", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await expect(
          repo.fileObligation({
            ...taskRecord("pv-bare"),
            source: { repo: "onyxgolden/marketplace409", path: "x.md" },
          }),
        ).rejects.toMatchObject({ code: "INCOMPLETE_PROVENANCE" });
        const res = await pool.query(
          "select count(*)::int as n from team_brain.obligations where obligation_id = 'pv-bare'",
        );
        expect(res.rows[0].n).toBe(0);
      } finally {
        await pool.end();
      }
    });

    test("filing with a complete but UNREGISTERED source identity is refused as INCOMPLETE_PROVENANCE", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await expect(
          repo.fileObligation({
            ...taskRecord("pv-unreg"),
            source: {
              repo: "onyxgolden/marketplace409",
              path: "x.md",
              commit: HEX40("c"),
              blob: HEX40("d"),
            },
          }),
        ).rejects.toMatchObject({ code: "INCOMPLETE_PROVENANCE" });
        const res = await pool.query(
          "select count(*)::int as n from team_brain.obligations where obligation_id = 'pv-unreg'",
        );
        expect(res.rows[0].n).toBe(0);
      } finally {
        await pool.end();
      }
    });

    test("registerSourceObject then filing with that exact identity succeeds and binds the registered source_id", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const reg = await repo.registerSourceObject({
          sourceId: "src-pv-reg",
          repo: "onyxgolden/marketplace409",
          path: "results/team-brain/pv-reg.md",
          commit: HEX40("c"),
          blob: HEX40("d"),
          byteLength: 42,
          contentSha256: createHash("sha256").update("pv-reg").digest("hex"),
          sourceClass: "TEST_FIXTURE",
          observedAt: T0,
          transportReceipt: "test-transport",
        });
        expect(reg.sourceId).toBe("src-pv-reg");
        const ob = await repo.fileObligation({
          ...taskRecord("pv-reg"),
          source: { repo: reg.repo, path: reg.path, commit: reg.commit, blob: reg.blob },
        });
        const raw = await pool.query(
          "select source_id from team_brain.obligations where obligation_id = 'pv-reg'",
        );
        expect(raw.rows[0].source_id).toBe("src-pv-reg");
        expect(ob.source.commit).toBe(HEX40("c"));
        expect(ob.source.blob).toBe(HEX40("d"));
      } finally {
        await pool.end();
      }
    });

    test("filing with an unknown sourceId is refused as UNKNOWN_SOURCE", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        await expect(
          repo.fileObligation({ ...taskRecord("pv-unknown"), sourceId: "src-does-not-exist" }),
        ).rejects.toMatchObject({ code: "UNKNOWN_SOURCE" });
      } finally {
        await pool.end();
      }
    });

    test("filing without an owner is refused", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const s = await seedSourceObject(pool, "pv-noowner");
        const rec = { ...taskRecord("pv-noowner"), sourceId: s.sourceId };
        delete rec.owner;
        await expect(repo.fileObligation(rec)).rejects.toThrow(/owner/i);
      } finally {
        await pool.end();
      }
    });

    test("registerSourceObject refuses to rebind a sourceId to a different identity", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const base = {
          sourceId: "src-pv-rebind",
          repo: "onyxgolden/marketplace409",
          path: "results/team-brain/pv-rebind.md",
          commit: HEX40("c"),
          blob: HEX40("d"),
          byteLength: 42,
          contentSha256: createHash("sha256").update("pv-rebind").digest("hex"),
          sourceClass: "TEST_FIXTURE",
          observedAt: T0,
          transportReceipt: "test-transport",
        };
        await repo.registerSourceObject(base);
        await expect(
          repo.registerSourceObject({ ...base, blob: HEX40("e") }),
        ).rejects.toThrow(/different identity/);
      } finally {
        await pool.end();
      }
    });

    test("a filed VERDICT row carries reviewed_head, resource_repo, and owner in the normalized columns", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const s = await seedSourceObject(pool, "pv-verdict");
        await repo.fileObligation({
          id: "pv-verdict",
          kind: "VERDICT",
          filedAt: T0,
          owner: "p1-test",
          sourceId: s.sourceId,
          resourceRepo: "onyxgolden/marketplace409",
          reviewedHead: HEX40("e"),
          retentionDisposition: "UNTIL_SUPERSEDED_AT_NEW_HEAD",
          filedBy: "t",
          filedReason: "t",
        });
        const raw = await pool.query(
          `select reviewed_head, resource_repo, owner from team_brain.obligations
           where obligation_id = 'pv-verdict'`,
        );
        expect(raw.rows[0].reviewed_head).toBe(HEX40("e"));
        expect(raw.rows[0].resource_repo).toBe("onyxgolden/marketplace409");
        expect(raw.rows[0].owner).toBeTruthy();
      } finally {
        await pool.end();
      }
    });

    test("a refused supersession rolls back: no new obligation row, no supersession relation", async () => {
      const pool = await freshMigratedPool();
      try {
        const { createPostgresRepository } = await import("../postgres/repository.mjs");
        const repo = createPostgresRepository(pool);
        const sOld = await seedSourceObject(pool, "pv-old");
        await repo.fileObligation({
          id: "pv-old",
          kind: "VERDICT",
          filedAt: T0,
          owner: "p1-test",
          sourceId: sOld.sourceId,
          resourceRepo: "onyxgolden/marketplace409",
          reviewedHead: HEX40("a"),
          retentionDisposition: "UNTIL_SUPERSEDED_AT_NEW_HEAD",
          filedBy: "t",
          filedReason: "t",
        });
        const sNew = await seedSourceObject(pool, "pv-new");
        await expect(
          repo.supersedeVerdict(
            "pv-old",
            {
              id: "pv-new",
              kind: "VERDICT",
              filedAt: T1,
              owner: "p1-test",
              sourceId: sNew.sourceId,
              resourceRepo: "onyxgolden/marketplace409",
              reviewedHead: HEX40("a"),
              retentionDisposition: "UNTIL_SUPERSEDED_AT_NEW_HEAD",
              filedBy: "t",
              filedReason: "t",
            },
            { actor: "t", recordedAt: T1, reason: "same head" },
          ),
        ).rejects.toMatchObject({ code: "SAME_HEAD_SUPERSESSION" });
        const rows = await pool.query(
          "select count(*)::int as n from team_brain.obligations where obligation_id = 'pv-new'",
        );
        expect(rows.rows[0].n).toBe(0);
        const rel = await pool.query(
          `select count(*)::int as n from team_brain.obligation_supersessions
           where old_obligation_id = 'pv-old' or new_obligation_id = 'pv-new'`,
        );
        expect(rel.rows[0].n).toBe(0);
      } finally {
        await pool.end();
      }
    });
  });
});
