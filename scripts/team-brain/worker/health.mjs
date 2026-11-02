// Team Brain P7 — health probes.
//
// Health is NOT a table count. Each probe validates a real invariant:
// the exact migration catalog, the effective grants, TLS/vault
// behavior, heartbeat freshness, DB/Git availability, backlog and
// intake watermarks, pending/unknown deliveries, and projection
// revision. Probe outputs carry counts, revisions, and run dates
// only — never episode text, never callback payloads, never
// credentials.
//
// Overall status: UNQUALIFIED if the provenance adapter is absent
// (the brief: an absent provenance adapter is visibly unqualified);
// FAIL if any other probe fails; PARTIAL if some probes could not
// see their inputs from this handle (NOT_VISIBLE — re-run with an
// owner handle for full verification); PASS otherwise. Measurement
// probes (backlog, pending, projection) pass when their queries
// succeed — they report numbers, they do not gate on thresholds
// the brief never set.
//
// The catalog + grants probes need a handle that can see grants
// (setup/owner handle in qualification, operator handle in
// production): a least-privilege reader cannot see another role's
// grants, and the probe says so instead of pretending otherwise.

import { execFile } from "node:child_process";
import { resolveTls } from "../postgres/connection.mjs";

export const EXPECTED_TABLES = Object.freeze([
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
]);

const CONSOLIDATOR_WRITE_TABLES = Object.freeze([
  "tb_consolidation_runs",
  "tb_consolidation_lease",
  "tb_consolidated_facts",
  "tb_consolidation_proposals",
  "tb_consolidation_checkpoints",
  "tb_consolidation_run_bindings",
  "tb_consolidation_audit",
  "tb_worker_heartbeats",
]);

const CONSOLIDATOR_READ_TABLES = Object.freeze([
  "tb_episodes",
  "tb_episode_grants",
  "tb_retrieval_revisions",
]);

const READER_TABLES = Object.freeze([
  "tb_consolidation_runs",
  "tb_consolidation_lease",
  "tb_consolidated_facts",
  "tb_consolidation_proposals",
  "tb_consolidation_checkpoints",
  "tb_consolidation_run_bindings",
  "tb_consolidation_audit",
  "tb_retrieval_revisions",
  "tb_episodes",
  "tb_worker_heartbeats",
  "team_brain_handoffs",
  "team_brain_obligations",
]);

function pass(name, detail = {}) {
  return { name, status: "PASS", ...detail };
}

function failProbe(name, detail = {}) {
  return { name, status: "FAIL", ...detail };
}

async function defaultGitCheck() {
  return new Promise((resolve) => {
    execFile("git", ["--version"], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve({ available: false, reason: err.message });
      resolve({ available: true, version: String(stdout).trim() });
    });
  });
}

async function probeMigrationCatalog(db) {
  try {
    const { rows } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
    const versionRows = await db.query("SELECT version FROM team_brain_schema_version ORDER BY version");
    const versions = versionRows.rows.map((r) => r.version);
    const leaseRows = await db.query("SELECT COUNT(*) AS n FROM tb_consolidation_lease WHERE id = 1");
    const leaseOk = Number(leaseRows.rows[0].n) === 1;
    if (missing.length || !versions.includes(1) || !leaseOk) {
      return failProbe("migrationCatalog", { missing, versions, leaseSingleton: leaseOk });
    }
    return pass("migrationCatalog", { tables: EXPECTED_TABLES.length, versions });
  } catch (err) {
    return failProbe("migrationCatalog", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

async function probeEffectiveGrants(db) {
  try {
    // Visibility first: a least-privilege handle cannot see another
    // role's grants (information_schema shows only own/grantor rows
    // to non-superusers). Reporting those as "missing" would be a
    // false FAIL, so a handle that cannot see both roles reports
    // NOT_VISIBLE instead. Full verification needs an owner/setup
    // handle (qualification) or --check with owner credentials.
    const who = await db.query(
      "SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super",
    );
    const currentUser = who.rows[0]?.u;
    const isSuper = who.rows[0]?.super === true;
    const { rows } = await db.query(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee IN ('tb_consolidator', 'tb_reader')`,
    );
    const visibleRoles = new Set(rows.map((r) => r.grantee));
    if (!isSuper && !(visibleRoles.has("tb_consolidator") && visibleRoles.has("tb_reader"))) {
      return {
        name: "effectiveGrants",
        status: "NOT_VISIBLE",
        reason: `handle as ${currentUser} cannot see both roles' grants; re-run with an owner handle for full verification`,
        visibleRoles: [...visibleRoles],
      };
    }
    const have = new Set(rows.map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}`));
    const violations = [];
    for (const t of CONSOLIDATOR_WRITE_TABLES) {
      for (const p of ["SELECT", "INSERT", "UPDATE"]) {
        if (!have.has(`tb_consolidator:${t}:${p}`)) violations.push(`tb_consolidator missing ${p} on ${t}`);
      }
    }
    for (const t of CONSOLIDATOR_READ_TABLES) {
      if (!have.has(`tb_consolidator:${t}:SELECT`)) violations.push(`tb_consolidator missing SELECT on ${t}`);
    }
    for (const t of READER_TABLES) {
      if (!have.has(`tb_reader:${t}:SELECT`)) violations.push(`tb_reader missing SELECT on ${t}`);
    }
    for (const r of rows) {
      if (r.grantee === "tb_consolidator" && (r.privilege_type === "DELETE" || r.privilege_type === "TRUNCATE")) {
        violations.push(`tb_consolidator has forbidden ${r.privilege_type} on ${r.table_name}`);
      }
      if (r.grantee === "tb_reader" && r.privilege_type !== "SELECT") {
        violations.push(`tb_reader has forbidden ${r.privilege_type} on ${r.table_name}`);
      }
    }
    if (violations.length) return failProbe("effectiveGrants", { violations });
    return pass("effectiveGrants", { grantRows: rows.length });
  } catch (err) {
    return failProbe("effectiveGrants", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

function probeTlsVault(config) {
  try {
    if (config == null || config.database == null || config.observer == null) {
      return failProbe("tlsVault", { reason: "config with database + observer endpoints is required" });
    }
    resolveTls(config.database);
    resolveTls(config.observer);
    for (const [path, endpoint] of [["database", config.database], ["observer", config.observer]]) {
      if ("password" in endpoint) return failProbe("tlsVault", { reason: `inline password in ${path} endpoint` });
      if (typeof endpoint.passwordEnv !== "string" || endpoint.passwordEnv === "") {
        return failProbe("tlsVault", { reason: `${path} endpoint lacks passwordEnv` });
      }
    }
    return pass("tlsVault", { databaseHost: config.database.host, observerHost: config.observer.host });
  } catch (err) {
    return failProbe("tlsVault", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

async function probeHeartbeatFreshness(observer, workerId, nowIso, maxAgeMs) {
  try {
    if (observer == null) return failProbe("heartbeatFreshness", { reason: "no observer handle" });
    const f = await observer.freshness(workerId, { nowIso, maxAgeMs });
    if (!f.fresh) return failProbe("heartbeatFreshness", { ageMs: f.ageMs, reason: f.reason });
    return pass("heartbeatFreshness", { ageMs: f.ageMs });
  } catch (err) {
    return failProbe("heartbeatFreshness", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

async function probeDbGitAvailability(db, readerDb, gitCheck) {
  try {
    await db.query("SELECT 1");
    await readerDb.query("SELECT 1");
    const git = await gitCheck();
    if (!git.available) return failProbe("dbGitAvailability", { db: true, git: false, reason: git.reason });
    return pass("dbGitAvailability", { db: true, git: git.version ?? true });
  } catch (err) {
    return failProbe("dbGitAvailability", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

async function probeBacklogWatermark(db) {
  try {
    const intake = await db.query("SELECT revision FROM tb_retrieval_revisions WHERE id = 1");
    const intakeRevision = intake.rows.length ? Number(intake.rows[0].revision) : 0;
    const consolidated = await db.query(
      "SELECT MAX(source_revision) AS m FROM tb_consolidation_runs WHERE state = 'COMPLETED'",
    );
    const consolidatedRevision = consolidated.rows[0].m == null ? 0 : Number(consolidated.rows[0].m);
    const backlog = await db.query(
      "SELECT COUNT(*) AS n FROM tb_episodes WHERE revision > $1 AND state = 'ACTIVE'",
      [consolidatedRevision],
    );
    return pass("backlogWatermark", {
      intakeRevision,
      consolidatedRevision,
      drift: intakeRevision - consolidatedRevision,
      backlogEpisodes: Number(backlog.rows[0].n),
    });
  } catch (err) {
    return failProbe("backlogWatermark", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

async function probePendingUnknownDeliveries(db) {
  try {
    const incomplete = await db.query(
      "SELECT COUNT(*) AS n FROM tb_consolidation_runs WHERE state = 'INCOMPLETE'",
    );
    const openHandoffs = await db.query(
      "SELECT COUNT(*) AS n FROM team_brain_handoffs WHERE state <> 'COMPLETE'",
    );
    const noReceipt = await db.query(
      "SELECT COUNT(*) AS n FROM tb_consolidation_runs WHERE state = 'COMPLETED' AND receipt IS NULL",
    );
    return pass("pendingUnknownDeliveries", {
      pendingIncompleteRuns: Number(incomplete.rows[0].n),
      pendingOpenHandoffs: Number(openHandoffs.rows[0].n),
      unknownCompletedWithoutReceipt: Number(noReceipt.rows[0].n),
    });
  } catch (err) {
    return failProbe("pendingUnknownDeliveries", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

async function probeProjectionRevision(db) {
  try {
    const intake = await db.query("SELECT revision FROM tb_retrieval_revisions WHERE id = 1");
    const intakeRevision = intake.rows.length ? Number(intake.rows[0].revision) : 0;
    const consolidated = await db.query(
      "SELECT MAX(source_revision) AS m FROM tb_consolidation_runs WHERE state = 'COMPLETED'",
    );
    const consolidatedRevision = consolidated.rows[0].m == null ? 0 : Number(consolidated.rows[0].m);
    return pass("projectionRevision", {
      intakeRevision,
      consolidatedRevision,
      drift: intakeRevision - consolidatedRevision,
    });
  } catch (err) {
    return failProbe("projectionRevision", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

async function probeProvenanceAdapter(readerDb) {
  try {
    if (readerDb == null) {
      return { name: "provenanceAdapter", status: "UNQUALIFIED", reason: "no observer/provenance adapter handle" };
    }
    const dist = await readerDb.query(
      "SELECT provenance_status, COUNT(*) AS n FROM tb_episodes GROUP BY provenance_status",
    );
    const distribution = Object.fromEntries(dist.rows.map((r) => [r.provenance_status, Number(r.n)]));
    return pass("provenanceAdapter", { distribution });
  } catch (err) {
    return failProbe("provenanceAdapter", { error: `${err.name}:${err.code ?? "UNKNOWN"}` });
  }
}

/**
 * Run every health probe. db = handle that can see grants (owner/setup
 * handle in qualification); readerDb = tb_reader observer handle (may
 * be null, which fails provenance as UNQUALIFIED, not as a crash).
 */
export async function runHealthProbes({
  db,
  readerDb,
  observer,
  config,
  workerId,
  nowIso,
  maxAgeMs = 26 * 60 * 60 * 1000,
  gitCheck = defaultGitCheck,
} = {}) {
  const probes = [
    await probeMigrationCatalog(db),
    await probeEffectiveGrants(db),
    probeTlsVault(config),
    await probeHeartbeatFreshness(observer, workerId, nowIso, maxAgeMs),
    await probeDbGitAvailability(db, readerDb ?? db, gitCheck),
    await probeBacklogWatermark(db),
    await probePendingUnknownDeliveries(db),
    await probeProjectionRevision(db),
    await probeProvenanceAdapter(readerDb),
  ];
  // A probe that fails only because its handle lacks privilege to SEE
  // its inputs (PostgreSQL 42501) reports NOT_VISIBLE, never a false
  // FAIL: the invariant is unverified from this handle, not broken.
  for (const p of probes) {
    if (p.status === "FAIL" && typeof p.error === "string" && p.error.includes("42501")) {
      p.status = "NOT_VISIBLE";
      p.reason = "handle lacks privilege to read this probe's inputs; re-run with an owner handle";
      delete p.error;
    }
  }
  let status = "PASS";
  if (probes.some((p) => p.status === "UNQUALIFIED")) status = "UNQUALIFIED";
  else if (probes.some((p) => p.status === "FAIL")) status = "FAIL";
  else if (probes.some((p) => p.status === "NOT_VISIBLE")) status = "PARTIAL";
  return { status, probes: Object.fromEntries(probes.map((p) => [p.name, p])) };
}
