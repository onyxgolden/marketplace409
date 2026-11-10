// Change Orders Log (work package planner, slice 8) — application service.
//
// Reads go through ONE snapshot RPC (forge_work_change_orders_snapshot):
// the control estimate, active change orders, stored craft rates, and
// planned labor hours per craft from the active step plan, in a single
// database snapshot; the pure domain module computes every running
// figure from it. Writes go through the slice-8 SECURITY DEFINER RPCs
// only (the RPCs derive the actor from auth.uid() and enforce
// ownership, the status machine, terminal guards, optimistic versions,
// and reason rules).

import {
  computeChangeOrderSummary,
  validateChangeOrderCreateInput,
  validateChangeOrderTransitionInput,
  validateChangeOrderUpdateInput,
  validateControlEstimateInput,
  validateCraftRateInput,
} from "@/domains/work-management/changeOrders";

export const NOT_APPLIED_ERROR =
  "The Change Orders Log isn't available yet — the database change for this feature hasn't been applied.";

const PAGE_SIZE = 200;

function isMissingTableError(error) {
  return error?.code === "42P01" || String(error?.message || "").includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return String(error.message || error || "").includes("Could not find the function");
}

/**
 * Maps a slice-8 RPC failure to a plain-English { ok, httpStatus, error }
 * result. Unknown failures throw, like workSteps.js — the route turns them
 * into a 500.
 */
export function mapChangeOrderRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP8_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Change Orders Log not found." };
  }
  if (message.includes("WPP8_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP8_ESTIMATE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Control estimate not found." };
  }
  if (message.includes("WPP8_CHANGE_ORDER_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Change order not found." };
  }
  if (message.includes("WPP8_RATE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Craft rate not found." };
  }
  if (message.includes("WPP8_LINK_NOT_FOUND")) {
    return { ok: false, httpStatus: 400, error: "A linked step, drawing, or takeoff line does not belong to this package." };
  }
  if (message.includes("WPP8_INVALID_TRANSITION")) {
    return { ok: false, httpStatus: 409, error: "That status move is not allowed — change orders move one step at a time, and an approved PO can never be denied." };
  }
  if (message.includes("WPP8_INVALID_STATUS")) {
    return { ok: false, httpStatus: 400, error: "Move to a valid change order status." };
  }
  if (message.includes("WPP8_INVALID_TYPE")) {
    return { ok: false, httpStatus: 400, error: "Type must be one of the change order types." };
  }
  if (message.includes("WPP8_INVALID_DESCRIPTION")) {
    return { ok: false, httpStatus: 400, error: "Description is required (at most 4,000 characters, no markup)." };
  }
  if (message.includes("WPP8_INVALID_FIELD")) {
    return { ok: false, httpStatus: 400, error: "A header field is too long or has control characters." };
  }
  if (message.includes("WPP8_INVALID_COST")) {
    return { ok: false, httpStatus: 400, error: "Costs must be whole numbers of cents (0 or more)." };
  }
  if (message.includes("WPP8_INVALID_CRAFT")) {
    return { ok: false, httpStatus: 400, error: "A craft label is required (letters, numbers, spaces, and . & ' / -)." };
  }
  if (message.includes("WPP8_INVALID_RATE")) {
    return { ok: false, httpStatus: 400, error: "Labor rate must be a whole number of cents per hour from 1 to 100,000." };
  }
  if (message.includes("WPP8_INVALID_SCHEDULE_IMPACT")) {
    return { ok: false, httpStatus: 400, error: "Schedule impact must be a whole number of days from -366 to 366." };
  }
  if (message.includes("WPP8_INVALID_NOTE")) {
    return { ok: false, httpStatus: 400, error: "Notes must be at most 1,000 characters, with no control characters." };
  }
  if (message.includes("WPP8_INVALID_DENIAL_REASON")) {
    return { ok: false, httpStatus: 400, error: "Denial reason must be at most 1,000 characters, with no control characters." };
  }
  if (message.includes("WPP8_PO_NUMBER_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A PO number is required once a change order reaches PO requested." };
  }
  if (message.includes("WPP8_DENIAL_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A denial reason is required to deny a change order." };
  }
  if (message.includes("WPP8_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "The Change Orders Log was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP8_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "Retired records cannot be changed." };
  }
  if (message.includes("WPP8_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — the Change Orders Log is read-only." };
  }
  if (message.includes("WPP8_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (message.includes("WPP8_REASON_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Reason must be at most 1,000 characters." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Change Orders Log RPC returned no row.");
  return row;
}

function resolvePaging({ limit, offset }) {
  const parsedLimit = limit == null ? 100 : Number(limit);
  const parsedOffset = offset == null ? 0 : Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    return { ok: false, httpStatus: 400, error: "Limit must be a whole number from 1 to 200." };
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return { ok: false, httpStatus: 400, error: "Offset must be a whole number (0 or more)." };
  }
  return { ok: true, limit: parsedLimit, offset: parsedOffset };
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

function toCamelEstimate(row) {
  if (!row) return null;
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    originalControlEstimateCents: row.original_control_estimate_cents,
    currentControlEstimateCents: row.current_estimate_cents,
    contingencyCents: row.contingency_cents,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelChangeOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    changeOrderNumber: row.change_order_number,
    type: row.type,
    description: row.description,
    costCode: row.cost_code,
    afeNo: row.afe_no,
    referenceContractNo: row.reference_contract_no,
    referencePoNumber: row.reference_po_number,
    initiatorName: row.initiator_name,
    estimatedCostCents: row.estimated_cost_cents,
    approvedCostCents: row.approved_cost_cents,
    actualCostCents: row.actual_cost_cents,
    scheduleImpactDays: row.schedule_impact_days,
    scheduleImpactNote: row.schedule_impact_note,
    status: row.status,
    poNumber: row.po_number,
    denialReason: row.denial_reason,
    linkedStepId: row.linked_step_id,
    linkedDrawingId: row.linked_drawing_id,
    linkedTakeoffLineId: row.linked_takeoff_line_id,
    version: row.version,
    retiredAt: row.retired_at,
    retiredBy: row.retired_by,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelCraftRate(row) {
  if (!row) return null;
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    craftKey: row.craft_key,
    craftLabel: row.craft_label,
    rateCentsPerHour: row.rate_cents_per_hour,
    version: row.version,
    retiredAt: row.retired_at,
    retiredBy: row.retired_by,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelRevision(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    recordId: row.change_order_id ?? row.estimate_id ?? row.craft_rate_id ?? null,
    version: row.version,
    actorId: row.actor_id,
    action: row.action,
    oldValues: row.old_values ?? null,
    newValues: row.new_values ?? null,
    reason: row.reason ?? null,
    recordedAt: row.recorded_at,
  };
}

function toCamelSnapshot(row) {
  return {
    packageStatus: row?.packageStatus ?? row?.package_status ?? null,
    estimate: toCamelEstimate(row?.estimate ?? null),
    changeOrders: (row?.changeOrders ?? row?.change_orders ?? []).map(toCamelChangeOrder),
    craftRates: (row?.craftRates ?? row?.craft_rates ?? []).map(toCamelCraftRate),
    craftHours: (row?.craftHours ?? row?.craft_hours ?? []).map((craft) => ({
      craftKey: craft.craft_key,
      craftLabel: craft.craft_label,
      plannedHours: craft.planned_hours == null ? null : Number(craft.planned_hours),
      stepCount: craft.step_count ?? 0,
    })),
    stepsWithoutCraftHours: row?.stepsWithoutCraftHours ?? row?.steps_without_craft_hours ?? 0,
  };
}

/**
 * The Change Orders Log for one package: the control estimate, active
 * change orders, stored craft rates, and planned labor hours per craft
 * from one database snapshot, with every running figure computed by
 * the pure domain module. Pre-migration (snapshot RPC missing) the
 * panel reports notApplied so it can say the feature isn't available
 * yet instead of failing.
 */
export async function getChangeOrderSummary(db, { ownerId, packageId }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_change_orders_snapshot", {
    p_owner_id: ownerId,
    p_package_id: packageId,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return {
        ok: true,
        summary: {
          ...computeChangeOrderSummary({}),
          notApplied: true,
        },
        changeOrders: [],
        packageStatus: pkg.status,
      };
    }
    return mapChangeOrderRpcError(error);
  }
  const snapshot = toCamelSnapshot(rpcRow(data));
  const summary = computeChangeOrderSummary({
    estimate: snapshot.estimate,
    changeOrders: snapshot.changeOrders,
    craftHours: snapshot.craftHours,
    craftRates: snapshot.craftRates,
    stepsWithoutCraftHours: snapshot.stepsWithoutCraftHours,
  });
  return {
    ok: true,
    summary: { ...summary, notApplied: false },
    changeOrders: snapshot.changeOrders,
    packageStatus: snapshot.packageStatus ?? pkg.status,
  };
}

/** Create a change order in status 'estimated' (owner-scoped RPC, number assigned server-side). */
export async function createChangeOrder(db, { ownerId, packageId, input }) {
  const checked = validateChangeOrderCreateInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_change_order_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_type: checked.value.type,
    p_description: checked.value.description,
    p_cost_code: checked.value.costCode,
    p_afe_no: checked.value.afeNo,
    p_reference_contract_no: checked.value.referenceContractNo,
    p_reference_po_number: checked.value.referencePoNumber,
    p_initiator_name: checked.value.initiatorName,
    p_estimated_cost_cents: checked.value.estimatedCostCents,
    p_schedule_impact_days: checked.value.scheduleImpactDays,
    p_schedule_impact_note: checked.value.scheduleImpactNote,
    p_linked_step_id: checked.value.linkedStepId,
    p_linked_drawing_id: checked.value.linkedDrawingId,
    p_linked_takeoff_line_id: checked.value.linkedTakeoffLineId,
    p_reason: checked.value.reason,
  });
  if (error) return mapChangeOrderRpcError(error);
  return { ok: true, changeOrder: toCamelChangeOrder(rpcRow(data)), packageStatus: pkg.status };
}

/**
 * Edit a change order's fields (never its status or number).
 * A key present in the input is set — null clears an optional field;
 * an absent key keeps the current value.
 */
export async function updateChangeOrder(db, { ownerId, packageId, changeOrderId, input }) {
  const checked = validateChangeOrderUpdateInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const { data, error } = await db.rpc("forge_work_change_order_update", {
    p_owner_id: ownerId,
    p_change_order_id: changeOrderId,
    p_expected_version: checked.value.expectedVersion,
    p_type: input.type ?? null,
    p_description: input.description ?? null,
    p_estimated_cost_cents: has("estimatedCostCents") ? input.estimatedCostCents : null,
    p_set_estimated_cost: has("estimatedCostCents"),
    p_approved_cost_cents: has("approvedCostCents") ? input.approvedCostCents : null,
    p_set_approved_cost: has("approvedCostCents"),
    p_actual_cost_cents: has("actualCostCents") ? input.actualCostCents : null,
    p_set_actual_cost: has("actualCostCents"),
    p_schedule_impact_days: has("scheduleImpactDays") ? input.scheduleImpactDays : null,
    p_set_schedule_impact_days: has("scheduleImpactDays"),
    p_schedule_impact_note: has("scheduleImpactNote") ? input.scheduleImpactNote : null,
    p_set_schedule_impact_note: has("scheduleImpactNote"),
    p_cost_code: has("costCode") ? input.costCode : null,
    p_set_cost_code: has("costCode"),
    p_afe_no: has("afeNo") ? input.afeNo : null,
    p_set_afe_no: has("afeNo"),
    p_reference_contract_no: has("referenceContractNo") ? input.referenceContractNo : null,
    p_set_reference_contract_no: has("referenceContractNo"),
    p_reference_po_number: has("referencePoNumber") ? input.referencePoNumber : null,
    p_set_reference_po_number: has("referencePoNumber"),
    p_initiator_name: has("initiatorName") ? input.initiatorName : null,
    p_set_initiator_name: has("initiatorName"),
    p_po_number: has("poNumber") ? input.poNumber : null,
    p_set_po_number: has("poNumber"),
    p_denial_reason: has("denialReason") ? input.denialReason : null,
    p_set_denial_reason: has("denialReason"),
    p_linked_step_id: has("linkedStepId") ? input.linkedStepId : null,
    p_set_linked_step_id: has("linkedStepId"),
    p_linked_drawing_id: has("linkedDrawingId") ? input.linkedDrawingId : null,
    p_set_linked_drawing_id: has("linkedDrawingId"),
    p_linked_takeoff_line_id: has("linkedTakeoffLineId") ? input.linkedTakeoffLineId : null,
    p_set_linked_takeoff_line_id: has("linkedTakeoffLineId"),
    p_reason: checked.value.reason,
  });
  if (error) return mapChangeOrderRpcError(error);
  return { ok: true, changeOrder: toCamelChangeOrder(rpcRow(data)), packageStatus: pkg.status };
}

/** Move a change order to its next status (owner-scoped RPC, server-side transition table). */
export async function transitionChangeOrder(db, { ownerId, packageId, changeOrderId, input }) {
  const checked = validateChangeOrderTransitionInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_change_order_transition", {
    p_owner_id: ownerId,
    p_change_order_id: changeOrderId,
    p_expected_version: checked.value.expectedVersion,
    p_to_status: checked.value.toStatus,
    p_po_number: checked.value.poNumber,
    p_denial_reason: checked.value.denialReason,
    p_approved_cost_cents: checked.value.approvedCostCents,
    p_reason: checked.value.reason,
  });
  if (error) return mapChangeOrderRpcError(error);
  return { ok: true, changeOrder: toCamelChangeOrder(rpcRow(data)), packageStatus: pkg.status };
}

/** Retire (delete) a change order (owner-scoped RPC, version-guarded with a reason). */
export async function retireChangeOrder(db, { ownerId, packageId, changeOrderId, expectedVersion, reason }) {
  const checkedReason = validateChangeOrderUpdateInput({ expectedVersion, reason });
  if (!checkedReason.ok) return { ok: false, httpStatus: 400, error: checkedReason.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_change_order_retire", {
    p_owner_id: ownerId,
    p_change_order_id: changeOrderId,
    p_expected_version: expectedVersion,
    p_reason: reason.trim(),
  });
  if (error) return mapChangeOrderRpcError(error);
  return { ok: true, changeOrder: toCamelChangeOrder(rpcRow(data)), packageStatus: pkg.status };
}

/** Create or update the package's control estimate (owner-scoped RPC, version-guarded with a reason). */
export async function setControlEstimate(db, { ownerId, packageId, input }) {
  const checked = validateControlEstimateInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_control_estimate_set", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_original_cents: checked.value.originalCents,
    p_current_cents: checked.value.currentCents,
    p_contingency_cents: checked.value.contingencyCents,
    p_expected_version: checked.value.expectedVersion,
    p_reason: checked.value.reason,
  });
  if (error) return mapChangeOrderRpcError(error);
  return { ok: true, estimate: toCamelEstimate(rpcRow(data)), packageStatus: pkg.status };
}

/** Retire (delete) the package's control estimate (owner-scoped RPC, version-guarded with a reason). */
export async function retireControlEstimate(db, { ownerId, packageId, estimateId, expectedVersion, reason }) {
  const checkedReason = validateChangeOrderUpdateInput({ expectedVersion, reason });
  if (!checkedReason.ok) return { ok: false, httpStatus: 400, error: checkedReason.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_control_estimate_retire", {
    p_owner_id: ownerId,
    p_estimate_id: estimateId,
    p_expected_version: expectedVersion,
    p_reason: reason.trim(),
  });
  if (error) return mapChangeOrderRpcError(error);
  return { ok: true, estimate: toCamelEstimate(rpcRow(data)), packageStatus: pkg.status };
}

/** Set a craft's labor rate for one package — upsert (owner-scoped RPC, version-guarded with a reason). */
export async function setCraftRate(db, { ownerId, packageId, input }) {
  const checked = validateCraftRateInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_craft_rate_set", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_craft_key: checked.value.craftKey,
    p_craft_label: checked.value.craftLabel,
    p_rate_cents_per_hour: checked.value.rateCentsPerHour,
    p_expected_version: checked.value.expectedVersion,
    p_reason: checked.value.reason,
  });
  if (error) return mapChangeOrderRpcError(error);
  return { ok: true, craftRate: toCamelCraftRate(rpcRow(data)), packageStatus: pkg.status };
}

/** Retire a stored craft rate — the craft reverts to the $89/hr default (owner-scoped RPC). */
export async function retireCraftRate(db, { ownerId, packageId, rateId, expectedVersion, reason }) {
  const checkedReason = validateChangeOrderUpdateInput({ expectedVersion, reason });
  if (!checkedReason.ok) return { ok: false, httpStatus: 400, error: checkedReason.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_craft_rate_retire", {
    p_owner_id: ownerId,
    p_rate_id: rateId,
    p_expected_version: expectedVersion,
    p_reason: reason.trim(),
  });
  if (error) return mapChangeOrderRpcError(error);
  return { ok: true, craftRate: toCamelCraftRate(rpcRow(data)), packageStatus: pkg.status };
}

/** Versioned change-order history for one change order (bounded paging). */
export async function listChangeOrderRevisions(db, { ownerId, packageId, changeOrderId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (!paging.ok) return paging;
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data: orderRows, error: orderError } = await db
    .from("forge_work_change_orders")
    .select("id, owner_id, work_package_id, change_order_number, type, description, status, version, retired_at")
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId)
    .eq("id", changeOrderId)
    .maybeSingle();
  if (orderError) {
    if (isMissingTableError(orderError)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
    }
    throw orderError;
  }
  if (!orderRows) return { ok: false, httpStatus: 404, error: "Change order not found." };
  const { data, error } = await db
    .from("forge_work_change_order_revisions")
    .select("id, owner_id, change_order_id, version, actor_id, action, old_values, new_values, reason, recorded_at")
    .eq("owner_id", ownerId)
    .eq("change_order_id", changeOrderId)
    .order("version", { ascending: true })
    .order("id", { ascending: true })
    // PostgREST ranges are inclusive: limit=50 is rows offset..offset+49.
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) throw error;
  const revisions = (data ?? []).map(toCamelRevision);
  return {
    ok: true,
    changeOrder: toCamelChangeOrder(orderRows),
    revisions,
    hasMore: revisions.length === paging.limit,
    packageStatus: pkg.status,
  };
}

/** Retired change orders for one package, newest first (bounded paging). */
export async function listRetiredChangeOrders(db, { ownerId, packageId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (!paging.ok) return paging;
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db
    .from("forge_work_change_orders")
    .select("id, owner_id, work_package_id, change_order_number, type, description, cost_code, afe_no, reference_contract_no, reference_po_number, initiator_name, estimated_cost_cents, approved_cost_cents, actual_cost_cents, schedule_impact_days, schedule_impact_note, status, po_number, denial_reason, linked_step_id, linked_drawing_id, linked_takeoff_line_id, version, retired_at, retired_by, created_by, updated_by, created_at, updated_at")
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId)
    .not("retired_at", "is", null)
    .order("change_order_number", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
    }
    throw error;
  }
  const changeOrders = (data ?? []).map(toCamelChangeOrder);
  return {
    ok: true,
    changeOrders,
    hasMore: changeOrders.length === paging.limit,
    packageStatus: pkg.status,
  };
}
