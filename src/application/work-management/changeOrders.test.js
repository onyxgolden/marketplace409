// Work Package Planner slice 8 — application tests. Supabase-shaped
// chain mock, same shape as manpowerCurve.test.js. Writes go through
// the slice-8 SECURITY DEFINER RPCs only (the RPCs derive the actor
// from auth.uid() and enforce ownership, the status machine, terminal
// guards, optimistic versions, and reason rules) — so these tests prove
// the service maps inputs to exactly those RPCs, never writes a table
// directly, validates before touching the database, and turns every
// WPP8_* failure into plain English. Also covers the pre-migration
// window: a missing snapshot RPC reads as notApplied, and a missing
// revisions table reports 503, never a raw error.

import { describe, expect, it, vi } from "vitest";
import {
  NOT_APPLIED_ERROR,
  createChangeOrder,
  getChangeOrderSummary,
  listChangeOrderRevisions,
  listRetiredChangeOrders,
  mapChangeOrderRpcError,
  retireChangeOrder,
  retireCraftRate,
  setControlEstimate,
  setCraftRate,
  transitionChangeOrder,
  updateChangeOrder,
} from "./changeOrders.js";

function mockDb(chains = [], rpcResults = []) {
  const queue = [...chains];
  const rpcQueue = [...rpcResults];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
    rpc: vi.fn(async () => {
      if (rpcQueue.length === 0) throw new Error("mockDb: rpc() called more times than results queued");
      return rpcQueue.shift();
    }),
  };
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    gte: vi.fn(() => node), lte: vi.fn(() => node), is: vi.fn(() => node),
    not: vi.fn(() => node), in: vi.fn(() => node),
    range: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const PKG = "pkg_1";
const PKG_ROW = { id: PKG, status: "in_progress" };
const pkgChain = () => chain({ data: PKG_ROW, error: null });

const CO_ROW = {
  id: "forge_wco_1", work_package_id: PKG, change_order_number: 1,
  type: "bust", description: "Rework spool 7", cost_code: null, afe_no: null,
  reference_contract_no: null, reference_po_number: null, initiator_name: null,
  estimated_cost_cents: 12000, approved_cost_cents: null, actual_cost_cents: null,
  schedule_impact_days: null, schedule_impact_note: null, status: "estimated",
  po_number: null, denial_reason: null,
  linked_step_id: null, linked_drawing_id: null, linked_takeoff_line_id: null,
  version: 1, retired_at: null, retired_by: null,
  created_by: "user_9", updated_by: "user_9", created_at: "t0", updated_at: "t0",
};

const SNAPSHOT_ROW = {
  packageStatus: "in_progress",
  estimate: {
    id: "forge_wce_1", work_package_id: PKG,
    original_control_estimate_cents: 250000, current_estimate_cents: 250000,
    contingency_cents: 50000, version: 1, created_at: "t0", updated_at: "t0",
  },
  changeOrders: [{
    ...CO_ROW, status: "approved", approved_cost_cents: 12000, version: 2,
  }],
  craftRates: [],
  craftHours: [{
    craft_key: "pipefitter", craft_label: "Pipefitter",
    planned_hours: "40.00", step_count: 2,
  }],
  stepsWithoutCraftHours: 0,
};

describe("getChangeOrderSummary", () => {
  it("reads one snapshot RPC and computes the running figures from it", async () => {
    const db = mockDb([pkgChain()], [{ data: SNAPSHOT_ROW, error: null }]);
    const result = await getChangeOrderSummary(db, { ownerId: OWNER, packageId: PKG });
    expect(result.ok).toBe(true);
    expect(result.summary.notApplied).toBe(false);
    expect(result.summary.hasEstimate).toBe(true);
    expect(result.summary.currentEstimateCents).toBe(250000);
    // Approved $120 bust rolls into the running contract price; the
    // 40 pipefitter hours at the $89 default add $3,560 of labor.
    expect(result.summary.runningContractPriceCents).toBe(262000);
    expect(result.summary.laborCostCents).toBe(356000);
    expect(result.summary.totalJobCostCents).toBe(262000 + 356000);
    expect(result.summary.laborByCraft[0].isDefaultRate).toBe(true);
    expect(result.changeOrders).toHaveLength(1);
    expect(result.packageStatus).toBe("in_progress");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_change_orders_snapshot", {
      p_owner_id: OWNER, p_package_id: PKG,
    });
  });

  it("reports notApplied when the snapshot RPC is missing (pre-migration)", async () => {
    const db = mockDb([pkgChain()], [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }]);
    const result = await getChangeOrderSummary(db, { ownerId: OWNER, packageId: PKG });
    expect(result.ok).toBe(true);
    expect(result.summary.notApplied).toBe(true);
    expect(result.summary.hasEstimate).toBe(false);
    expect(result.summary.runningContractPriceCents).toBeNull();
    expect(result.changeOrders).toEqual([]);
  });

  it("returns 404 when the package does not belong to the owner", async () => {
    const db = mockDb([chain({ data: null, error: null })], []);
    const result = await getChangeOrderSummary(db, { ownerId: OWNER, packageId: PKG });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("createChangeOrder", () => {
  const input = {
    type: "bust", description: "Rework spool 7", estimatedCostCents: 12000,
    reason: "Shop piece arrived wrong",
  };

  it("validates before touching the database and maps the RPC row", async () => {
    const db = mockDb([pkgChain()], [{ data: CO_ROW, error: null }]);
    const result = await createChangeOrder(db, { ownerId: OWNER, packageId: PKG, input });
    expect(result.ok).toBe(true);
    expect(result.changeOrder.changeOrderNumber).toBe(1);
    expect(result.changeOrder.status).toBe("estimated");
    expect(result.packageStatus).toBe("in_progress");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_change_order_create", expect.objectContaining({
      p_owner_id: OWNER, p_package_id: PKG, p_type: "bust",
      p_description: "Rework spool 7", p_estimated_cost_cents: 12000,
      p_reason: "Shop piece arrived wrong",
    }));
  });

  it("rejects an invalid type with 400 and never calls the RPC", async () => {
    const db = mockDb([], []);
    const result = await createChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, input: { ...input, type: "scope_change" },
    });
    expect(result).toEqual({
      ok: false, httpStatus: 400,
      error: "Type must be one of the change order types.",
    });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps a terminal-package RPC failure to 409", async () => {
    const db = mockDb([pkgChain()], [{ data: null, error: { message: "WPP8_PACKAGE_TERMINAL" } }]);
    const result = await createChangeOrder(db, { ownerId: OWNER, packageId: PKG, input });
    expect(result).toEqual({
      ok: false, httpStatus: 409,
      error: "This work package is closed — the Change Orders Log is read-only.",
    });
  });
});

describe("updateChangeOrder", () => {
  it("sends set-flags only for keys present in the input", async () => {
    const db = mockDb([pkgChain()], [{ data: { ...CO_ROW, version: 2 }, error: null }]);
    const result = await updateChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1",
      input: { expectedVersion: 1, estimatedCostCents: 15000, reason: "Revised quote" },
    });
    expect(result.ok).toBe(true);
    expect(result.changeOrder.version).toBe(2);
    const args = db.rpc.mock.calls[0][1];
    expect(args.p_set_estimated_cost).toBe(true);
    expect(args.p_estimated_cost_cents).toBe(15000);
    // Absent keys are not set — they keep the current value.
    expect(args.p_set_approved_cost).toBe(false);
    expect(args.p_set_actual_cost).toBe(false);
    // Type and description have no set-flag: null means keep.
    expect(args.p_type).toBeNull();
    expect(args.p_description).toBeNull();
  });

  it("a present key with null clears that field", async () => {
    const db = mockDb([pkgChain()], [{ data: { ...CO_ROW, version: 2 }, error: null }]);
    await updateChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1",
      input: { expectedVersion: 1, costCode: null, reason: "Clearing the code" },
    });
    const args = db.rpc.mock.calls[0][1];
    expect(args.p_set_cost_code).toBe(true);
    expect(args.p_cost_code).toBeNull();
  });

  it("rejects a missing reason with 400 before the package check", async () => {
    const db = mockDb([], []);
    const result = await updateChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1",
      input: { expectedVersion: 1, reason: "   " },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("transitionChangeOrder", () => {
  it("maps a version conflict to 409", async () => {
    const db = mockDb([pkgChain()], [{ data: null, error: { message: "WPP8_VERSION_CONFLICT" } }]);
    const result = await transitionChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1",
      input: { expectedVersion: 1, toStatus: "approved", reason: "Approved" },
    });
    expect(result).toEqual({
      ok: false, httpStatus: 409,
      error: "The Change Orders Log was changed by someone else — refresh and try again.",
    });
  });

  it("rejects an unknown status with 400 before touching the database", async () => {
    const db = mockDb([], []);
    const result = await transitionChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1",
      input: { expectedVersion: 1, toStatus: "flying", reason: "Nowhere to go" },
    });
    expect(result).toEqual({
      ok: false, httpStatus: 400, error: "Move to a valid change order status.",
    });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps an invalid-transition RPC failure to 409", async () => {
    const db = mockDb([pkgChain()], [{ data: null, error: { message: "WPP8_INVALID_TRANSITION" } }]);
    const result = await transitionChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1",
      input: { expectedVersion: 1, toStatus: "po_approved", reason: "Jumping ahead" },
    });
    expect(result).toEqual({
      ok: false, httpStatus: 409,
      error: "That status move is not allowed — change orders move one step at a time, and an approved PO can never be denied.",
    });
  });
});

describe("retireChangeOrder / retireCraftRate", () => {
  it("retire requires a reason and never reaches the RPC without one", async () => {
    const db = mockDb([], []);
    const result = await retireChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1",
      expectedVersion: 1, reason: "",
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("retireCraftRate maps a missing rate to 404", async () => {
    const db = mockDb([pkgChain()], [{ data: null, error: { message: "WPP8_RATE_NOT_FOUND" } }]);
    const result = await retireCraftRate(db, {
      ownerId: OWNER, packageId: PKG, rateId: "forge_wcr_1",
      expectedVersion: 1, reason: "Back to the default rate",
    });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Craft rate not found." });
  });
});

describe("setControlEstimate / setCraftRate", () => {
  it("setControlEstimate requires the original estimate", async () => {
    const db = mockDb([], []);
    const result = await setControlEstimate(db, {
      ownerId: OWNER, packageId: PKG,
      input: { originalCents: null, reason: "Setting the budget" },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("setCraftRate rejects a zero rate (the $89 default is the floor's replacement)", async () => {
    const db = mockDb([], []);
    const result = await setCraftRate(db, {
      ownerId: OWNER, packageId: PKG,
      input: { craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 0, reason: "Free labor" },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("setCraftRate maps a version conflict to 409", async () => {
    const db = mockDb([pkgChain()], [{ data: null, error: { message: "WPP8_VERSION_CONFLICT" } }]);
    const result = await setCraftRate(db, {
      ownerId: OWNER, packageId: PKG,
      input: { craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 10000, expectedVersion: 1, reason: "Site rate" },
    });
    expect(result.httpStatus).toBe(409);
  });
});

describe("listChangeOrderRevisions", () => {
  it("returns 400 for a limit above the 200 cap", async () => {
    const db = mockDb([], []);
    const result = await listChangeOrderRevisions(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1", limit: 250, offset: 0,
    });
    expect(result).toEqual({
      ok: false, httpStatus: 400, error: "Limit must be a whole number from 1 to 200.",
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns 404 when the change order is not found", async () => {
    const db = mockDb([pkgChain(), chain({ data: null, error: null })], []);
    const result = await listChangeOrderRevisions(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1", limit: 100, offset: 0,
    });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Change order not found." });
  });

  it("reports 503 when the change-orders table is missing (pre-migration)", async () => {
    const missingTable = { code: "42P01", message: 'relation "public.forge_work_change_orders" does not exist' };
    const db = mockDb([pkgChain(), chain({ data: null, error: missingTable })], []);
    const result = await listChangeOrderRevisions(db, {
      ownerId: OWNER, packageId: PKG, changeOrderId: "forge_wco_1", limit: 100, offset: 0,
    });
    expect(result).toEqual({ ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR });
  });
});

describe("listRetiredChangeOrders", () => {
  it("returns retired orders newest first", async () => {
    const retired = [{ ...CO_ROW, retired_at: "t1" }];
    const db = mockDb([pkgChain(), chain({ data: retired, error: null })], []);
    const result = await listRetiredChangeOrders(db, {
      ownerId: OWNER, packageId: PKG, limit: 100, offset: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.changeOrders).toHaveLength(1);
    expect(result.changeOrders[0].retiredAt).toBe("t1");
    expect(result.hasMore).toBe(false);
  });
});

describe("mapChangeOrderRpcError", () => {
  it("maps every known WPP8_* code and throws on the unknown", () => {
    expect(mapChangeOrderRpcError({ message: "WPP8_WORKSPACE_FORBIDDEN" })).toEqual({
      ok: false, httpStatus: 404, error: "Change Orders Log not found.",
    });
    expect(mapChangeOrderRpcError({ message: "WPP8_PO_NUMBER_REQUIRED" })).toEqual({
      ok: false, httpStatus: 400,
      error: "A PO number is required once a change order reaches PO requested.",
    });
    expect(mapChangeOrderRpcError({ message: "WPP8_DENIAL_REASON_REQUIRED" })).toEqual({
      ok: false, httpStatus: 400,
      error: "A denial reason is required to deny a change order.",
    });
    expect(mapChangeOrderRpcError({ message: "WPP8_REASON_REQUIRED" })).toEqual({
      ok: false, httpStatus: 400, error: "A reason is required for this change.",
    });
    expect(mapChangeOrderRpcError({ code: "42883", message: "function does not exist" })).toEqual({
      ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR,
    });
    expect(() => mapChangeOrderRpcError({ message: "boom" })).toThrow("boom");
  });
});
