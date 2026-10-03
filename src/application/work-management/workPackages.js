// FORGE Work Management — Work Package application service (Rung 1).
//
// db-injected orchestration over the forge_work_* tables. All functions take
// a supabase-shaped `db` (`.from(table)` chains) so they unit-test with
// mocks. The authenticated API routes resolve owner_id via
// resolveEffectiveOwnerId (workspace model) and pass the acting user as
// actor — attribution is never isolation.
//
// Migrations for these tables ship in the PR but are NOT applied to
// production here; they need Jason's separate word like every migration.

import {
  WP_STATUS, validatePackageInput, validateTransition, derivePercentComplete,
  hashScopeMembership, deriveCurrentBaseline, isTerminalStatus,
} from "@/domains/work-management/workPackage.js";

const TABLES = Object.freeze({
  packages: "forge_work_packages",
  transitions: "forge_work_package_transitions",
  assets: "forge_work_assets",
  components: "forge_work_asset_components",
  observations: "forge_work_inspection_observations",
  locations: "forge_work_locations",
  baselines: "forge_work_scope_baselines",
  changes: "forge_work_scope_changes",
  attestations: "forge_work_gate_attestations",
});

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function packageCode(n) {
  return `WP-${String(n).padStart(4, "0")}`;
}

async function getPackage(db, ownerId, packageId) {
  const { data, error } = await db.from(TABLES.packages).select("*")
    .eq("owner_id", ownerId).eq("id", packageId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Fields the edit endpoint may change. Status, code, and percent_complete
// are excluded by validatePackageInput; actual_* dates move only via
// transitions; scope_baseline_id moves only via the freeze/change workflow.
const EDITABLE_FIELDS = [
  "title", "description", "package_type", "priority", "project_id",
  "responsible_party", "planned_start", "planned_finish",
  "asset_id", "equipment_tag", "unit", "area", "system", "location_id",
  "work_order_ref", "workscope_code",
  "planned_qty", "planned_unit", "planned_manhours",
  "earned_qty", "earned_manhours", "actual_manhours",
  "progress_basis", "progress_updated_by",
];

export async function createWorkPackage(db, { ownerId, actor, input }) {
  const validation = validatePackageInput(input);
  if (!validation.ok) {
    return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  }
  const { data: seqNum, error: seqError } = await db.rpc("forge_work_next_package_number", { p_owner_id: ownerId });
  if (seqError) throw seqError;
  const now = new Date().toISOString();
  const row = {
    owner_id: ownerId,
    id: newId("forge_wp"),
    code: packageCode(seqNum),
    title: input.title.trim(),
    description: input.description ?? null,
    package_type: input.package_type ?? "other",
    priority: input.priority ?? "normal",
    project_id: input.project_id ?? null,
    responsible_party: input.responsible_party ?? null,
    planned_start: input.planned_start ?? null,
    planned_finish: input.planned_finish ?? null,
    status: WP_STATUS.DRAFT,
    asset_id: input.asset_id ?? null,
    equipment_tag: input.equipment_tag ?? null,
    unit: input.unit ?? null,
    area: input.area ?? null,
    system: input.system ?? null,
    location_id: input.location_id ?? null,
    work_order_ref: input.work_order_ref ?? null,
    workscope_code: input.workscope_code ?? null,
    planned_qty: input.planned_qty ?? null,
    planned_unit: input.planned_unit ?? null,
    planned_manhours: input.planned_manhours ?? null,
    earned_qty: input.earned_qty ?? 0,
    earned_manhours: input.earned_manhours ?? 0,
    progress_basis: input.progress_basis ?? null,
    percent_complete: null,
    created_by: actor, updated_by: actor, created_at: now, updated_at: now,
  };
  row.percent_complete = derivePercentComplete(row);
  const { data, error } = await db.from(TABLES.packages).insert(row).select("*").single();
  if (error) throw error;
  return { ok: true, package: data };
}

export async function updateWorkPackage(db, { ownerId, actor, packageId, patch }) {
  const pkg = await getPackage(db, ownerId, packageId);
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };
  if (isTerminalStatus(pkg.status)) {
    return { ok: false, httpStatus: 409, error: `Package is ${pkg.status}; reopen it before editing.` };
  }
  const filtered = {};
  for (const key of EDITABLE_FIELDS) {
    if (patch[key] !== undefined) filtered[key] = patch[key];
  }
  const validation = validatePackageInput({ ...filtered, title: filtered.title ?? pkg.title }, { isEdit: true });
  if (!validation.ok) {
    return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  }
  const now = new Date().toISOString();
  const merged = { ...pkg, ...filtered, updated_by: actor, updated_at: now };
  merged.percent_complete = derivePercentComplete(merged);
  merged.progress_updated_at = now;
  const { data, error } = await db.from(TABLES.packages).update({
    ...filtered, percent_complete: merged.percent_complete,
    progress_updated_at: now, updated_by: actor, updated_at: now,
  }).eq("owner_id", ownerId).eq("id", packageId).select("*").single();
  if (error) throw error;
  return { ok: true, package: data };
}

export async function transitionWorkPackage(db, { ownerId, actor, packageId, to, ctx = {} }) {
  const pkg = await getPackage(db, ownerId, packageId);
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };
  const check = validateTransition(pkg, to, ctx);
  if (!check.ok) return { ok: false, httpStatus: 409, error: check.error };
  const now = new Date().toISOString();
  const updates = { status: to, updated_by: actor, updated_at: now };
  const fx = check.effects || {};
  if (fx.setActualStart) updates.actual_start = now.slice(0, 10);
  if (fx.setActualFinish) updates.actual_finish = now.slice(0, 10);
  if (fx.clearActualFinish) updates.actual_finish = null;
  if (fx.setVerified) { updates.verified_at = now; updates.verified_by = actor; }
  if (fx.clearVerified) { updates.verified_at = null; updates.verified_by = null; }
  if (fx.recordBlockedFrom) {
    updates.blocked_from = fx.recordBlockedFrom;
    updates.blocked_reason = ctx.blockedReason;
    updates.blocked_since = now;
  }
  if (fx.returnFromBlocked) {
    updates.blocked_reason = null; updates.blocked_since = null; updates.blocked_from = null;
  }
  const { data: updated, error: updateError } = await db.from(TABLES.packages)
    .update(updates).eq("owner_id", ownerId).eq("id", packageId).select("*").single();
  if (updateError) throw updateError;
  const { error: auditError } = await db.from(TABLES.transitions).insert({
    owner_id: ownerId, id: newId("forge_wtr"), package_id: packageId,
    from_status: pkg.status, to_status: to, actor, at: now,
    reason: ctx.blockedReason || ctx.reopenReason || ctx.rejectionReason || ctx.cancelReason || null,
    evidence_ref: ctx.evidenceRef || null,
  });
  if (auditError) throw auditError;
  return { ok: true, package: updated };
}

export async function getWorkPackageDetail(db, { ownerId, packageId }) {
  const pkg = await getPackage(db, ownerId, packageId);
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };
  const [transitions, attestations, baselines, changes, observations] = await Promise.all([
    db.from(TABLES.transitions).select("*").eq("owner_id", ownerId).eq("package_id", packageId).order("at", { ascending: false }),
    db.from(TABLES.attestations).select("*").eq("owner_id", ownerId).eq("package_id", packageId).order("at", { ascending: false }),
    db.from(TABLES.baselines).select("*").eq("owner_id", ownerId).eq("package_id", packageId).order("version", { ascending: true }),
    db.from(TABLES.changes).select("*").eq("owner_id", ownerId).eq("package_id", packageId).order("requested_at", { ascending: false }),
    db.from(TABLES.observations).select("*").eq("owner_id", ownerId).eq("package_id", packageId).order("created_at", { ascending: false }),
  ]);
  for (const r of [transitions, attestations, baselines, changes, observations]) {
    if (r.error) throw r.error;
  }
  return {
    ok: true,
    package: pkg,
    transitions: transitions.data || [],
    attestations: attestations.data || [],
    baselines: baselines.data || [],
    currentBaseline: deriveCurrentBaseline(baselines.data || []),
    scopeChanges: changes.data || [],
    observations: observations.data || [],
  };
}

export async function listWorkPackages(db, { ownerId, status, packageType }) {
  let q = db.from(TABLES.packages).select("id,code,title,package_type,priority,status,planned_start,planned_finish,percent_complete,unit,area,system,updated_at")
    .eq("owner_id", ownerId).order("updated_at", { ascending: false });
  if (status) q = q.eq("status", status);
  if (packageType) q = q.eq("package_type", packageType);
  const { data, error } = await q;
  if (error) throw error;
  return { ok: true, packages: data || [] };
}

export async function recordGateAttestation(db, { ownerId, actor, packageId, gate, statement, notApplicable, naReason }) {
  const pkg = await getPackage(db, ownerId, packageId);
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };
  if (typeof statement !== "string" || statement.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "An attestation statement is required." };
  }
  if (notApplicable && (!naReason || naReason.trim().length === 0)) {
    return { ok: false, httpStatus: 400, error: "A not-applicable attestation requires a reason." };
  }
  const now = new Date().toISOString();
  const { data, error } = await db.from(TABLES.attestations).insert({
    owner_id: ownerId, id: newId("forge_wga"), package_id: packageId, gate,
    attestor: actor, at: now, statement: statement.trim(),
    not_applicable: Boolean(notApplicable), na_reason: naReason || null,
    created_by: actor, created_at: now,
  }).select("*").single();
  if (error) throw error;
  return { ok: true, attestation: data };
}

export async function freezeScopeBaseline(db, { ownerId, actor, packageId, membership }) {
  const pkg = await getPackage(db, ownerId, packageId);
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };
  if (!Array.isArray(membership) || membership.length === 0) {
    return { ok: false, httpStatus: 400, error: "A baseline needs at least one scope item." };
  }
  if (pkg.scope_baseline_id) {
    return { ok: false, httpStatus: 409, error: "Scope is already frozen; post-freeze changes go through the scope-change workflow." };
  }
  const now = new Date().toISOString();
  const row = {
    owner_id: ownerId, id: newId("forge_wsb"), package_id: packageId, version: 1,
    frozen_at: now, frozen_by: actor, membership,
    membership_hash: hashScopeMembership(membership), supersedes_id: null,
  };
  const { data: baseline, error: bError } = await db.from(TABLES.baselines).insert(row).select("*").single();
  if (bError) throw bError;
  const { error: pError } = await db.from(TABLES.packages)
    .update({ scope_baseline_id: baseline.id, updated_by: actor, updated_at: now })
    .eq("owner_id", ownerId).eq("id", packageId);
  if (pError) throw pError;
  return { ok: true, baseline };
}

export async function proposeScopeChange(db, { ownerId, actor, packageId, baselineVersion, changeType, description }) {
  const pkg = await getPackage(db, ownerId, packageId);
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };
  if (!pkg.scope_baseline_id) {
    return { ok: false, httpStatus: 409, error: "Freeze a scope baseline before proposing changes." };
  }
  if (!["addition", "removal", "substitution"].includes(changeType)) {
    return { ok: false, httpStatus: 400, error: "change_type must be addition, removal, or substitution." };
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "A change description is required." };
  }
  const now = new Date().toISOString();
  const { data, error } = await db.from(TABLES.changes).insert({
    owner_id: ownerId, id: newId("forge_wsc"), package_id: packageId,
    baseline_version: baselineVersion, change_type: changeType,
    description: description.trim(), requested_by: actor, requested_at: now, status: "proposed",
  }).select("*").single();
  if (error) throw error;
  return { ok: true, change: data };
}

// Approve/reject a scope change. Approval commits atomically per the spec:
// change -> approved, new baseline row with supersedes_id, package pointer
// advances with a concurrency check against the expected prior version.
export async function decideScopeChange(db, { ownerId, actor, changeId, approve, newMembership }) {
  const { data: change, error: cError } = await db.from(TABLES.changes).select("*")
    .eq("owner_id", ownerId).eq("id", changeId).maybeSingle();
  if (cError) throw cError;
  if (!change) return { ok: false, httpStatus: 404, error: "Scope change not found." };
  if (change.status !== "proposed") {
    return { ok: false, httpStatus: 409, error: `Change is already ${change.status}.` };
  }
  const now = new Date().toISOString();
  if (!approve) {
    const { data, error } = await db.from(TABLES.changes)
      .update({ status: "rejected", decided_by: actor, decided_at: now })
      .eq("owner_id", ownerId).eq("id", changeId).select("*").single();
    if (error) throw error;
    return { ok: true, change: data };
  }
  if (!Array.isArray(newMembership) || newMembership.length === 0) {
    return { ok: false, httpStatus: 400, error: "Approving a change requires the new membership list." };
  }
  const { data: baselines, error: bError } = await db.from(TABLES.baselines).select("*")
    .eq("owner_id", ownerId).eq("package_id", change.package_id).order("version", { ascending: true });
  if (bError) throw bError;
  const current = deriveCurrentBaseline(baselines || []);
  if (!current || current.version !== change.baseline_version) {
    return { ok: false, httpStatus: 409, error: "The baseline moved while this change was proposed; re-propose against the current version." };
  }
  const newVersion = current.version + 1;
  const baselineRow = {
    owner_id: ownerId, id: newId("forge_wsb"), package_id: change.package_id, version: newVersion,
    frozen_at: now, frozen_by: actor, membership: newMembership,
    membership_hash: hashScopeMembership(newMembership), supersedes_id: current.id,
  };
  const { data: newBaseline, error: nbError } = await db.from(TABLES.baselines).insert(baselineRow).select("*").single();
  if (nbError) throw nbError;
  // Concurrency check: only advance if the pointer still aims at the version
  // this approval was proposed against.
  const { data: advanced, error: pError } = await db.from(TABLES.packages)
    .update({ scope_baseline_id: newBaseline.id, updated_by: actor, updated_at: now })
    .eq("owner_id", ownerId).eq("id", change.package_id).eq("scope_baseline_id", current.id)
    .select("id");
  if (pError) throw pError;
  if (!advanced || advanced.length === 0) {
    return { ok: false, httpStatus: 409, error: "Concurrent approval advanced the baseline first; re-propose." };
  }
  const { data: decided, error: dError } = await db.from(TABLES.changes)
    .update({ status: "approved", decided_by: actor, decided_at: now, resulting_baseline_version: newVersion })
    .eq("owner_id", ownerId).eq("id", changeId).select("*").single();
  if (dError) throw dError;
  return { ok: true, change: decided, baseline: newBaseline };
}

export async function createAsset(db, { ownerId, actor, input }) {
  if (typeof input.asset_tag !== "string" || input.asset_tag.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "asset_tag is required." };
  }
  const now = new Date().toISOString();
  const { data, error } = await db.from(TABLES.assets).insert({
    owner_id: ownerId, id: newId("forge_wasset"), asset_tag: input.asset_tag.trim(),
    asset_type: input.asset_type || "other", name: input.name || null,
    unit: input.unit || null, area: input.area || null, system: input.system || null,
    parent_asset_id: input.parent_asset_id || null, source: "user_defined",
    created_by: actor, created_at: now, updated_at: now,
  }).select("*").single();
  if (error) throw error;
  return { ok: true, asset: data };
}

export async function createAssetComponent(db, { ownerId, actor, assetId, input }) {
  if (typeof input.component_key !== "string" || input.component_key.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "component_key is required and stable within the asset." };
  }
  const now = new Date().toISOString();
  const { data, error } = await db.from(TABLES.components).insert({
    owner_id: ownerId, id: newId("forge_wcomp"), asset_id: assetId,
    component_key: input.component_key.trim(), name: input.name || null,
    quantity: input.quantity ?? null, unit: input.unit || null,
    weight_kg: input.weight_kg ?? null, length_m: input.length_m ?? null,
    diameter_m: input.diameter_m ?? null, notes: input.notes || null,
    created_by: actor, created_at: now, updated_at: now,
  }).select("*").single();
  if (error) throw error;
  return { ok: true, component: data };
}

export async function createLocation(db, { ownerId, actor, input }) {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "name is required." };
  }
  const now = new Date().toISOString();
  const { data, error } = await db.from(TABLES.locations).insert({
    owner_id: ownerId, id: newId("forge_wloc"), name: input.name.trim(),
    location_type: input.location_type || "other",
    unit: input.unit || null, area: input.area || null, notes: input.notes || null,
    created_by: actor, created_at: now, updated_at: now,
  }).select("*").single();
  if (error) throw error;
  return { ok: true, location: data };
}

export async function recordInspectionObservation(db, { ownerId, actor, input }) {
  if (!input.package_id) {
    return { ok: false, httpStatus: 400, error: "package_id is required." };
  }
  const now = new Date().toISOString();
  const { data, error } = await db.from(TABLES.observations).insert({
    owner_id: ownerId, id: newId("forge_wobs"),
    asset_id: input.asset_id || null, component_id: input.component_id || null,
    package_id: input.package_id,
    inspection_method: input.inspection_method || "other",
    status: input.status || "pending",
    quantity_examined: input.quantity_examined ?? null,
    quantity_required: input.quantity_required ?? null,
    inspected_at: input.inspected_at || null,
    inspector: input.inspector || null, notes: input.notes || null,
    created_by: actor, created_at: now,
  }).select("*").single();
  if (error) throw error;
  return { ok: true, observation: data };
}
