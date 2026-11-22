// D2b budget allocations — application-service tests.
//
// The service talks to Supabase through a fake client (rpc + the
// package lookup chain); the Slice 8 labor-forecast read is mocked.
// Proves:
//   - getBudgetAllocation maps the camelCase snapshot RPC shape and
//     the Slice 8 planned-labor forecast (comparison only — the
//     forecast is returned beside the allocation, never added to
//     any total);
//   - getBudgetAllocation reports notApplied when the snapshot RPC
//     is missing, and 404s a missing package without calling it;
//   - replace/retire validate input client-side (400, RPC never
//     called), pass the exact RPC arguments, and map RPC failures
//     to plain-English statuses;
//   - listCostSplitForPackages chunks above 500 ids, dedupes ids,
//     synthesizes no_estimate entries for ids the RPC never returns,
//     and reports notApplied on a missing RPC/table;
//   - mapBudgetAllocationRpcError maps every WPP2B_* code and throws
//     unknown failures through (the route turns them into a 500).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./changeOrders.js", () => ({
  getChangeOrderSummary: vi.fn(),
}));

import { getChangeOrderSummary } from "./changeOrders.js";
import {
  getBudgetAllocation,
  replaceBudgetAllocation,
  retireBudgetAllocation,
  listCostSplitForPackages,
  mapBudgetAllocationRpcError,
  NOT_APPLIED_ERROR,
} from "./budgetAllocations.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const PKG_ROW = { id: "pkg_a", code: "SYN-A", title: "Synthetic exchanger [SYNTHETIC]", status: "in_progress" };

const SNAPSHOT = {
  packageStatus: "in_progress",
  estimate: {
    id: "est_a",
    currentEstimateCents: 250000,
    originalControlEstimateCents: 250000,
    contingencyCents: null,
    version: 1,
  },
  allocation: {
    id: "forge_wba_x",
    workPackageId: "pkg_a",
    controlEstimateId: "est_a",
    controlEstimateVersion: 1,
    allocatedTotalCents: 250000,
    version: 1,
    lines: [
      { id: "forge_wbl_1", category: "labor", description: "Crew", amountCents: 150000, sortOrder: 0 },
      { id: "forge_wbl_2", category: "material", description: "Pipe", amountCents: 100000, sortOrder: 1 },
    ],
  },
};

function fakeDb({ pkg = PKG_ROW, rpc = vi.fn() } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: pkg, error: null })),
  };
  return { from: vi.fn(() => chain), rpc, __chain: chain };
}

function rpcError(message, code = "P0001") {
  return { data: null, error: { message, code } };
}

const REPLACE_INPUT = {
  expectedAllocationVersion: 0,
  expectedEstimateId: "est_a",
  expectedEstimateVersion: 1,
  lines: [
    { category: "labor", description: "Crew", amountCents: 150000 },
    { category: "material", description: "Pipe", amountCents: 100000 },
  ],
  reason: "First allocation",
};

describe("getBudgetAllocation", () => {
  beforeEach(() => vi.mocked(getChangeOrderSummary).mockResolvedValue({
    ok: true,
    summary: { laborCostCents: 90000, notApplied: false },
    changeOrders: [],
    packageStatus: "in_progress",
  }));

  it("maps the snapshot and the labor forecast beside it, never merged into the total", async () => {
    const db = fakeDb({ rpc: vi.fn(async () => ({ data: SNAPSHOT, error: null })) });
    const result = await getBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_a" });
    expect(result.ok).toBe(true);
    expect(result.notApplied).toBe(false);
    expect(result.packageCode).toBe("SYN-A");
    expect(result.packageTitle).toBe("Synthetic exchanger [SYNTHETIC]");
    expect(result.estimate.currentControlEstimateCents).toBe(250000);
    expect(result.estimate.originalControlEstimateCents).toBe(250000);
    expect(result.allocation.id).toBe("forge_wba_x");
    expect(result.allocation.allocatedTotalCents).toBe(250000);
    expect(result.allocation.lines).toEqual([
      { id: "forge_wbl_1", category: "labor", description: "Crew", amountCents: 150000, sortOrder: 0 },
      { id: "forge_wbl_2", category: "material", description: "Pipe", amountCents: 100000, sortOrder: 1 },
    ]);
    // The forecast is a comparison only: it arrives as its own field
    // and the allocation total is untouched by it.
    expect(result.plannedLaborForecastCents).toBe(90000);
    expect(result.allocation.allocatedTotalCents).toBe(250000);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_budget_allocation_snapshot", {
      p_owner_id: OWNER_A,
      p_package_id: "pkg_a",
    });
  });

  it("returns a null allocation for an unallocated package", async () => {
    const db = fakeDb({ rpc: vi.fn(async () => ({ data: { ...SNAPSHOT, allocation: null }, error: null })) });
    const result = await getBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_a" });
    expect(result.ok).toBe(true);
    expect(result.allocation).toBeNull();
    expect(result.estimate.id).toBe("est_a");
  });

  it("reports notApplied when the snapshot RPC is missing, with the package identity intact", async () => {
    const db = fakeDb({ rpc: vi.fn(async () => rpcError("Could not find the function public.forge_work_budget_allocation_snapshot", "42883")) });
    const result = await getBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_a" });
    expect(result).toEqual({
      ok: true,
      notApplied: true,
      packageCode: "SYN-A",
      packageTitle: "Synthetic exchanger [SYNTHETIC]",
      packageStatus: "in_progress",
      estimate: null,
      allocation: null,
      plannedLaborForecastCents: null,
    });
  });

  it("404s a missing package without calling the RPC", async () => {
    const db = fakeDb({ pkg: null, rpc: vi.fn() });
    const result = await getBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_missing" });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps a stale-allocation RPC failure to 409", async () => {
    const db = fakeDb({ rpc: vi.fn(async () => rpcError("WPP2B_VERSION_CONFLICT")) });
    const result = await getBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_a" });
    expect(result).toEqual({
      ok: false,
      httpStatus: 409,
      error: "The budget allocation was changed by someone else — refresh and try again.",
    });
  });
});

// The labor-forecast failure case lives in its own describe: in this
// repo's Vitest version a beforeEach mockResolvedValue combined with
// a per-test mockRejectedValue on the same mock reports the caught
// rejection as a test failure, even though the service returns the
// allocation correctly. Setting the rejection here, with no
// beforeEach resolve, proves the same behavior without that artifact.
describe("getBudgetAllocation when the labor forecast read fails", () => {
  it("still returns the allocation, with a null forecast", async () => {
    vi.mocked(getChangeOrderSummary).mockRejectedValue(new Error("boom"));
    const db = fakeDb({ rpc: vi.fn(async () => ({ data: SNAPSHOT, error: null })) });
    const result = await getBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_a" });
    expect(result.ok).toBe(true);
    expect(result.plannedLaborForecastCents).toBeNull();
    expect(result.allocation.allocatedTotalCents).toBe(250000);
  });
});

describe("replaceBudgetAllocation", () => {
  it("validates client-side and never calls the RPC on bad input", async () => {
    const db = fakeDb({ rpc: vi.fn() });
    const result = await replaceBudgetAllocation(db, {
      ownerId: OWNER_A,
      packageId: "pkg_a",
      input: { ...REPLACE_INPUT, reason: "" },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("passes the exact RPC arguments and returns the saved allocation with category totals", async () => {
    const saved = {
      allocation: SNAPSHOT.allocation,
      categoryTotals: { labor: 150000, material: 100000, equipment: 0, external_services: 0, rental: 0 },
      lines: SNAPSHOT.allocation.lines,
    };
    const rpc = vi.fn(async () => ({ data: saved, error: null }));
    const db = fakeDb({ rpc });
    const result = await replaceBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_a", input: REPLACE_INPUT });
    expect(rpc).toHaveBeenCalledWith("forge_work_budget_allocation_replace", {
      p_owner_id: OWNER_A,
      p_package_id: "pkg_a",
      p_expected_allocation_version: 0,
      p_expected_estimate_id: "est_a",
      p_expected_estimate_version: 1,
      p_lines: [
        { id: null, category: "labor", description: "Crew", amountCents: 150000 },
        { id: null, category: "material", description: "Pipe", amountCents: 100000 },
      ],
      p_reason: "First allocation",
    });
    expect(result.ok).toBe(true);
    expect(result.allocation.id).toBe("forge_wba_x");
    expect(result.categoryTotals).toEqual({ labor: 150000, material: 100000, equipment: 0, external_services: 0, rental: 0 });
    expect(result.packageStatus).toBe("in_progress");
  });

  it("maps a sum-mismatch RPC failure to a 400 with the reason in plain words", async () => {
    const db = fakeDb({ rpc: vi.fn(async () => rpcError("WPP2B_SUM_MISMATCH")) });
    const result = await replaceBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_a", input: REPLACE_INPUT });
    expect(result).toEqual({
      ok: false,
      httpStatus: 400,
      error: "The lines must add up to the current control estimate exactly.",
    });
  });

  it("404s a missing package without calling the RPC", async () => {
    const db = fakeDb({ pkg: null, rpc: vi.fn() });
    const result = await replaceBudgetAllocation(db, { ownerId: OWNER_A, packageId: "pkg_missing", input: REPLACE_INPUT });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("retireBudgetAllocation", () => {
  it("passes the exact RPC arguments and returns the retire result", async () => {
    const rpc = vi.fn(async () => ({ data: { retired: true, version: 2 }, error: null }));
    const db = fakeDb({ rpc });
    const result = await retireBudgetAllocation(db, {
      ownerId: OWNER_A,
      packageId: "pkg_a",
      input: { expectedVersion: 1, reason: "Wrong split" },
    });
    expect(rpc).toHaveBeenCalledWith("forge_work_budget_allocation_retire", {
      p_owner_id: OWNER_A,
      p_package_id: "pkg_a",
      p_expected_version: 1,
      p_reason: "Wrong split",
    });
    expect(result).toEqual({
      ok: true,
      allocation: { retired: true, version: 2 },
      packageStatus: "in_progress",
    });
  });

  it("validates client-side (version and reason) without calling the RPC", async () => {
    const db = fakeDb({ rpc: vi.fn() });
    const noVersion = await retireBudgetAllocation(db, {
      ownerId: OWNER_A, packageId: "pkg_a", input: { expectedVersion: 0, reason: "x" },
    });
    expect(noVersion.ok).toBe(false);
    expect(noVersion.httpStatus).toBe(400);
    const noReason = await retireBudgetAllocation(db, {
      ownerId: OWNER_A, packageId: "pkg_a", input: { expectedVersion: 1, reason: "  " },
    });
    expect(noReason.ok).toBe(false);
    expect(noReason.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps a stale-version RPC failure to 409", async () => {
    const db = fakeDb({ rpc: vi.fn(async () => rpcError("WPP2B_VERSION_CONFLICT")) });
    const result = await retireBudgetAllocation(db, {
      ownerId: OWNER_A, packageId: "pkg_a", input: { expectedVersion: 1, reason: "Wrong split" },
    });
    expect(result.httpStatus).toBe(409);
  });
});

describe("listCostSplitForPackages", () => {
  const COST_ROW_A = {
    packageId: "pkg_a",
    estimate: { id: "est_a", version: 1, currentEstimateCents: 250000 },
    allocation: {
      id: "forge_wba_a", version: 1, estimateId: "est_a", estimateVersion: 1,
      categoryTotals: { labor: 100000, material: 80000, equipment: 40000, external_services: 20000, rental: 10000 },
    },
    reconciled: true,
    reason: null,
  };
  const COST_ROW_B = {
    package_id: "pkg_b",
    estimate: { id: "est_b", version: 1, current_estimate_cents: 100000 },
    allocation: null,
    reconciled: false,
    reason: "missing",
  };

  it("returns the summary alongside the per-package map, with the strip equal to the estimate sum", async () => {
    const rpc = vi.fn(async () => ({ data: [COST_ROW_A, COST_ROW_B], error: null }));
    const db = fakeDb({ rpc });
    const result = await listCostSplitForPackages(db, {
      ownerId: OWNER_A,
      packages: [{ id: "pkg_a", status: "in_progress" }, { id: "pkg_b", status: "in_progress" }],
    });
    expect(result.ok).toBe(true);
    expect(result.notApplied).toBe(false);
    expect(result.byPackage.pkg_a.reconciled).toBe(true);
    expect(result.byPackage.pkg_a.allocation.categoryTotals.labor).toBe(100000);
    // The snake_case row maps the same way.
    expect(result.byPackage.pkg_b.estimate.currentEstimateCents).toBe(100000);
    expect(result.byPackage.pkg_b.reconciled).toBe(false);
    expect(result.summary.totalControlEstimateCents).toBe(350000);
    expect(result.summary.categoryTotals).toEqual({
      labor: 100000, material: 80000, equipment: 40000, external_services: 20000, rental: 10000,
    });
    expect(result.summary.complete).toBe(false);
    expect(result.summary.unallocatedPackageCount).toBe(1);
    expect(result.summary.unallocatedEstimateCents).toBe(100000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("synthesizes a no_estimate entry for an id the RPC never returns", async () => {
    const rpc = vi.fn(async () => ({ data: [COST_ROW_A], error: null }));
    const db = fakeDb({ rpc });
    const result = await listCostSplitForPackages(db, {
      ownerId: OWNER_A,
      packages: [{ id: "pkg_a", status: "in_progress" }, { id: "pkg_gone", status: "in_progress" }],
    });
    expect(result.byPackage.pkg_gone).toEqual({
      packageId: "pkg_gone", estimate: null, allocation: null, reconciled: false, reason: "no_estimate",
    });
    expect(result.summary.noEstimatePackageCount).toBe(1);
    expect(result.summary.totalControlEstimateCents).toBe(250000);
  });

  it("chunks above 500 ids and dedupes", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const db = fakeDb({ rpc });
    const ids = Array.from({ length: 501 }, (_, i) => ({ id: `pkg_${i % 250}`, status: "in_progress" }));
    const result = await listCostSplitForPackages(db, { ownerId: OWNER_A, packages: ids });
    expect(result.ok).toBe(true);
    // 250 unique ids: one chunk only.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_package_ids).toHaveLength(250);
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `pkg_${i}`, status: "in_progress" }));
    rpc.mockClear();
    await listCostSplitForPackages(db, { ownerId: OWNER_A, packages: many });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_package_ids).toHaveLength(500);
    expect(rpc.mock.calls[1][1].p_package_ids).toHaveLength(1);
  });

  it("returns an empty summary for an empty package list without calling the RPC", async () => {
    const db = fakeDb({ rpc: vi.fn() });
    const result = await listCostSplitForPackages(db, { ownerId: OWNER_A, packages: [] });
    expect(result.ok).toBe(true);
    expect(result.notApplied).toBe(false);
    expect(result.byPackage).toEqual({});
    expect(result.summary.complete).toBe(false);
    expect(result.summary.totalControlEstimateCents).toBe(0);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("reports notApplied on a missing RPC and on a missing table", async () => {
    const missingRpc = fakeDb({ rpc: vi.fn(async () => rpcError("Could not find the function", "42883")) });
    const rpcResult = await listCostSplitForPackages(missingRpc, {
      ownerId: OWNER_A, packages: [{ id: "pkg_a", status: "in_progress" }],
    });
    expect(rpcResult).toEqual({ ok: true, notApplied: true, byPackage: {}, summary: null });
    const missingTable = fakeDb({ rpc: vi.fn(async () => ({ data: null, error: { message: 'relation "forge_work_budget_allocations" does not exist', code: "42P01" } })) });
    const tableResult = await listCostSplitForPackages(missingTable, {
      ownerId: OWNER_A, packages: [{ id: "pkg_a", status: "in_progress" }],
    });
    expect(tableResult).toEqual({ ok: true, notApplied: true, byPackage: {}, summary: null });
  });

  it("maps a workspace-forbidden RPC failure to 404", async () => {
    const db = fakeDb({ rpc: vi.fn(async () => rpcError("WPP2B_WORKSPACE_FORBIDDEN")) });
    const result = await listCostSplitForPackages(db, {
      ownerId: OWNER_A, packages: [{ id: "pkg_a", status: "in_progress" }],
    });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Budget allocation not found." });
  });
});

describe("mapBudgetAllocationRpcError", () => {
  it.each([
    ["WPP2B_WORKSPACE_FORBIDDEN", 404, "Budget allocation not found."],
    ["WPP2B_PACKAGE_NOT_FOUND", 404, "Work package not found."],
    ["WPP2B_ESTIMATE_NOT_FOUND", 404, "Control estimate not found."],
    ["WPP2B_ALLOCATION_NOT_FOUND", 404, "Budget allocation not found."],
    ["WPP2B_ESTIMATE_CONFLICT", 409, "The control estimate changed — refresh and try again."],
    ["WPP2B_VERSION_CONFLICT", 409, "The budget allocation was changed by someone else — refresh and try again."],
    ["WPP2B_PACKAGE_TERMINAL", 409, "This work package is closed — the budget allocation is read-only."],
    ["WPP2B_INVALID_CATEGORY", 400, "Category must be labor, material, equipment, external services, or rental."],
    ["WPP2B_INVALID_DESCRIPTION", 400, "Description is required (1–200 characters, no markup)."],
    ["WPP2B_INVALID_AMOUNT", 400, "Amounts must be whole numbers of cents (1 or more)."],
    ["WPP2B_LINE_NOT_FOUND", 400, "A budget line does not belong to this allocation — refresh and try again."],
    ["WPP2B_DUPLICATE_LINE_ID", 400, "Each line may appear only once in an allocation."],
    ["WPP2B_TOO_MANY_LINES", 400, "An allocation holds at most 100 lines."],
    ["WPP2B_TOO_MANY_PACKAGES", 400, "Too many packages for one cost-split read."],
    ["WPP2B_SUM_MISMATCH", 400, "The lines must add up to the current control estimate exactly."],
    ["WPP2B_REASON_REQUIRED", 400, "A reason is required for this change."],
  ])("maps %s to %s", (code, status, message) => {
    expect(mapBudgetAllocationRpcError(new Error(code))).toEqual({ ok: false, httpStatus: status, error: message });
  });

  it("maps a missing function to the 503 not-applied result", () => {
    expect(mapBudgetAllocationRpcError({ message: "Could not find the function", code: "42883" })).toEqual({
      ok: false,
      httpStatus: 503,
      error: NOT_APPLIED_ERROR,
    });
  });

  it("throws unknown failures through for a 500", () => {
    const boom = new Error("connection reset");
    expect(() => mapBudgetAllocationRpcError(boom)).toThrow(boom);
  });
});
