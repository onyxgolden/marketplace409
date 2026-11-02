// Team Brain P7 — disabled-worker service package tests.
// Isolated PGlite databases only; nothing production, no activation.
// Covers: config validation (fails loud), connection trust rules,
// worker cycles (completed / replay / stop / overlap / not-due /
// failed), observer freshness, health probes, backup/restore parity,
// reconcile-only reporting, release pins, no-secrets scan, template
// validity, and the CLI surface.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createRepository } from "../ledger/repository.mjs";
import { migrate as migrateP5, createRetrievalRepository } from "../retrieval/repository.mjs";
import { migrateP6 } from "../consolidation/engine.mjs";
import {
  CONFIG_SCHEMA_VERSION,
  validateWorkerConfig,
} from "../worker/config.mjs";
import {
  CONSOLIDATOR_ROLE,
  READER_ROLE,
  resolveTls,
  createTrustedPool,
  withTrustedClient,
} from "../postgres/connection.mjs";
import {
  migrateWorker,
  createWorker,
  loadWorkerSchemaSql,
} from "../worker/worker.mjs";
import { createObserver } from "../worker/observer.mjs";
import { runHealthProbes } from "../worker/health.mjs";
import { exportBackup, importRestore, verifyParity, pruneBackups } from "../worker/backup.mjs";
import { reconcileReport } from "../worker/reconcile.mjs";
import { PACKAGE_VERSION, buildReleaseManifest } from "../worker/release.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const it60 = (name, fn) => it(name, fn, 60000);

const WORKER_PW = "TB_P7_TEST_WORKER_PW";
const READER_PW = "TB_P7_TEST_READER_PW";

function rawConfig(overrides = {}) {
  return {
    workerId: "tb-worker-test",
    database: {
      host: "localhost",
      port: 5432,
      database: "team_brain_test",
      user: "tb_consolidator",
      passwordEnv: WORKER_PW,
      ssl: false,
      allowInsecureLocal: true,
    },
    observer: {
      host: "localhost",
      port: 5432,
      database: "team_brain_test",
      user: "tb_reader",
      passwordEnv: READER_PW,
      ssl: false,
      allowInsecureLocal: true,
    },
    principal: "tb-worker",
    ...overrides,
  };
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

async function migrateAll(db) {
  const repo = createRepository(db);
  await repo.migrate();
  await migrateP5(db);
  await migrateP6(db);
  await migrateWorker(db);
}

async function truncateAll(db) {
  await db.query("RESET ROLE").catch(() => undefined);
  await db.query(
    `TRUNCATE tb_consolidated_facts, tb_consolidation_proposals,
      tb_consolidation_checkpoints, tb_consolidation_audit,
      tb_consolidation_runs, tb_consolidation_run_bindings,
      tb_worker_heartbeats, tb_working_set, tb_episode_grants,
      tb_pins, tb_episode_events, tb_episodes,
      team_brain_obligation_dependencies, team_brain_obligation_events,
      team_brain_handoffs, team_brain_handoff_events,
      team_brain_obligations CASCADE`,
  );
  await db.query("UPDATE tb_consolidation_lease SET holder = NULL, run_date = NULL WHERE id = 1");
  await db.query("UPDATE tb_retrieval_revisions SET revision = 0 WHERE id = 1");
}

const CYCLE_NOW = "2026-11-02T10:00:00Z"; // 04:00 CST — past the 03:00 Chicago slot.
const CYCLE_DATE = "2026-11-02";

beforeAll(() => {
  process.env[WORKER_PW] = "test-worker-password-value";
  process.env[READER_PW] = "test-reader-password-value";
});
afterAll(() => {
  delete process.env[WORKER_PW];
  delete process.env[READER_PW];
});

describe("P7 config validation", () => {
  it("valid template-shaped config passes and never carries a password value", () => {
    const cfg = validateWorkerConfig(rawConfig());
    expect(cfg.configSchemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(cfg.database.user).toBe(CONSOLIDATOR_ROLE);
    expect(cfg.observer.user).toBe(READER_ROLE);
    expect(JSON.stringify(cfg)).not.toContain("test-worker-password-value");
    expect(JSON.stringify(cfg)).not.toContain("test-reader-password-value");
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("rejects unknown keys at any level", () => {
    expect(() => validateWorkerConfig(rawConfig({ surprise: true }))).toThrow(/UNKNOWN_CONFIG_KEY/);
    expect(() => validateWorkerConfig(rawConfig({ database: { ...rawConfig().database, surprise: 1 } }))).toThrow(/UNKNOWN_CONFIG_KEY/);
  });

  it("rejects any inline password key anywhere", () => {
    expect(() => validateWorkerConfig(rawConfig({ database: { ...rawConfig().database, password: "x" } }))).toThrow(/PASSWORD_IN_CONFIG/);
    expect(() => validateWorkerConfig(rawConfig({ observer: { ...rawConfig().observer, password: "x" } }))).toThrow(/PASSWORD_IN_CONFIG/);
  });

  it("rejects wrong role bindings", () => {
    expect(() => validateWorkerConfig(rawConfig({ database: { ...rawConfig().database, user: "tb_reader" } }))).toThrow(/BAD_WORKER_ROLE/);
    expect(() => validateWorkerConfig(rawConfig({ observer: { ...rawConfig().observer, user: "tb_consolidator" } }))).toThrow(/BAD_OBSERVER_ROLE/);
  });

  it("rejects non-Chicago slot, bad ports, bad retention, bad schema version", () => {
    expect(() => validateWorkerConfig(rawConfig({ slot: { timeZone: "America/New_York", hour: 3, minute: 0 } }))).toThrow(/BAD_SLOT/);
    expect(() => validateWorkerConfig(rawConfig({ database: { ...rawConfig().database, port: 0 } }))).toThrow(/BAD_PORT/);
    expect(() => validateWorkerConfig(rawConfig({ database: { ...rawConfig().database, port: 70000 } }))).toThrow(/BAD_PORT/);
    expect(() => validateWorkerConfig(rawConfig({ retention: { dailyVersions: 0, rpoHours: 24, rtoHours: 4 } }))).toThrow(/BAD_RETENTION/);
    expect(() => validateWorkerConfig(rawConfig({ retention: { dailyVersions: 30, rpoHours: 12, rtoHours: 4 } }))).toThrow(/BAD_RETENTION/);
    expect(() => validateWorkerConfig(rawConfig({ retention: { dailyVersions: 30, rpoHours: 24, rtoHours: 8 } }))).toThrow(/BAD_RETENTION/);
    expect(() => validateWorkerConfig(rawConfig({ configSchemaVersion: "6.0" }))).toThrow(/BAD_SCHEMA_VERSION/);
  });

  it("rejects missing passwordEnv env var", () => {
    expect(() => validateWorkerConfig(rawConfig({ database: { ...rawConfig().database, passwordEnv: "TB_P7_TEST_DEFINITELY_UNSET_XYZ" } }))).toThrow(/MISSING_PASSWORD_ENV/);
  });

  it("rejects empty workerId / principal", () => {
    expect(() => validateWorkerConfig(rawConfig({ workerId: "" }))).toThrow(/BAD_WORKER_ID/);
    expect(() => validateWorkerConfig(rawConfig({ principal: "" }))).toThrow(/BAD_PRINCIPAL/);
  });
});

describe("P7 connection trust rules", () => {
  it("resolveTls: localhost insecure needs the explicit flag, remote needs verified TLS", () => {
    expect(() => resolveTls({ host: "localhost", ssl: false })).toThrow(/TLS_REQUIRED/);
    expect(resolveTls({ host: "localhost", ssl: false, allowInsecureLocal: true })).toBe(false);
    expect(() => resolveTls({ host: "db.example.com", ssl: false })).toThrow(/TLS_REQUIRED/);
    expect(resolveTls({ host: "db.example.com", ssl: true })).toEqual({ rejectUnauthorized: true });
    expect(() => resolveTls({ host: "db.example.com", ssl: { rejectUnauthorized: false } })).toThrow(/TLS_REQUIRED/);
  });

  it("createTrustedPool refuses role labels, user mismatch, missing env, missing factory", () => {
    const factory = async () => ({ fake: true });
    const opts = { expectedRole: "tb_consolidator", createPool: factory };
    expect(() => createTrustedPool({ host: "localhost", user: "tb_consolidator", passwordEnv: WORKER_PW, role: "tb_reader" }, opts)).toThrow(/ROLE_LABEL_REFUSED/);
    expect(() => createTrustedPool({ host: "localhost", user: "tb_reader", passwordEnv: WORKER_PW }, opts)).toThrow(/ROLE_MISMATCH/);
    expect(() => createTrustedPool({ host: "localhost", user: "tb_consolidator", passwordEnv: "TB_P7_TEST_DEFINITELY_UNSET_XYZ" }, opts)).toThrow(/MISSING_CREDENTIAL/);
    expect(() => createTrustedPool({ host: "localhost", user: "tb_consolidator", passwordEnv: WORKER_PW }, { expectedRole: "tb_consolidator" })).toThrow(/NO_POOL_FACTORY/);
  });

  it("withTrustedClient runs the function on a verified client and always releases", async () => {
    let released = 0;
    const client = {
      query: async () => ({ rows: [{ current_user: "tb_consolidator" }] }),
      release: () => { released += 1; },
    };
    const pool = { connect: async () => client };
    const out = await withTrustedClient(pool, "tb_consolidator", async () => "ran");
    expect(out).toBe("ran");
    expect(released).toBe(1);
    const bad = {
      query: async () => ({ rows: [{ current_user: "tb_reader" }] }),
      release: () => { released += 1; },
    };
    await expect(withTrustedClient({ connect: async () => bad }, "tb_consolidator", async () => "ran")).rejects.toThrow(/ROLE_DENIED/);
    expect(released).toBe(2);
  });
});

describe("P7 worker cycles", () => {
  let db;
  beforeAll(async () => {
    db = new PGlite();
    await migrateAll(db);
    await db.exec(readFileSync(join(HERE, "..", "postgres", "roles.sql"), "utf8"));
  }, 60000);
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.close();
  });

  async function seedAndRun(nowIso) {
    // Seeding needs the owner handle: a previous cycle in this test
    // may have left the connection SET ROLE tb_consolidator.
    await db.query("RESET ROLE");
    const repo = createRetrievalRepository(db);
    await repo.captureEpisode(episode({ title: "Episode A" }));
    await repo.captureEpisode(episode({ title: "Episode B" }));
    await db.query("SET ROLE tb_consolidator");
    const worker = createWorker(db, validateWorkerConfig(rawConfig()));
    return worker.runCycle({ nowIso });
  }

  it60("completed cycle writes a COMPLETED heartbeat with a receipt hash", async () => {
    const out = await seedAndRun(CYCLE_NOW);
    expect(out.completed).toBe(true);
    expect(out.replayed).toBe(false);
    const { rows } = await db.query("SELECT state, receipt_hash FROM tb_worker_heartbeats ORDER BY id DESC LIMIT 1");
    expect(rows[0].state).toBe("COMPLETED");
    // The worker records the engine receipt's sha32 id (32 hex chars).
    expect(rows[0].receipt_hash).toMatch(/^[0-9a-f]{32}$/);
    const facts = await db.query("SELECT COUNT(*) AS n FROM tb_consolidated_facts");
    expect(Number(facts.rows[0].n)).toBeGreaterThan(0);
    const runs = await db.query("SELECT state FROM tb_consolidation_runs WHERE run_date = $1", [CYCLE_DATE]);
    expect(runs.rows[0].state).toBe("COMPLETED");
  });

  it60("second same-date cycle replays without duplicating facts", async () => {
    await seedAndRun(CYCLE_NOW);
    const before = await db.query("SELECT COUNT(*) AS n FROM tb_consolidated_facts");
    const out = await seedAndRun(CYCLE_NOW);
    expect(out.completed).toBe(true);
    expect(out.replayed).toBe(true);
    const after = await db.query("SELECT COUNT(*) AS n FROM tb_consolidated_facts");
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n));
  });

  it60("stop file stops the cycle with a STOPPED heartbeat and zero facts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-p7-stop-"));
    const stopFile = join(dir, "stop");
    writeFileSync(stopFile, "operator stop\n");
    await db.query("SET ROLE tb_consolidator");
    const worker = createWorker(db, validateWorkerConfig(rawConfig({ stopFile })));
    const out = await worker.runCycle({ nowIso: CYCLE_NOW });
    expect(out.stopped).toBe(true);
    const { rows } = await db.query("SELECT state FROM tb_worker_heartbeats ORDER BY id DESC LIMIT 1");
    expect(rows[0].state).toBe("STOPPED");
    const facts = await db.query("SELECT COUNT(*) AS n FROM tb_consolidated_facts");
    expect(Number(facts.rows[0].n)).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it60("held lease refuses overlap with a REFUSED_OVERLAP heartbeat", async () => {
    await db.query("UPDATE tb_consolidation_lease SET holder = 'other-run', run_date = $1 WHERE id = 1", [CYCLE_DATE]);
    await db.query("SET ROLE tb_consolidator");
    const worker = createWorker(db, validateWorkerConfig(rawConfig()));
    const out = await worker.runCycle({ nowIso: CYCLE_NOW });
    expect(out.refusedOverlap).toBe(true);
    const { rows } = await db.query("SELECT state FROM tb_worker_heartbeats ORDER BY id DESC LIMIT 1");
    expect(rows[0].state).toBe("REFUSED_OVERLAP");
    const facts = await db.query("SELECT COUNT(*) AS n FROM tb_consolidated_facts");
    expect(Number(facts.rows[0].n)).toBe(0);
  });

  it60("pre-slot cycle reports notDue and writes no heartbeat", async () => {
    await db.query("SET ROLE tb_consolidator");
    const worker = createWorker(db, validateWorkerConfig(rawConfig()));
    const out = await worker.runCycle({ nowIso: "2026-11-02T08:00:00Z" });
    expect(out.notDue).toBe(true);
    const { rows } = await db.query("SELECT COUNT(*) AS n FROM tb_worker_heartbeats");
    expect(Number(rows[0].n)).toBe(0);
  });

  it60("engine failure writes a FAILED heartbeat (detail is name:code only) and rethrows", async () => {
    const boom = Object.assign(new Error("boom"), { code: "TEST_BOOM" });
    const worker = createWorker(db, validateWorkerConfig(rawConfig()), {
      engineFactory: () => ({ runConsolidation: async () => { throw boom; } }),
    });
    await expect(worker.runCycle({ nowIso: CYCLE_NOW })).rejects.toThrow("boom");
    const { rows } = await db.query("SELECT state, detail FROM tb_worker_heartbeats ORDER BY id DESC LIMIT 1");
    expect(rows[0].state).toBe("FAILED");
    expect(rows[0].detail).toBe("Error:TEST_BOOM");
  });
});

describe("P7 observer freshness", () => {
  let db;
  let observer;
  beforeAll(async () => {
    db = new PGlite();
    await migrateAll(db);
    await db.exec(readFileSync(join(HERE, "..", "postgres", "roles.sql"), "utf8"));
    observer = createObserver(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });

  it60("fresh after a COMPLETED heartbeat, stale after 26h, STOPPED not fresh, none not fresh", async () => {
    await truncateAll(db);
    expect((await observer.freshness("tb-worker-test", { nowIso: CYCLE_NOW })).fresh).toBe(false);
    const repo = createRetrievalRepository(db);
    await repo.captureEpisode(episode({ title: "Episode A" }));
    await db.query("SET ROLE tb_consolidator");
    const worker = createWorker(db, validateWorkerConfig(rawConfig()));
    await worker.runCycle({ nowIso: CYCLE_NOW });
    await db.query("RESET ROLE");
    const fresh = await observer.freshness("tb-worker-test", { nowIso: "2026-11-02T11:00:00Z" });
    expect(fresh.fresh).toBe(true);
    const stale = await observer.freshness("tb-worker-test", { nowIso: "2026-11-05T10:00:00Z" });
    expect(stale.fresh).toBe(false);
    const latest = await observer.latestHeartbeat("tb-worker-test");
    expect(latest.state).toBe("COMPLETED");
    await db.query("INSERT INTO tb_worker_heartbeats (worker_id, recorded_at, run_date, state) VALUES ('tb-worker-test', '2026-11-03T10:00:00Z', '2026-11-03', 'STOPPED')");
    const stopped = await observer.freshness("tb-worker-test", { nowIso: "2026-11-03T11:00:00Z" });
    expect(stopped.fresh).toBe(false);
  });
});

describe("P7 health probes", () => {
  let db;
  beforeAll(async () => {
    db = new PGlite();
    await migrateAll(db);
    await db.exec(readFileSync(join(HERE, "..", "postgres", "roles.sql"), "utf8"));
    const repo = createRetrievalRepository(db);
    await repo.captureEpisode(episode({ title: "Episode A" }));
    await db.query("SET ROLE tb_consolidator");
    const worker = createWorker(db, validateWorkerConfig(rawConfig()));
    await worker.runCycle({ nowIso: CYCLE_NOW });
    await db.query("RESET ROLE");
  }, 60000);
  afterAll(async () => {
    await db.close();
  });

  const gitOk = async () => ({ available: true, version: "git test 2.0" });

  it60("healthy fixture reports PASS on every probe", async () => {
    const report = await runHealthProbes({
      db,
      readerDb: db,
      observer: createObserver(db),
      config: validateWorkerConfig(rawConfig()),
      workerId: "tb-worker-test",
      nowIso: "2026-11-02T11:00:00Z",
      gitCheck: gitOk,
    });
    expect(report.status).toBe("PASS");
    for (const probe of Object.values(report.probes)) {
      expect(probe.status, `probe ${probe.name} was ${probe.status}`).toBe("PASS");
    }
    expect(report.probes.backlogWatermark.backlogEpisodes).toBe(0);
  });

  it60("absent provenance adapter is visibly UNQUALIFIED", async () => {
    const report = await runHealthProbes({
      db,
      readerDb: null,
      observer: createObserver(db),
      config: validateWorkerConfig(rawConfig()),
      workerId: "tb-worker-test",
      nowIso: "2026-11-02T11:00:00Z",
      gitCheck: gitOk,
    });
    expect(report.status).toBe("UNQUALIFIED");
    expect(report.probes.provenanceAdapter.status).toBe("UNQUALIFIED");
  });

  it60("unavailable git check fails the availability probe", async () => {
    const report = await runHealthProbes({
      db,
      readerDb: db,
      observer: createObserver(db),
      config: validateWorkerConfig(rawConfig()),
      workerId: "tb-worker-test",
      nowIso: "2026-11-02T11:00:00Z",
      gitCheck: async () => ({ available: false, reason: "git missing" }),
    });
    expect(report.status).toBe("FAIL");
    expect(report.probes.dbGitAvailability.status).toBe("FAIL");
  });

  it60("stale heartbeat fails the freshness probe", async () => {
    const report = await runHealthProbes({
      db,
      readerDb: db,
      observer: createObserver(db),
      config: validateWorkerConfig(rawConfig()),
      workerId: "tb-worker-test",
      nowIso: "2026-11-05T10:00:00Z",
      gitCheck: gitOk,
    });
    expect(report.status).toBe("FAIL");
    expect(report.probes.heartbeatFreshness.status).toBe("FAIL");
  });
});

describe("P7 backup, restore, prune", () => {
  let source;
  beforeAll(async () => {
    source = new PGlite();
    await migrateAll(source);
    const repo = createRetrievalRepository(source);
    await repo.captureEpisode(episode({ title: "Episode A" }));
    await repo.captureEpisode(episode({ title: "Episode B" }));
    await source.query("INSERT INTO team_brain_handoffs (handoff_id, state, created_at, updated_at) VALUES ('h1', 'OPEN', '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z')");
  }, 60000);
  afterAll(async () => {
    await source.close();
  });

  it60("export -> isolated restore -> parity all ok; tamper breaks parity", async () => {
    const backup = await exportBackup(source);
    expect(backup.version).toBe("p7-backup-1");
    const target = new PGlite();
    try {
      await migrateAll(target);
      await importRestore(target, backup);
      const parity = await verifyParity(target, backup);
      const failed = Object.entries(parity.tables).filter(([, t]) => !t.ok).map(([name]) => name);
      expect(parity.ok, `parity failed for tables: ${failed.join(", ") || "(none listed)"}`).toBe(true);
      for (const [name, t] of Object.entries(parity.tables)) {
        expect(t.ok, `table ${name} parity failed`).toBe(true);
      }
      // Tamper: remove one row from the target — parity must fail.
      await target.query("DELETE FROM tb_episodes WHERE title = 'Episode A'");
      const broken = await verifyParity(target, backup);
      expect(broken.ok).toBe(false);
      expect(broken.tables["tb_episodes"].ok).toBe(false);
    } finally {
      await target.close();
    }
  });

  it("pruneBackups keeps newest-per-day for 30 days and touches no database", () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-p7-prune-"));
    const base = new Date("2026-09-01T00:00:00Z");
    for (let d = 0; d < 40; d += 1) {
      const day = new Date(base.getTime() + d * 86400000).toISOString().slice(0, 10);
      writeFileSync(join(dir, `tb-backup-${day}-early.json`), "{}");
      writeFileSync(join(dir, `tb-backup-${day}-late.json`), "{}");
    }
    writeFileSync(join(dir, "unrelated.txt"), "keep me");
    const kept = pruneBackups(dir, { dailyVersions: 30 });
    expect(kept.kept.length).toBe(30);
    expect(kept.deleted.length).toBe(50);
    const remaining = readdirSync(dir).sort();
    expect(remaining).toContain("unrelated.txt");
    expect(remaining.filter((f) => f.endsWith("-late.json")).length).toBe(30);
    expect(remaining.filter((f) => f.endsWith("-early.json")).length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("P7 reconcile is read-only", () => {
  let db;
  beforeAll(async () => {
    db = new PGlite();
    await migrateAll(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });

  it60("lists pending and unknown deliveries and changes nothing", async () => {
    await db.query("INSERT INTO tb_consolidation_runs (run_date, slot_instant, state, lease_generation) VALUES ('2026-11-01', '2026-11-01T09:00:00Z', 'INCOMPLETE', 1)");
    await db.query("INSERT INTO tb_consolidation_runs (run_date, slot_instant, state, lease_generation, receipt) VALUES ('2026-10-31', '2026-10-31T09:00:00Z', 'COMPLETED', 1, NULL)");
    await db.query("INSERT INTO team_brain_handoffs (handoff_id, state, created_at, updated_at) VALUES ('h1', 'OPEN', '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z')");
    await db.query("INSERT INTO tb_consolidation_checkpoints (run_date, checkpoint, counts, recorded_at) VALUES ('2026-10-30', 'EXPORT', '{}', '2026-10-30T10:00:00Z')");
    const before = await db.query("SELECT (SELECT COUNT(*) FROM tb_consolidation_runs) + (SELECT COUNT(*) FROM team_brain_handoffs) + (SELECT COUNT(*) FROM tb_consolidation_checkpoints) AS n");
    const report = await reconcileReport(db);
    expect(report.pending.incompleteRuns).toContain("2026-11-01");
    expect(report.pending.openHandoffs.map((h) => h.handoffId)).toContain("h1");
    expect(report.unknown.completedWithoutReceipt).toContain("2026-10-31");
    expect(report.unknown.orphanCheckpoints).toContain("2026-10-30");
    const after = await db.query("SELECT (SELECT COUNT(*) FROM tb_consolidation_runs) + (SELECT COUNT(*) FROM team_brain_handoffs) + (SELECT COUNT(*) FROM tb_consolidation_checkpoints) AS n");
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n));
  });
});

describe("P7 release manifest, secrets scan, template, CLI", () => {
  it("manifest pins Node 24, schema 7.0, lockfile dependency versions, and recomputable hashes", () => {
    const manifest = buildReleaseManifest({ repoRoot: REPO_ROOT });
    expect(manifest.version).toBe(PACKAGE_VERSION);
    expect(manifest.nodeRequired).toBe(24);
    expect(manifest.configSchemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"));
    expect(manifest.dependencies.pg).toBe(lock.packages["node_modules/pg"].version);
    expect(manifest.dependencies.pglite).toBe(lock.packages["node_modules/@electric-sql/pglite"].version);
    for (const f of [...manifest.files, ...manifest.migrations]) {
      const rel = f.path ?? f.file;
      const disk = readFileSync(join(REPO_ROOT, rel), "utf8");
      const sha = createHash("sha256").update(disk).digest("hex");
      expect(sha, `hash mismatch for ${rel}`).toBe(f.sha256);
    }
  });

  it("no secrets in anything the package ships", () => {
    const manifest = buildReleaseManifest({ repoRoot: REPO_ROOT });
    const valuePatterns = [
      /password\s*=\s*["'][^"']+["']/i,
      /AKIA[0-9A-Z]{16}/,
      /ghp_[A-Za-z0-9]{16,}/,
      /sk-[A-Za-z0-9]{16,}/,
      /BEGIN (?:RSA )?PRIVATE KEY/,
    ];
    for (const f of [...manifest.files, ...manifest.migrations]) {
      const rel = f.path ?? f.file;
      const text = readFileSync(join(REPO_ROOT, rel), "utf8");
      for (const re of valuePatterns) {
        expect(text, `${rel} matches secret pattern ${re}`).not.toMatch(re);
      }
    }
  });

  it("the shipped config template validates with only env names", () => {
    const template = JSON.parse(readFileSync(join(HERE, "..", "worker", "config.template.json"), "utf8"));
    process.env.TB_WORKER_DB_PASSWORD = "template-worker-pw";
    process.env.TB_OBSERVER_DB_PASSWORD = "template-reader-pw";
    try {
      const cfg = validateWorkerConfig(template);
      expect(cfg.configSchemaVersion).toBe("7.0");
      expect(cfg.workerId).toBe("tb-worker-01");
    } finally {
      delete process.env.TB_WORKER_DB_PASSWORD;
      delete process.env.TB_OBSERVER_DB_PASSWORD;
    }
  });

  it("CLI --help and --validate-config work without a database", () => {
    const runPath = join(HERE, "..", "worker", "run.mjs");
    const help = execFileSync("node", [runPath, "--help"], { encoding: "utf8" });
    expect(help).toContain("team-brain worker CLI");
    const dir = mkdtempSync(join(tmpdir(), "tb-p7-cli-"));
    const cfgPath = join(dir, "config.json");
    writeFileSync(cfgPath, JSON.stringify(rawConfig()));
    const out = execFileSync("node", [runPath, "--config", cfgPath, "--validate-config"], { encoding: "utf8" });
    expect(JSON.parse(out).valid).toBe(true);
    writeFileSync(cfgPath, JSON.stringify(rawConfig({ database: { ...rawConfig().database, user: "tb_reader" } })));
    expect(() => execFileSync("node", [runPath, "--config", cfgPath, "--validate-config"], { encoding: "utf8" })).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("worker schema file loads (migrateWorker is exercised by the cycle tests)", () => {
    expect(loadWorkerSchemaSql()).toContain("tb_worker_heartbeats");
  });

  it("template host is an example placeholder, never a real host", () => {
    const template = JSON.parse(readFileSync(join(HERE, "..", "worker", "config.template.json"), "utf8"));
    expect(template.database.host).toContain(".invalid");
    expect(template.observer.host).toContain(".invalid");
  });
});
