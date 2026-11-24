// Milestones tab (work package planner, slice 9) — application service.
//
// Reads go through ONE snapshot RPC (forge_work_milestones_snapshot):
// every active template (with its complexity-tier offsets nested) plus
// the package's instantiated milestones, with `late` computed on read.
// Writes go through the slice-9 SECURITY DEFINER RPCs only (the RPCs
// derive the actor from auth.uid() and enforce ownership, terminal-
// package guards, optimistic versions, and reason rules).

export const NOT_APPLIED_ERROR =
  "Milestones isn't available yet — the database change for this feature hasn't been applied.";

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return String(error.message || error || "").includes("Could not find the function");
}

/** Maps a slice-9 RPC failure to a plain-English { ok, httpStatus, error } result. */
export function mapMilestoneRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP9_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Milestones not found." };
  }
  if (message.includes("WPP9_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP9_TEMPLATE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Milestone template not found." };
  }
  if (message.includes("WPP9_MILESTONE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Milestone not found." };
  }
  if (message.includes("WPP9_MILESTONE_NUMBER_TAKEN")) {
    return { ok: false, httpStatus: 409, error: "That milestone number is already used in this template." };
  }
  if (message.includes("WPP9_INVALID_TEMPLATE_NAME")) {
    return { ok: false, httpStatus: 400, error: "A template name is required." };
  }
  if (message.includes("WPP9_INVALID_MILESTONE_NUMBER")) {
    return { ok: false, httpStatus: 400, error: "Milestone number must be a positive number." };
  }
  if (message.includes("WPP9_INVALID_DESCRIPTION")) {
    return { ok: false, httpStatus: 400, error: "Description is required." };
  }
  if (message.includes("WPP9_INVALID_DURATION_UNIT")) {
    return { ok: false, httpStatus: 400, error: "Duration unit must be months, weeks, or days." };
  }
  if (message.includes("WPP9_PARENT_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A functional sub-item needs its parent milestone number." };
  }
  if (message.includes("WPP9_INVALID_TIER")) {
    return { ok: false, httpStatus: 400, error: "A complexity tier name is required." };
  }
  if (message.includes("WPP9_INVALID_PLANNED_DATE")) {
    return { ok: false, httpStatus: 400, error: "A planned date is required." };
  }
  if (message.includes("WPP9_INVALID_PERCENT")) {
    return { ok: false, httpStatus: 400, error: "Percent complete must be between 0 and 100." };
  }
  if (message.includes("WPP9_ANCHOR_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "An anchor date is required to instantiate milestones." };
  }
  if (message.includes("WPP9_ALREADY_INSTANTIATED")) {
    return { ok: false, httpStatus: 409, error: "This package already has milestones — retire them first to instantiate from a different template." };
  }
  if (message.includes("WPP9_OFFSET_MISSING")) {
    return { ok: false, httpStatus: 400, error: "The chosen template is missing a timing offset for one of its milestones under this complexity tier." };
  }
  if (message.includes("WPP9_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "Milestones were changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP9_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "Retired records cannot be changed." };
  }
  if (message.includes("WPP9_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — Milestones is read-only." };
  }
  if (message.includes("WPP9_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (message.includes("WPP9_INVALID_ACTOR")) {
    return { ok: false, httpStatus: 401, error: "You must be signed in to do that." };
  }
  throw error;
}

function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Milestones RPC returned no row.");
  return row;
}

async function requirePackage(db, ownerId, packageId) {
  const { data, error } = await db
    .from("forge_work_packages")
    .select("id, status")
    .eq("owner_id", ownerId)
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, httpStatus: 404, error: "Work package not found." };
  return { ok: true, status: data.status ?? null };
}

function toCamelTemplate(row) {
  return {
    id: row.id,
    templateName: row.templateName ?? row.template_name,
    milestoneNumber: Number(row.milestoneNumber ?? row.milestone_number),
    isMaster: row.isMaster ?? row.is_master,
    parentMilestoneNumber: row.parentMilestoneNumber ?? row.parent_milestone_number ?? null,
    description: row.description,
    responsibilityRole: row.responsibilityRole ?? row.responsibility_role ?? null,
    department: row.department ?? null,
    durationUnit: row.durationUnit ?? row.duration_unit,
    notes: row.notes ?? null,
    stewardshipFlag: row.stewardshipFlag ?? row.stewardship_flag ?? false,
    isStageGate: row.isStageGate ?? row.is_stage_gate ?? false,
    version: row.version,
    offsets: (row.offsets ?? []).map((o) => ({
      complexityTier: o.complexityTier ?? o.complexity_tier,
      monthsFromAnchor: Number(o.monthsFromAnchor ?? o.months_from_anchor),
    })),
  };
}

function toCamelInstance(row) {
  return {
    id: row.id,
    sourceTemplateMilestoneId: row.sourceTemplateMilestoneId ?? row.source_template_milestone_id ?? null,
    milestoneNumber: Number(row.milestoneNumber ?? row.milestone_number),
    isMaster: row.isMaster ?? row.is_master,
    description: row.description,
    responsibilityRole: row.responsibilityRole ?? row.responsibility_role ?? null,
    department: row.department ?? null,
    isStageGate: row.isStageGate ?? row.is_stage_gate ?? false,
    complexityTierSelected: row.complexityTierSelected ?? row.complexity_tier_selected,
    anchorDate: row.anchorDate ?? row.anchor_date,
    plannedDate: row.plannedDate ?? row.planned_date,
    actualDate: row.actualDate ?? row.actual_date ?? null,
    percentComplete: Number(row.percentComplete ?? row.percent_complete ?? 0),
    late: Boolean(row.late),
    comments: row.comments ?? null,
    justification: row.justification ?? null,
    version: row.version,
  };
}

function toCamelSnapshot(raw) {
  return {
    templates: (raw?.templates ?? []).map(toCamelTemplate),
    instances: (raw?.instances ?? []).map(toCamelInstance),
  };
}

/** The Milestones tab for one package: every active template plus the package's instantiated milestones. */
export async function getMilestonesSnapshot(db, { ownerId, packageId }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_milestones_snapshot", {
    p_owner_id: ownerId,
    p_package_id: packageId,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return { ok: true, templates: [], instances: [], packageStatus: pkg.status, notApplied: true };
    }
    return mapMilestoneRpcError(error);
  }
  const snapshot = toCamelSnapshot(data);
  return { ok: true, ...snapshot, packageStatus: pkg.status, notApplied: false };
}

export async function createMilestoneTemplate(db, { ownerId, input }) {
  const { data, error } = await db.rpc("forge_work_milestone_template_create", {
    p_owner_id: ownerId,
    p_template_name: input?.templateName ?? null,
    p_milestone_number: input?.milestoneNumber ?? null,
    p_is_master: input?.isMaster ?? true,
    p_parent_milestone_number: input?.parentMilestoneNumber ?? null,
    p_description: input?.description ?? null,
    p_responsibility_role: input?.responsibilityRole ?? null,
    p_department: input?.department ?? null,
    p_duration_unit: input?.durationUnit ?? "months",
    p_notes: input?.notes ?? null,
    p_stewardship_flag: input?.stewardshipFlag ?? false,
    p_is_stage_gate: input?.isStageGate ?? false,
    p_reason: input?.reason ?? null,
  });
  if (error) return mapMilestoneRpcError(error);
  return { ok: true, template: toCamelTemplate(rpcRow(data)) };
}

export async function updateMilestoneTemplate(db, { ownerId, templateMilestoneId, input }) {
  const { data, error } = await db.rpc("forge_work_milestone_template_update", {
    p_owner_id: ownerId,
    p_template_milestone_id: templateMilestoneId,
    p_expected_version: input?.expectedVersion ?? null,
    p_description: input?.description ?? null,
    p_responsibility_role: input?.responsibilityRole ?? null,
    p_department: input?.department ?? null,
    p_duration_unit: input?.durationUnit ?? "months",
    p_notes: input?.notes ?? null,
    p_stewardship_flag: input?.stewardshipFlag ?? false,
    p_is_stage_gate: input?.isStageGate ?? false,
    p_reason: input?.reason ?? null,
  });
  if (error) return mapMilestoneRpcError(error);
  return { ok: true, template: toCamelTemplate(rpcRow(data)) };
}

export async function retireMilestoneTemplate(db, { ownerId, templateMilestoneId, expectedVersion, reason }) {
  const { data, error } = await db.rpc("forge_work_milestone_template_retire", {
    p_owner_id: ownerId,
    p_template_milestone_id: templateMilestoneId,
    p_expected_version: expectedVersion ?? null,
    p_reason: reason ?? null,
  });
  if (error) return mapMilestoneRpcError(error);
  return { ok: true, template: toCamelTemplate(rpcRow(data)) };
}

export async function setMilestoneComplexityOffset(db, { ownerId, templateMilestoneId, input }) {
  const { data, error } = await db.rpc("forge_work_milestone_complexity_offset_set", {
    p_owner_id: ownerId,
    p_template_milestone_id: templateMilestoneId,
    p_expected_version: input?.expectedVersion ?? null,
    p_complexity_tier: input?.complexityTier ?? null,
    p_months_from_anchor: input?.monthsFromAnchor ?? null,
    p_reason: input?.reason ?? null,
  });
  if (error) return mapMilestoneRpcError(error);
  return { ok: true, template: toCamelTemplate(rpcRow(data)) };
}

export async function instantiateMilestones(db, { ownerId, packageId, input }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_milestones_instantiate", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_template_name: input?.templateName ?? null,
    p_anchor_date: input?.anchorDate ?? null,
    p_complexity_tier: input?.complexityTier ?? null,
  });
  if (error) return mapMilestoneRpcError(error);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return { ok: true, instances: rows.map(toCamelInstance) };
}

export async function updateMilestone(db, { ownerId, milestoneId, input }) {
  const { data, error } = await db.rpc("forge_work_milestone_update", {
    p_owner_id: ownerId,
    p_milestone_id: milestoneId,
    p_expected_version: input?.expectedVersion ?? null,
    p_description: input?.description ?? null,
    p_responsibility_role: input?.responsibilityRole ?? null,
    p_department: input?.department ?? null,
    p_planned_date: input?.plannedDate ?? null,
    p_actual_date: input?.actualDate ?? null,
    p_percent_complete: input?.percentComplete ?? null,
    p_comments: input?.comments ?? null,
    p_justification: input?.justification ?? null,
    p_reason: input?.reason ?? null,
  });
  if (error) return mapMilestoneRpcError(error);
  return { ok: true, instance: toCamelInstance(rpcRow(data)) };
}

export async function retireMilestone(db, { ownerId, milestoneId, expectedVersion, reason }) {
  const { data, error } = await db.rpc("forge_work_milestone_retire", {
    p_owner_id: ownerId,
    p_milestone_id: milestoneId,
    p_expected_version: expectedVersion ?? null,
    p_reason: reason ?? null,
  });
  if (error) return mapMilestoneRpcError(error);
  return { ok: true, instance: toCamelInstance(rpcRow(data)) };
}
