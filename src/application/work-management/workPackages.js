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
  WP_STATUS, WP_GATES, validatePackageInput, validateTransition, findTransition,
  derivePercentComplete, hashScopeMembership, deriveCurrentBaseline, isTerminalStatus,
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
  // Validate the FULLY MERGED candidate against persisted denominators and
  // earned amounts — never the patch alone. A patch of { earned_qty: 20 }
  // against a stored planned_qty of 10 must be rejected, not clamped.
  // Stored status/code/percent_complete are stripped first: the hand-set
  // guards target client input, not values already in the row.
  const merged = { ...pkg, ...filtered };
  const { status: _s, code: _c, percent_complete: _p, ...validatable } = merged;
  const validation = validatePackageInput(validatable, { isEdit: true });
  if (!validation.ok) {
    return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  }
  // designated_verifier is owner-only and travels outside EDITABLE_FIELDS.
  let verifierChange = null;
  if (patch.designated_verifier !== undefined) {
    if (actor !== ownerId) {
      return { ok: false, httpStatus: 403, error: "Only the workspace owner may designate a verifier." };
    }
    verifierChange = patch.designated_verifier || null;
  }
  const now = new Date().toISOString();
  const withDerived = { ...merged, updated_by: actor, updated_at: now };
  withDerived.percent_complete = derivePercentComplete(withDerived);
  const updatePayload = {
    ...filtered, percent_complete: withDerived.percent_complete,
    progress_updated_at: now, updated_by: actor, updated_at: now,
  };
  // Optimistic concurrency: commit only against the version read. A
  // concurrent transition (e.g. another request closing the package) moves
  // updated_at, so this matches zero rows and the edit is rejected with 409
  // instead of silently landing on a terminal package.
  let query = db.from(TABLES.packages).update(updatePayload)
    .eq("owner_id", ownerId).eq("id", packageId);
  if (pkg.updated_at) query = query.eq("updated_at", pkg.updated_at);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data) {
    return { ok: false, httpStatus: 409, error: "Package changed while editing; refresh and retry." };
  }
  if (verifierChange !== null || patch.designated_verifier !== undefined) {
    return setDesignatedVerifier(db, { ownerId, actor, packageId, verifier: verifierChange });
  }
  return { ok: true, package: data };
}

// Owner-only verifier designation, via the guarded RPC (the lifecycle
// trigger rejects direct designated_verifier writes).
export async function setDesignatedVerifier(db, { ownerId, actor, packageId, verifier }) {
  if (actor !== ownerId) {
    return { ok: false, httpStatus: 403, error: "Only the workspace owner may designate a verifier." };
  }
  const { data, error } = await db.rpc("forge_work_set_designated_verifier", {
    p_owner_id: ownerId, p_package_id: packageId,
    p_verifier: verifier || "",
  });
  if (error) throw error;
  if (!data || data.ok !== true) {
    const err = (data && data.error) || "unknown";
    if (err === "not_found") return { ok: false, httpStatus: 404, error: "Work package not found." };
    if (err === "forbidden") return { ok: false, httpStatus: 403, error: "Only the workspace owner may designate a verifier." };
    throw new Error(`forge_work_set_designated_verifier: ${err}`);
  }
  return { ok: true, package: data.package };
}

// Latest stored attestation per gate. A gate counts as satisfied when its
// latest attestation is a plain attestation or an N/A with a reason
// (lifecycle.md: N/A with provenance counts as satisfied). Absence is never
// evidence — this is the Rung 1 interim readiness input, read from the
// database, never from client JSON.
async function getAttestedGates(db, ownerId, packageId) {
  const { data, error } = await db.from(TABLES.attestations)
    .select("gate,not_applicable,na_reason,at")
    .eq("owner_id", ownerId).eq("package_id", packageId)
    .order("at", { ascending: false });
  if (error) throw error;
  const seen = new Set();
  const satisfied = [];
  for (const row of data || []) {
    if (seen.has(row.gate)) continue;
    seen.add(row.gate);
    if (!row.not_applicable || row.na_reason) satisfied.push(row.gate);
  }
  return satisfied;
}

// Verification, gate overrides, and reopen belong to the workspace owner or
// a designated verifier recorded on the package (lifecycle.md). Derived
// from actor identity — never from a client boolean.
function hasVerifierAuthority(pkg, actor, ownerId) {
  if (actor === ownerId) return true;
  return Boolean(pkg.designated_verifier && actor === pkg.designated_verifier);
}

export async function transitionWorkPackage(db, { ownerId, actor, packageId, to, ctx = {} }) {
  const pkg = await getPackage(db, ownerId, packageId);
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  // ---- Server-side authoritative context (P1-1). The route forwards the
  // caller's JSON, but attestedGates, reopenAuthority, overrideAuthorized,
  // and verifier identity are re-derived here from stored rows and the
  // authenticated actor. Client booleans are requests, not proof.
  const authority = hasVerifierAuthority(pkg, actor, ownerId);
  const serverCtx = {
    userConfirmedStart: ctx.userConfirmedStart === true,
    blockedReason: ctx.blockedReason,
    blockedSource: ctx.blockedSource,
    blockerCleared: ctx.blockerCleared === true,
    overrideAuthorized: authority,
    explicitCompletionReport: ctx.explicitCompletionReport === true,
    completionReason: ctx.completionReason,
    // Interim per lifecycle.md (Rung 10 ships the real per-criterion
    // checklist): the verifier's recorded assertion, authority-gated AND
    // persisted into the transition audit row by the RPC below — never a
    // bare in-memory boolean.
    completionCriteriaMet: ctx.completionCriteriaMet === true,
    requiredEvidenceOk: ctx.requiredEvidenceOk === true,
    verifier: authority ? actor : undefined,
    rejectionReason: ctx.rejectionReason,
    reopenAuthority: authority,
    reopenReason: ctx.reopenReason,
    cancelReason: ctx.cancelReason,
    evidenceRef: ctx.evidenceRef,
  };
  const row = findTransition(pkg, to);
  if (!row) {
    return { ok: false, httpStatus: 409, error: `Illegal transition: ${pkg.status} -> ${to}.` };
  }
  if (row.requires.includes("all_applicable_gates_ready")) {
    serverCtx.attestedGates = await getAttestedGates(db, ownerId, packageId);
  }
  const check = validateTransition(pkg, to, serverCtx);
  if (!check.ok) return { ok: false, httpStatus: 409, error: check.error };

  // ---- Atomic claim (P1-2, hardened). The RPC claims the package from the
  // expected status AND the expected version, applies effects, and appends
  // the audit row in ONE transaction. A concurrent transition wins the
  // claim; a concurrent ordinary-column edit bumps the version, so the
  // loser gets 409 with nothing written instead of a transition on stale
  // validation. Authority (owner or designated verifier) and verified_by
  // attribution are enforced inside the RPC from auth.uid() — the p_actor
  // parameter is gone because a caller-supplied actor string is forgeable.
  const now = new Date().toISOString();
  const fx = check.effects || {};
  const p_updates = {};
  if (fx.setActualStart) p_updates.actual_start = now.slice(0, 10);
  if (fx.setActualFinish) p_updates.actual_finish = now.slice(0, 10);
  if (fx.clearActualFinish) p_updates.actual_finish = null;
  if (fx.setVerified) { p_updates.verified_at = now; }
  if (fx.clearVerified) { p_updates.verified_at = null; }
  // NOTE: verified_by is set server-side inside the RPC to auth.uid() — the
  // service never supplies it. A verified_at key present with JSON null
  // clears both columns.
  if (fx.recordBlockedFrom) {
    p_updates.blocked_from = fx.recordBlockedFrom;
    p_updates.blocked_reason = ctx.blockedReason;
    p_updates.blocked_since = now;
  }
  if (fx.returnFromBlocked) {
    p_updates.blocked_reason = null; p_updates.blocked_since = null; p_updates.blocked_from = null;
  }
  const reason = ctx.blockedReason || ctx.reopenReason || ctx.rejectionReason
    || ctx.cancelReason || ctx.completionReason || null;
  // Persist the verifier's completion assertion in the audit row (P1-1):
  // NULL when the transition did not require the check, true when the
  // check was required and passed validation above. The per-criterion
  // checklist ships in Rung 10; until then the audit row is the persisted
  // record of what was asserted, by whom, and against what evidence.
  const { data: rpcData, error: rpcError } = await db.rpc("forge_work_transition_package", {
    p_owner_id: ownerId, p_package_id: packageId,
    p_expected_from: pkg.status, p_to: to, p_expected_version: pkg.version, p_updates,
    p_reason: reason, p_evidence_ref: ctx.evidenceRef || null,
    p_completion_criteria_met: row.requires.includes("completion_criteria")
      ? (ctx.completionCriteriaMet === true) : null,
    p_required_evidence_ok: row.requires.includes("required_evidence")
      ? (ctx.requiredEvidenceOk === true) : null,
  });
  if (rpcError) throw rpcError;
  if (!rpcData || rpcData.ok !== true) {
    const err = (rpcData && rpcData.error) || "conflict";
    if (err === "conflict") {
      return { ok: false, httpStatus: 409, error: `Package moved while transitioning (was ${pkg.status}); refresh and retry.` };
    }
    if (err === "forbidden") {
      return { ok: false, httpStatus: 403, error: "No workspace access for this package." };
    }
    throw new Error(`forge_work_transition_package: ${err}`);
  }
  return { ok: true, package: rpcData.package };
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
  // Gate keys come from the canonical set (WP_GATES) — the UI drives its
  // selector from defaultGatesFor(package_type), and the server rejects
  // anything else before the database CHECK does.
  if (!WP_GATES.includes(gate)) {
    return { ok: false, httpStatus: 400, error: `gate must be one of: ${WP_GATES.join(", ")}.` };
  }
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
  // Atomic freeze (P1-3): the RPC inserts version 1 and advances the pointer
  // in ONE transaction, conditional on the pointer still being null. A
  // failure can never leave a committed version-1 row with no pointer, and
  // two concurrent freezes cannot both succeed.
  const { data, error } = await db.rpc("forge_work_freeze_scope", {
    p_owner_id: ownerId, p_package_id: packageId,
    p_membership: membership, p_membership_hash: hashScopeMembership(membership),
  });
  if (error) throw error;
  if (!data || data.ok !== true) {
    const err = (data && data.error) || "unknown";
    if (err === "already_frozen") {
      return { ok: false, httpStatus: 409, error: "Scope is already frozen; post-freeze changes go through the scope-change workflow." };
    }
    if (err === "forbidden") {
      return { ok: false, httpStatus: 403, error: "No workspace access for this package." };
    }
    throw new Error(`forge_work_freeze_scope: ${err}`);
  }
  return { ok: true, baseline: data.baseline };
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

// Approve/reject a scope change. The decision is atomic per the spec: the
// RPC claims the change (proposed -> decided), inserts the superseding
// baseline, advances the package pointer, and marks the change — all in ONE
// transaction. Any failure rolls back every row; a racing rejection and
// approval cannot both land.
export async function decideScopeChange(db, { ownerId, actor, changeId, approve, newMembership }) {
  if (approve && (!Array.isArray(newMembership) || newMembership.length === 0)) {
    return { ok: false, httpStatus: 400, error: "Approving a change requires the new membership list." };
  }
  const { data, error } = await db.rpc("forge_work_decide_scope_change", {
    p_owner_id: ownerId, p_change_id: changeId,
    p_approve: Boolean(approve),
    p_new_membership: approve ? newMembership : [],
    p_membership_hash: approve ? hashScopeMembership(newMembership) : "",
  });
  if (error) throw error;
  if (!data || data.ok !== true) {
    const err = (data && data.error) || "unknown";
    if (err === "not_found") return { ok: false, httpStatus: 404, error: "Scope change not found." };
    if (err === "already_decided") {
      return { ok: false, httpStatus: 409, error: "Change was already decided by a concurrent request." };
    }
    if (err === "baseline_moved") {
      return { ok: false, httpStatus: 409, error: "The baseline moved while this change was proposed; re-propose against the current version." };
    }
    if (err === "conflict") {
      return { ok: false, httpStatus: 409, error: "Concurrent approval advanced the baseline first; re-propose." };
    }
    if (err === "forbidden") {
      return { ok: false, httpStatus: 403, error: "No workspace access for this change." };
    }
    throw new Error(`forge_work_decide_scope_change: ${err}`);
  }
  return { ok: true, change: data.change, baseline: data.baseline || null };
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
