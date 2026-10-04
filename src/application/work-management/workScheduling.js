// FORGE Work Management — Scheduling application service (Rung 4).
//
// db-injected orchestration over the four Rung 4 tables. All functions take
// a supabase-shaped `db` so they unit-test with mocks.
//
// Baselines are immutable: freezeBaseline inserts a new version row with a
// monotonic version_number. The current baseline is max(version_number) —
// supersession is derived by ordering, never by editing old rows (the DB
// trigger blocks UPDATE/DELETE).

import {
  percentComplete,
  earnedValue,
  plannedValue,
  costVariance,
  scheduleVariance,
  costPerformanceIndex,
  schedulePerformanceIndex,
  estimateToComplete,
  estimateAtCompletion,
  percentPlannedComplete,
  manpowerVariance,
  PROGRESS_METHODS,
} from "@/domains/work-management/workScheduling.js";

const TABLES = Object.freeze({
  baselines: "forge_work_package_baselines",
  snapshots: "forge_work_progress_snapshots",
  commitments: "forge_work_weekly_commitments",
  manpower: "forge_work_manpower_days",
  packages: "forge_work_packages",
});

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// Current baseline = highest version_number for the package.
async function getCurrentBaseline(db, ownerId, packageId) {
  const { data, error } = await db.from(TABLES.baselines)
    .select("*").eq("owner_id", ownerId).eq("package_id", packageId)
    .order("version_number", { ascending: false }).limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getPackageConfig(db, ownerId, packageId) {
  const { data, error } = await db.from(TABLES.packages)
    .select("id, progress_method, weight_method")
    .eq("owner_id", ownerId).eq("id", packageId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Package not found: ${packageId}`);
  return {
    progressMethod: data.progress_method || "physical_quantity",
    weightMethod: data.weight_method || "hours",
  };
}

// Freeze a new baseline version. The version number is max+1; the previous
// version is superseded by ordering, never by edit.
export async function freezeBaseline(db, { ownerId, packageId, baseline, frozenBy }) {
  const current = await getCurrentBaseline(db, ownerId, packageId);
  const versionNumber = current ? current.version_number + 1 : 1;
  const row = {
    id: newId("forge_wpb"),
    owner_id: ownerId,
    package_id: packageId,
    version_number: versionNumber,
    baseline_start: baseline.start,
    baseline_finish: baseline.finish,
    baseline_hours: baseline.hours,
    baseline_cost: baseline.cost,
    frozen_by: frozenBy,
  };
  const { data, error } = await db.from(TABLES.baselines).insert(row).select().single();
  if (error) throw error;
  return data;
}

// Record a progress snapshot for a status date. The caller supplies the
// raw measurements; the engine computes every derived % through the
// package's configured progress method and the fixed EVM formulas.
export async function recordProgressSnapshot(db, {
  ownerId, packageId, statusDate, measurements, actualHours, actualCost,
  plannedPct, recordedBy,
}) {
  const { progressMethod } = await getPackageConfig(db, ownerId, packageId);
  const baseline = await getCurrentBaseline(db, ownerId, packageId);
  if (!baseline) throw new Error(`No baseline frozen for package ${packageId}`);

  const earnedPct = percentComplete(progressMethod, measurements);
  const earnedHours = earnedValue(earnedPct, Number(baseline.baseline_hours));
  const earnedCost = earnedValue(earnedPct, Number(baseline.baseline_cost));
  const plannedHrs = plannedValue(plannedPct, Number(baseline.baseline_hours));
  const plannedCst = plannedValue(plannedPct, Number(baseline.baseline_cost));
  const cpi = costPerformanceIndex(earnedCost, actualCost);
  const etcCost = estimateToComplete(Number(baseline.baseline_cost), earnedCost, cpi);
  const eacCost = estimateAtCompletion(actualCost, etcCost);
  const cpiHrs = costPerformanceIndex(earnedHours, actualHours);
  const etcHours = estimateToComplete(Number(baseline.baseline_hours), earnedHours, cpiHrs);
  const eacHours = estimateAtCompletion(actualHours, etcHours);

  const row = {
    id: newId("forge_wps"),
    owner_id: ownerId,
    package_id: packageId,
    status_date: statusDate,
    planned_pct: plannedPct,
    actual_pct: earnedPct,
    earned_pct: earnedPct,
    earned_hours: earnedHours,
    earned_cost: earnedCost,
    actual_hours: actualHours,
    actual_cost: actualCost,
    etc_hours: etcHours,
    etc_cost: etcCost,
    eac_hours: eacHours,
    eac_cost: eacCost,
    baseline_version: baseline.version_number,
    recorded_by: recordedBy || "system",
  };
  const { data, error } = await db.from(TABLES.snapshots).insert(row).select().single();
  if (error) throw error;
  return {
    ...data,
    variances: {
      costVariance: costVariance(earnedCost, actualCost),
      scheduleVariance: scheduleVariance(earnedCost, plannedCst),
      cpi,
      spi: schedulePerformanceIndex(earnedCost, plannedCst),
    },
  };
}

// Record a weekly PPC commitment result for a crew.
export async function recordWeeklyCommitment(db, {
  ownerId, packageId, weekStartDate, crewName, foremanName,
  plannedCount, completedCount, nonCompletionReasons, recordedBy,
}) {
  const ppc = percentPlannedComplete(completedCount, plannedCount);
  const row = {
    id: newId("forge_wwc"),
    owner_id: ownerId,
    package_id: packageId || null,
    week_start_date: weekStartDate,
    crew_name: crewName,
    foreman_name: foremanName || null,
    planned_count: plannedCount,
    completed_count: completedCount,
    non_completion_reasons: nonCompletionReasons || [],
    recorded_by: recordedBy || "system",
  };
  const { data, error } = await db.from(TABLES.commitments).insert(row).select().single();
  if (error) throw error;
  return { ...data, ppc };
}

// Record one day's manpower roll-up. Returns the row plus computed deltas.
export async function recordManpowerDay(db, {
  ownerId, packageId, workDate, company, craft,
  plannedHeads, actualHeads, plannedManhours, estimatedManhours,
  actualManhours, recordedBy,
}) {
  const row = {
    id: newId("forge_wmd"),
    owner_id: ownerId,
    package_id: packageId,
    work_date: workDate,
    company,
    craft,
    planned_heads: plannedHeads,
    actual_heads: actualHeads ?? null,
    planned_manhours: plannedManhours,
    estimated_manhours: estimatedManhours ?? null,
    actual_manhours: actualManhours ?? null,
    recorded_by: recordedBy || "system",
  };
  const { data, error } = await db.from(TABLES.manpower).insert(row).select().single();
  if (error) throw error;
  return {
    ...data,
    variances: manpowerVariance({
      plannedHeads, actualHeads,
      plannedManhours, estimatedManhours, actualManhours,
    }),
  };
}

// Current schedule status: latest snapshot + current baseline + variances.
export async function getScheduleStatus(db, { ownerId, packageId }) {
  const baseline = await getCurrentBaseline(db, ownerId, packageId);
  const { data: snap, error } = await db.from(TABLES.snapshots)
    .select("*").eq("owner_id", ownerId).eq("package_id", packageId)
    .order("status_date", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!snap) return { baseline, snapshot: null, variances: null };
  const earned = Number(snap.earned_cost);
  const actual = Number(snap.actual_cost);
  const planned = plannedValue(Number(snap.planned_pct), Number(baseline.baseline_cost));
  return {
    baseline,
    snapshot: snap,
    variances: {
      costVariance: costVariance(earned, actual),
      scheduleVariance: scheduleVariance(earned, planned),
      cpi: costPerformanceIndex(earned, actual),
      spi: schedulePerformanceIndex(earned, planned),
    },
  };
}
