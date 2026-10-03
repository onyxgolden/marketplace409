// FORGE Work Management — Readiness Engine application service (Rung 3).
//
// db-injected orchestration over forge_work_gate_evaluations and
// forge_work_gate_overrides. All functions take a supabase-shaped `db`
// so they unit-test with mocks. The authenticated API routes resolve
// owner_id via the workspace model.
//
// Evaluations are computed by the engine (system) or run manually by a
// human; each run appends one row per gate. Overrides are human-only —
// the DB trigger rejects service-role overrides.
//
// Migrations for these tables ship in the PR but are NOT applied to
// production here; they need Jason's separate word like every migration.

import {
  WORK_GATES,
  evaluateGate,
  isGateSatisfied,
  isPackageReady,
  validateOverride,
} from "@/domains/work-management/workGates.js";

const TABLES = Object.freeze({
  evaluations: "forge_work_gate_evaluations",
  overrides: "forge_work_gate_overrides",
  attestations: "forge_work_gate_attestations",
  packageTypeGates: "forge_work_package_type_gates",
  packages: "forge_work_packages",
});

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// Latest attestation per gate for a package (Rung 1 table).
async function getLatestAttestations(db, ownerId, packageId) {
  const { data, error } = await db.from(TABLES.attestations)
    .select("gate, statement, not_applicable, na_reason, at")
    .eq("owner_id", ownerId).eq("package_id", packageId)
    .order("at", { ascending: false });
  if (error) throw error;
  const latest = {};
  for (const row of data || []) {
    if (!latest[row.gate]) latest[row.gate] = row;
  }
  return latest;
}

// Gates applicable to a package type (Rung 1 seed table).
async function getApplicableGates(db, packageType) {
  const { data, error } = await db.from(TABLES.packageTypeGates)
    .select("gate").eq("package_type", packageType);
  if (error) throw error;
  return (data || []).map((r) => r.gate).filter((g) => WORK_GATES.includes(g));
}

// Latest evaluation per gate for a package.
async function getLatestEvaluations(db, ownerId, packageId) {
  const { data, error } = await db.from(TABLES.evaluations)
    .select("gate, verdict, reason, evaluated_at")
    .eq("owner_id", ownerId).eq("package_id", packageId)
    .order("evaluated_at", { ascending: false });
  if (error) throw error;
  const latest = {};
  for (const row of data || []) {
    if (!latest[row.gate]) latest[row.gate] = row;
  }
  return latest;
}

// Unexpired overrides per gate for a package.
async function getActiveOverrides(db, ownerId, packageId, nowIso) {
  const { data, error } = await db.from(TABLES.overrides)
    .select("gate, override_by, reason, expires_at")
    .eq("owner_id", ownerId).eq("package_id", packageId)
    .gt("expires_at", nowIso);
  if (error) throw error;
  const byGate = {};
  for (const row of data || []) {
    (byGate[row.gate] = byGate[row.gate] || []).push(row);
  }
  return byGate;
}

/**
 * Run the readiness engine for a package: evaluate every applicable gate
 * and append one evaluation row per gate. Returns the per-gate verdicts.
 */
export async function runGateEvaluations(db, { ownerId, packageId, packageType, signals = {}, nowIso }) {
  const gates = await getApplicableGates(db, packageType);
  const attestations = await getLatestAttestations(db, ownerId, packageId);
  const results = [];
  for (const gate of gates) {
    const { verdict, reason } = evaluateGate({
      gate,
      attestation: attestations[gate] || null,
      signals: signals[gate] || {},
    });
    const row = {
      id: newId("forge_wge"),
      owner_id: ownerId,
      package_id: packageId,
      gate,
      verdict,
      reason,
      evidence: { attested: !!attestations[gate], signals: signals[gate] || {} },
      evaluated_at: nowIso,
    };
    const { error } = await db.from(TABLES.evaluations).insert(row);
    if (error) throw error;
    results.push({ gate, verdict, reason });
  }
  return results;
}

/**
 * Current readiness of a package: per-gate satisfaction + overall verdict.
 */
export async function getPackageReadiness(db, { ownerId, packageId, packageType, nowIso }) {
  const gates = await getApplicableGates(db, packageType);
  const evaluations = await getLatestEvaluations(db, ownerId, packageId);
  const overrides = await getActiveOverrides(db, ownerId, packageId, nowIso);
  return isPackageReady({
    applicableGates: gates,
    getGateState: (gate) => ({
      latestEvaluation: evaluations[gate] || null,
      activeOverrides: overrides[gate] || [],
    }),
  });
}

/**
 * Create a human override for a gate. The actor is stamped by the DB
 * trigger from the caller's JWT — the service never accepts an actor value.
 */
export async function createGateOverride(db, { ownerId, packageId, gate, reason, expiresAt, nowIso }) {
  validateOverride({ gate, reason, expiresAt, nowIso });
  const row = {
    id: newId("forge_wgo"),
    owner_id: ownerId,
    package_id: packageId,
    gate,
    // override_by is stamped by the trigger; sending a placeholder keeps
    // the NOT NULL constraint satisfied for mock DBs in tests.
    override_by: "trigger-stamped",
    reason: reason.trim(),
    expires_at: expiresAt,
  };
  const { data, error } = await db.from(TABLES.overrides).insert(row).select().single();
  if (error) throw error;
  return data;
}
