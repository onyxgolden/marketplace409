// Budget allocations (work package planner, D2b) — application service.
//
// Reads go through the D2b snapshot RPCs (single-package allocation
// snapshot + the bounded bulk cost-split snapshot). Writes go through
// the D2b SECURITY DEFINER RPCs only (the RPCs derive the actor from
// auth.uid() and enforce ownership, the estimate binding, the exact
// reconciliation, terminal guards, optimistic versions, and reason
// rules).
//
// The planned labor forecast comes from the existing Slice 8 snapshot
// (getChangeOrderSummary) — it is a comparison only, never added to
// the five-way total.

import {
  BUDGET_CATEGORY_VALUES,
  MAX_COST_SPLIT_PACKAGE_IDS,
  summarizeCostSplit,
  validateBudgetAllocationInput,
  validateBudgetAllocationRetireInput,
} from "@/domains/work-management/budgetAllocations";
import { getChangeOrderSummary } from "./changeOrders.js";

export const NOT_APPLIED_ERROR =
  "Budget allocation isn't available yet — the database change for this feature hasn't been applied.";

const COST_SPLIT_CHUNK_SIZE = MAX_COST_SPLIT_PACKAGE_IDS;

function isMissingTableError(error) {
  return error?.code === "42P01" || String(error?.message || "").includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return String(error.message || error || "").includes("Could not find the function");
}

/**
 * Maps a D2b RPC failure to a plain-English { ok, httpStatus, error }
 * result. Unknown failures throw, like workSteps.js — the route turns
 * them into a 500.
 */
export function mapBudgetAllocationRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP2B_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Budget allocation not found." };
  }
  if (message.includes("WPP2B_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP2B_ESTIMATE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Control estimate not found." };
  }
  if (message.includes("WPP2B_ALLOCATION_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Budget allocation not found." };
  }
  if (message.includes("WPP2B_ESTIMATE_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "The control estimate changed — refresh and try again." };
  }
  if (message.includes("WPP2B_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "The budget allocation was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP2B_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — the budget allocation is read-only." };
  }
  if (message.includes("WPP2B_INVALID_CATEGORY")) {
    return { ok: false, httpStatus: 400, error: "Category must be labor, material, equipment, external services, or rental." };
  }
  if (message.includes("WPP2B_INVALID_DESCRIPTION")) {
    return { ok: false, httpStatus: 400, error: "Description is required (1–200 characters, no markup)." };
  }
  if (message.includes("WPP2B_INVALID_AMOUNT")) {
    return { ok: false, httpStatus: 400, error: "Amounts must be whole numbers of cents (1 or more)." };
  }
  if (message.includes("WPP2B_INVALID_LINE_ID") || message.includes("WPP2B_LINE_NOT_FOUND")) {
    return { ok: false, httpStatus: 400, error: "A budget line does not belong to this allocation — refresh and try again." };
  }
  if (message.includes("WPP2B_DUPLICATE_LINE_ID")) {
    return { ok: false, httpStatus: 400, error: "Each line may appear only once in an allocation." };
  }
  if (message.includes("WPP2B_TOO_MANY_LINES")) {
    return { ok: false, httpStatus: 400, error: "An allocation holds at most 100 lines." };
  }
  if (message.includes("WPP2B_TOO_MANY_PACKAGES")) {
    return { ok: false, httpStatus: 400, error: "Too many packages for one cost-split read." };
  }
  if (message.includes("WPP2B_INVALID_LINES")) {
    return { ok: false, httpStatus: 400, error: "Lines must be a list of budget lines." };
  }
  if (message.includes("WPP2B_SUM_MISMATCH")) {
    return { ok: false, httpStatus: 400, error: "The lines must add up to the current control estimate exactly." };
  }
  if (message.includes("WPP2B_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (message.includes("WPP2B_REASON_TOO_LONG") || message.includes("WPP2B_INVALID_REASON")) {
    return { ok: false, httpStatus: 400, error: "Reason must be at most 1,000 characters." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Budget allocation RPC returned no row.");
  return row;
}

async function requirePackage(db, ownerId, packageId) {
  const { data, error } = await db
    .from("forge_work_packages")
    .select("id, code, title, status")
    .eq("owner_id", ownerId)
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, httpStatus: 404, error: "Work package not found." };
  return { ok: true, package: data };
}

function toCamelEstimate(row) {
  if (!row) return null;
  return {
    id: row.id,
    workPackageId: row.workPackageId ?? row.work_package_id,
    originalControlEstimateCents:
      row.originalControlEstimateCents ?? row.original_control_estimate_cents,
    currentControlEstimateCents:
      row.currentEstimateCents ?? row.current_estimate_cents,
    contingencyCents: row.contingencyCents ?? row.contingency_cents,
    version: row.version,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

function toCamelLine(row) {
  if (!row) return null;
  const amount = row.amountCents ?? row.amount_cents;
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    amountCents: amount == null ? null : Number(amount),
    sortOrder: row.sortOrder ?? row.sort_order ?? 0,
  };
}

function toCamelAllocation(row) {
  if (!row) return null;
  return {
    id: row.id,
    workPackageId: row.workPackageId ?? row.work_package_id,
    controlEstimateId: row.controlEstimateId ?? row.control_estimate_id,
    controlEstimateVersion: row.controlEstimateVersion ?? row.control_estimate_version,
    allocatedTotalCents: row.allocatedTotalCents ?? row.allocated_total_cents,
    version: row.version,
    lines: (row.lines ?? []).map(toCamelLine),
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

function toCamelCostEntry(row) {
  if (!row) return null;
  const totals = row.allocation?.categoryTotals ?? row.allocation?.category_totals ?? {};
  const categoryTotals = Object.fromEntries(
    BUDGET_CATEGORY_VALUES.map((value) => [
      value,
      totals[value] == null ? 0 : Number(totals[value]),
    ]),
  );
  return {
    packageId: row.packageId ?? row.package_id,
    estimate: row.estimate
      ? {
          id: row.estimate.id,
          version: row.estimate.version,
          currentEstimateCents:
            row.estimate.currentEstimateCents ?? row.estimate.current_estimate_cents,
        }
      : null,
    allocation: row.allocation
      ? {
          id: row.allocation.id,
          version: row.allocation.version,
          estimateId: row.allocation.estimateId ?? row.allocation.estimate_id,
          estimateVersion: row.allocation.estimateVersion ?? row.allocation.estimate_version,
          categoryTotals,
        }
      : null,
    reconciled: row.reconciled === true,
    reason: row.reason ?? null,
  };
}

/**
 * The budget allocation for one package: the active control estimate,
 * the active allocation with its lines, and the current Slice 8
 * planned labor forecast (a comparison only — never added to the
 * five-way total). Pre-migration (snapshot RPC missing) the panel
 * reports notApplied so it can say the feature isn't available yet
 * instead of failing.
 */
export async function getBudgetAllocation(db, { ownerId, packageId }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const [snapshotResult, laborResult] = await Promise.all([
    db.rpc("forge_work_budget_allocation_snapshot", {
      p_owner_id: ownerId,
      p_package_id: packageId,
    }),
    getChangeOrderSummary(db, { ownerId, packageId }).catch(() => null),
  ]);
  const { data, error } = snapshotResult;
  if (error) {
    if (isMissingRpcError(error)) {
      return {
        ok: true,
        notApplied: true,
        packageCode: pkg.package.code ?? null,
        packageTitle: pkg.package.title ?? null,
        packageStatus: pkg.package.status,
        estimate: null,
        allocation: null,
        plannedLaborForecastCents: null,
      };
    }
    return mapBudgetAllocationRpcError(error);
  }
  const snapshot = rpcRow(data);
  const laborSummary = laborResult?.ok ? laborResult.summary : null;
  return {
    ok: true,
    notApplied: false,
    packageCode: pkg.package.code ?? null,
    packageTitle: pkg.package.title ?? null,
    packageStatus: snapshot.packageStatus ?? snapshot.package_status ?? pkg.package.status,
    estimate: toCamelEstimate(snapshot.estimate ?? null),
    allocation: toCamelAllocation(snapshot.allocation ?? null),
    plannedLaborForecastCents: laborSummary?.laborCostCents ?? null,
  };
}

/** Publish a full allocation set for one package (create or replace — the RPC decides by version). */
export async function replaceBudgetAllocation(db, { ownerId, packageId, input }) {
  const checked = validateBudgetAllocationInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_budget_allocation_replace", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_expected_allocation_version: checked.value.expectedAllocationVersion,
    p_expected_estimate_id: checked.value.expectedEstimateId,
    p_expected_estimate_version: checked.value.expectedEstimateVersion,
    p_lines: checked.value.lines.map((line) => ({
      id: line.id,
      category: line.category,
      description: line.description,
      amountCents: line.amountCents,
    })),
    p_reason: checked.value.reason,
  });
  if (error) return mapBudgetAllocationRpcError(error);
  const saved = rpcRow(data);
  return {
    ok: true,
    allocation: toCamelAllocation(saved.allocation ?? null),
    categoryTotals: saved.categoryTotals ?? saved.category_totals ?? null,
    packageStatus: pkg.package.status,
  };
}

/** Retire (delete) a package's budget allocation (owner-scoped RPC, version-guarded with a reason). */
export async function retireBudgetAllocation(db, { ownerId, packageId, input }) {
  const checked = validateBudgetAllocationRetireInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_budget_allocation_retire", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_expected_version: checked.value.expectedVersion,
    p_reason: checked.value.reason,
  });
  if (error) return mapBudgetAllocationRpcError(error);
  return { ok: true, allocation: rpcRow(data), packageStatus: pkg.package.status };
}

/**
 * The canonical cost split for the dashboard: one bounded bulk read
 * for the whole in-scope project (never per-package). Returns the
 * pure cost summary alongside the per-package map, so the page and
 * the shell share one reconciliation. A failure (or the budget
 * tables not being set up yet) reports notApplied — the widget says
 * so instead of showing zeros.
 */
export async function listCostSplitForPackages(db, { ownerId, packages }) {
  const rows = Array.isArray(packages) ? packages : [];
  if (rows.length === 0) {
    return {
      ok: true,
      notApplied: false,
      byPackage: {},
      summary: summarizeCostSplit({ packages: [], costByPackage: {} }),
    };
  }
  const ids = [...new Set(rows.map((pkg) => pkg?.id).filter(Boolean))];
  const byPackage = {};
  for (let offset = 0; offset < ids.length; offset += COST_SPLIT_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + COST_SPLIT_CHUNK_SIZE);
    const { data, error } = await db.rpc("forge_work_cost_split_snapshot", {
      p_owner_id: ownerId,
      p_package_ids: chunk,
    });
    if (error) {
      if (isMissingRpcError(error) || isMissingTableError(error)) {
        return { ok: true, notApplied: true, byPackage: {}, summary: null };
      }
      return mapBudgetAllocationRpcError(error);
    }
    for (const row of data ?? []) {
      const entry = toCamelCostEntry(row);
      if (entry?.packageId) byPackage[entry.packageId] = entry;
    }
  }
  // The RPC returns a row for every owned package id; an id with no
  // row cannot be an in-scope package, so it reads as no estimate —
  // excluded from the strip, never a false total.
  for (const id of ids) {
    if (!byPackage[id]) {
      byPackage[id] = { packageId: id, estimate: null, allocation: null, reconciled: false, reason: "no_estimate" };
    }
  }
  return {
    ok: true,
    notApplied: false,
    byPackage,
    summary: summarizeCostSplit({ packages: rows, costByPackage: byPackage }),
  };
}
