// Work Package Planner slice 9 — application tests. Supabase-shaped
// chain mock, same shape as changeOrders.test.js. Writes go through
// the slice-9 SECURITY DEFINER RPCs only (the RPCs derive the actor
// from auth.uid() and enforce ownership, the status machine, terminal
// guards, optimistic versions, and reason rules) — so these tests
// prove the service maps inputs to exactly those RPCs, never writes a
// table directly, never passes a caller-supplied actor, validates
// before touching the database, and turns every WPP9_* failure into
// plain English. Also covers the pre-migration window and scope
// isolation: a bust from another package reads as not found.

import { describe, expect, it, vi } from "vitest";
import {
  NOT_APPLIED_ERROR,
  confirmBust,
  dollarsToCents,
  getBustCandidates,
  getBustDetail,
  linkChangeOrder,
  listBustBadges,
  listBusts,
  mapBustRpcError,
  normalizeBustSnapshot,
  retireBust,
  transitionBust,
  unlinkChangeOrder,
  updateBust,
} from "./busts.js";

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
    not: vi.fn(() => node), neq: vi.fn(() => node), in: vi.fn(() => node),
    range: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const PKG = "pkg_1";
const OTHER_PKG = "pkg_2";
const PKG_ROW = { id: PKG, status: "in_progress" };
const pkgChain = () => chain({ data: PKG_ROW, error: null });

const BUST_ROW = {
  id: "forge_wpbust_1", owner_id: OWNER, work_package_id: PKG,
  scope_type: "PACKAGE", takeoff_line_id: null, work_step_id: null,
  craft: null, work_date: null, shift_key: null, dimension: "LABOR_COST",
  baseline_id: "base_1", baseline_version: 1, source_fingerprint: "fp_1",
  comparison_as_of: "2026-11-15", unit: "USD_CENTS",
  planned_value: 1000000, observed_value: 1250000, variance_value: 250000,
  variance_percent: 25, evidence_summary: "Actual cost is over the frozen baseline.",
  evidence_ref: null, status: "OPEN", disposition_reason: null,
  resolved_baseline_id: null, version: 1, retired_at: null, retired_by: null,
  created_by: "user_9", updated_by: "user_9", created_at: "t0", updated_at: "t0",
};

const RAW_SNAPSHOT = {
  packageStatus: "in_progress",
  asOf: "2026-11-15",
  baseline: {
    id: "base_1", version_number: 1, baseline_start: "2026-11-09",
    baseline_finish: "2026-11-18", baseline_hours: "400", baseline_cost: "10000.00",
    frozen_at: "2026-11-01T00:00:00Z",
  },
  progressBaseline: null,
  takeoffLines: [
    { id: "line_1", drawing_id: "dwg_1", drawing_number: "W-0005-1", quantity: "10", unit: "EA", installed_quantity: "12.5" },
  ],
  steps: [],
  placements: [],
  assignments: [],
  latestProgress: {
    status_date: "2026-11-15", actual_hours: "440.5", actual_cost: "12500.50", baseline_version: 1,
  },
  controlEstimate: { original_control_estimate_cents: 2000000, current_estimate_cents: 2100000 },
  activeBusts: [],
};

describe("dollarsToCents", () => {
  it("converts exact two-decimal dollars and passes null through", () => {
    expect(dollarsToCents("10000.00")).toBe(1_000_000);
    expect(dollarsToCents("12500.50")).toBe(1_250_050);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(null)).toBe(null);
    expect(dollarsToCents(undefined)).toBe(null);
  });

  it("fails loudly on a non-cent figure instead of silently rounding", () => {
    expect(() => dollarsToCents("10.005")).toThrow();
    expect(() => dollarsToCents("10.001")).toThrow();
  });
});

describe("normalizeBustSnapshot", () => {
  it("converts dollars to cents and snake_case to camelCase", () => {
    const snapshot = normalizeBustSnapshot(RAW_SNAPSHOT, OWNER, PKG);
    expect(snapshot.ownerId).toBe(OWNER);
    expect(snapshot.packageId).toBe(PKG);
    expect(snapshot.baseline.baselineHours).toBe(400);
    expect(snapshot.baseline.baselineCostCents).toBe(1_000_000);
    expect(snapshot.latestProgress.actualHours).toBe(440.5);
    expect(snapshot.latestProgress.actualCostCents).toBe(1_250_050);
    expect(snapshot.takeoffLines[0].drawingNumber).toBe("W-0005-1");
    expect(snapshot.takeoffLines[0].installedQuantity).toBe(12.5);
    expect(snapshot.controlEstimate.originalControlEstimateCents).toBe(2_000_000);
  });
});

describe("getBustCandidates", () => {
  it("detects from one snapshot: quantity candidate only, no fabricated cost", async () => {
    const db = mockDb([pkgChain()], [{ data: RAW_SNAPSHOT, error: null }]);
    const result = await getBustCandidates(db, { ownerId: OWNER, packageId: PKG });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_package_busts_snapshot", {
      p_owner_id: OWNER, p_package_id: PKG, p_as_of: null, p_baseline_version: null,
    });
    // Quantity 12.5 vs 10 -> one candidate; labor cost 1,250,050 vs
    // 1,000,000 -> a second; labor hours 440.5 vs 400 -> a third.
    // The point: the quantity overrun did NOT fabricate a second cost
    // figure — the cost candidate comes from the verified actuals.
    expect(result.candidates.map((c) => c.dimension).sort()).toEqual(
      ["INSTALLED_QUANTITY", "LABOR_COST", "LABOR_HOURS"],
    );
    const quantity = result.candidates.find((c) => c.dimension === "INSTALLED_QUANTITY");
    expect(quantity.variancePercent).toBe(25);
    expect(result.targets.takeoffLines).toHaveLength(1);
    expect(result.targets.takeoffLines[0].drawingNumber).toBe("W-0005-1");
  });

  it("passes asOf and baselineVersion through to the snapshot RPC", async () => {
    const db = mockDb([pkgChain()], [{ data: RAW_SNAPSHOT, error: null }]);
    await getBustCandidates(db, { ownerId: OWNER, packageId: PKG, asOf: "2026-11-14", baselineVersion: 2 });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_package_busts_snapshot", {
      p_owner_id: OWNER, p_package_id: PKG, p_as_of: "2026-11-14", p_baseline_version: 2,
    });
  });

  it("rejects a malformed asOf without touching the database", async () => {
    const db = mockDb([pkgChain()]);
    const result = await getBustCandidates(db, { ownerId: OWNER, packageId: PKG, asOf: "Nov 15" });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("a missing snapshot RPC reads as notApplied (503), never a raw error", async () => {
    const db = mockDb([pkgChain()], [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }]);
    const result = await getBustCandidates(db, { ownerId: OWNER, packageId: PKG });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(result.notApplied).toBe(true);
    expect(result.error).toBe(NOT_APPLIED_ERROR);
  });

  it("a forbidden workspace reads as 404, never a raw code", async () => {
    const db = mockDb([pkgChain()], [{ data: null, error: new Error("WPP9_WORKSPACE_FORBIDDEN") }]);
    const result = await getBustCandidates(db, { ownerId: OWNER, packageId: PKG });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(result.error).not.toContain("WPP9");
  });
});

describe("listBusts", () => {
  it("pages with exact filters and excludes retired by default", async () => {
    const listChain = chain({ data: [BUST_ROW], error: null, count: 1 });
    const db = mockDb([pkgChain(), listChain]);
    const result = await listBusts(db, { ownerId: OWNER, packageId: PKG, status: "OPEN", limit: 50, offset: 0 });
    expect(result.ok).toBe(true);
    expect(result.busts).toHaveLength(1);
    expect(result.busts[0].targetLabel).toBe("Whole package");
    expect(result.total).toBe(1);
    expect(result.limit).toBe(50);
    expect(listChain.neq).toHaveBeenCalledWith("status", "RETIRED");
    expect(listChain.eq).toHaveBeenCalledWith("status", "OPEN");
    expect(listChain.range).toHaveBeenCalledWith(0, 49);
  });

  it("includeRetired skips the retired exclusion", async () => {
    const listChain = chain({ data: [], error: null, count: 0 });
    const db = mockDb([pkgChain(), listChain]);
    await listBusts(db, { ownerId: OWNER, packageId: PKG, includeRetired: true });
    expect(listChain.neq).not.toHaveBeenCalled();
  });

  it("rejects bad paging without querying the busts table", async () => {
    const db = mockDb([pkgChain(), pkgChain(), pkgChain()]);
    expect((await listBusts(db, { ownerId: OWNER, packageId: PKG, limit: 0 })).httpStatus).toBe(400);
    expect((await listBusts(db, { ownerId: OWNER, packageId: PKG, limit: 201 })).httpStatus).toBe(400);
    expect((await listBusts(db, { ownerId: OWNER, packageId: PKG, offset: -1 })).httpStatus).toBe(400);
    expect(db.from).toHaveBeenCalledTimes(3);
  });

  it("a missing busts table reads as notApplied (503)", async () => {
    const db = mockDb([pkgChain(), chain({ data: null, error: { code: "42P01", message: "does not exist" } })]);
    const result = await listBusts(db, { ownerId: OWNER, packageId: PKG });
    expect(result.httpStatus).toBe(503);
    expect(result.notApplied).toBe(true);
  });

  it("resolves a takeoff-line target label from the line and its drawing", async () => {
    const lineBust = { ...BUST_ROW, scope_type: "TAKEOFF_LINE", takeoff_line_id: "line_1", dimension: "INSTALLED_QUANTITY", unit: "EA" };
    const listChain = chain({ data: [lineBust], error: null, count: 1 });
    const linesChain = chain({ data: [{ id: "line_1", drawing_id: "dwg_1", quantity: 10, unit: "EA" }], error: null });
    const drawingsChain = chain({ data: [{ id: "dwg_1", drawing_number: "W-0005-1" }], error: null });
    const db = mockDb([pkgChain(), listChain, linesChain, drawingsChain]);
    const result = await listBusts(db, { ownerId: OWNER, packageId: PKG });
    expect(result.busts[0].targetLabel).toBe("Drawing W-0005-1 — 10 EA planned");
  });
});

describe("getBustDetail", () => {
  it("returns the bust with history and linked orders by number, never raw ids", async () => {
    const bustChain = chain({ data: { id: BUST_ROW.id, work_package_id: PKG, status: "OPEN" }, error: null });
    const detailChain = chain({ data: BUST_ROW, error: null });
    const revisionsChain = chain({
      data: [{ id: "rev_1", bust_id: BUST_ROW.id, version: 1, actor_id: "user_9", action: "create", old_values: null, new_values: { status: "OPEN" }, reason: "Bust recorded", request_id: null, recorded_at: "t0" }],
      error: null,
    });
    const linksChain = chain({
      data: [{ id: "link_1", bust_id: BUST_ROW.id, change_order_id: "co_1", linked_by: "user_9", reason: "Fixes it", version: 1, unlinked_at: null, unlinked_by: null, created_at: "t0" }],
      error: null,
    });
    const ordersChain = chain({ data: [{ id: "co_1", change_order_number: 3, status: "approved" }], error: null });
    const db = mockDb([pkgChain(), bustChain, detailChain, revisionsChain, linksChain, ordersChain]);
    const result = await getBustDetail(db, { ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id });
    expect(result.ok).toBe(true);
    expect(result.bust.targetLabel).toBe("Whole package");
    expect(result.revisions).toHaveLength(1);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].changeOrderNumber).toBe(3);
    expect(result.links[0].changeOrderStatus).toBe("approved");
    expect(result.activeLinks).toHaveLength(1);
  });

  it("a bust from another package reads as not found (scope isolation)", async () => {
    const bustChain = chain({ data: { id: BUST_ROW.id, work_package_id: OTHER_PKG, status: "OPEN" }, error: null });
    const db = mockDb([pkgChain(), bustChain]);
    const result = await getBustDetail(db, { ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
  });

  it("a missing bust reads as not found", async () => {
    const bustChain = chain({ data: null, error: null });
    const db = mockDb([pkgChain(), bustChain]);
    const result = await getBustDetail(db, { ownerId: OWNER, packageId: PKG, bustId: "nope" });
    expect(result.httpStatus).toBe(404);
  });
});

describe("listBustBadges", () => {
  it("groups active busts by line, step, and craft-day, never retired ones", async () => {
    const badgesChain = chain({
      data: [
        { scope_type: "TAKEOFF_LINE", takeoff_line_id: "line_1", dimension: "INSTALLED_QUANTITY" },
        { scope_type: "TAKEOFF_LINE", takeoff_line_id: "line_1", dimension: "INSTALLED_QUANTITY" },
        { scope_type: "WORK_STEP", work_step_id: "step_1", dimension: "SCHEDULE_DAYS" },
        { scope_type: "CRAFT_DAY", craft: "pipefitters", work_date: "2026-11-09", dimension: "MANPOWER_SHORTFALL" },
      ],
      error: null,
    });
    const db = mockDb([pkgChain(), badgesChain]);
    const result = await listBustBadges(db, { ownerId: OWNER, packageId: PKG });
    expect(result.ok).toBe(true);
    expect(result.byTakeoffLine.line_1).toEqual({ count: 2, dimensions: ["INSTALLED_QUANTITY"] });
    expect(result.byWorkStep.step_1).toEqual({ count: 1, dimensions: ["SCHEDULE_DAYS"] });
    expect(result.byCraftDay["pipefitters|2026-11-09"]).toEqual({ count: 1, dimensions: ["MANPOWER_SHORTFALL"] });
    expect(badgesChain.in).toHaveBeenCalledWith("status", ["OPEN", "UNDER_REVIEW"]);
  });
});

describe("confirmBust", () => {
  const validInput = {
    ownerId: OWNER, packageId: PKG,
    dimension: "LABOR_COST", scopeType: "PACKAGE",
    baselineId: "base_1", baselineVersion: 1,
    plannedValue: 1000000, observedValue: 1250000, unit: "USD_CENTS",
    evidenceSummary: "Actual cost is over the frozen baseline.",
    comparisonAsOf: "2026-11-15",
    sourceFingerprint: "fp_1", requestId: "req_1",
  };

  it("calls the create RPC with the evidenced figures and no actor parameter", async () => {
    const db = mockDb([], [{ data: BUST_ROW, error: null }]);
    const result = await confirmBust(db, validInput);
    expect(result.ok).toBe(true);
    expect(result.bust.id).toBe(BUST_ROW.id);
    const args = db.rpc.mock.calls[0][1];
    expect(db.rpc).toHaveBeenCalledWith("forge_work_package_bust_create", expect.objectContaining({
      p_owner_id: OWNER,
      p_package_id: PKG,
      p_dimension: "LABOR_COST",
      p_planned_value: 1000000,
      p_observed_value: 1250000,
      p_source_fingerprint: "fp_1",
      p_request_id: "req_1",
    }));
    expect(args).not.toHaveProperty("p_actor_id");
    expect(args).not.toHaveProperty("p_actor");
    expect(Object.keys(args).some((key) => key.includes("actor"))).toBe(false);
  });

  it("validates before touching the database", async () => {
    const db = mockDb([]);
    const result = await confirmBust(db, { ...validInput, observedValue: 900000 });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("a duplicate active bust returns 409 naming the existing bust", async () => {
    const db = mockDb([], [{ data: null, error: new Error("WPP9_DUPLICATE_ACTIVE:forge_wpbust_existing") }]);
    const result = await confirmBust(db, validInput);
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.existingBustId).toBe("forge_wpbust_existing");
    expect(result.error).not.toContain("WPP9");
  });

  it("a stale fingerprint returns 409 in plain words", async () => {
    const db = mockDb([], [{ data: null, error: new Error("WPP9_STALE_FINGERPRINT") }]);
    const result = await confirmBust(db, validInput);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toMatch(/figures changed/);
  });
});

describe("update / transition / retire / link / unlink", () => {
  const bustScopeChains = () => [
    pkgChain(),
    chain({ data: { id: BUST_ROW.id, work_package_id: PKG, status: "OPEN" }, error: null }),
  ];

  it("updateBust requires a reason before touching the database", async () => {
    const db = mockDb(bustScopeChains());
    const result = await updateBust(db, {
      ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id,
      expectedVersion: 1, evidenceSummary: "New evidence here.", setEvidenceSummary: true, reason: "",
    });
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("transitionBust calls the transition RPC with the version guard", async () => {
    const db = mockDb(bustScopeChains(), [{ data: { ...BUST_ROW, status: "UNDER_REVIEW", version: 2 }, error: null }]);
    const result = await transitionBust(db, {
      ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id,
      expectedVersion: 1, toStatus: "UNDER_REVIEW", reason: "Looking into it.",
    });
    expect(result.ok).toBe(true);
    expect(result.bust.status).toBe("UNDER_REVIEW");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_package_bust_transition", expect.objectContaining({
      p_bust_id: BUST_ROW.id, p_expected_version: 1, p_to_status: "UNDER_REVIEW",
    }));
  });

  it("a version conflict returns 409 in plain words", async () => {
    const db = mockDb(bustScopeChains(), [{ data: null, error: new Error("WPP9_VERSION_CONFLICT") }]);
    const result = await transitionBust(db, {
      ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id,
      expectedVersion: 99, toStatus: "UNDER_REVIEW", reason: "Looking into it.",
    });
    expect(result.httpStatus).toBe(409);
    expect(result.error).toMatch(/changed by someone else/);
  });

  it("a bust from another package cannot be transitioned (scope isolation)", async () => {
    const db = mockDb([
      pkgChain(),
      chain({ data: { id: BUST_ROW.id, work_package_id: OTHER_PKG, status: "OPEN" }, error: null }),
    ]);
    const result = await transitionBust(db, {
      ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id,
      expectedVersion: 1, toStatus: "UNDER_REVIEW", reason: "Looking into it.",
    });
    expect(result.httpStatus).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("retireBust calls the retire RPC; a terminal package returns 409", async () => {
    const db = mockDb(bustScopeChains(), [{ data: { ...BUST_ROW, status: "RETIRED", version: 2 }, error: null }]);
    const result = await retireBust(db, {
      ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id, expectedVersion: 1, reason: "Duplicate record.",
    });
    expect(result.ok).toBe(true);
    expect(result.bust.status).toBe("RETIRED");
    const db2 = mockDb(bustScopeChains(), [{ data: null, error: new Error("WPP9_PACKAGE_TERMINAL") }]);
    const terminal = await retireBust(db2, {
      ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id, expectedVersion: 1, reason: "Duplicate record.",
    });
    expect(terminal.httpStatus).toBe(409);
    expect(terminal.error).toMatch(/closed/);
  });

  it("linkChangeOrder calls the link RPC; unlinkChangeOrder checks the link belongs to the bust", async () => {
    const linkRow = {
      id: "link_1", bust_id: BUST_ROW.id, change_order_id: "co_1",
      linked_by: "user_9", reason: "Fixes it", version: 1,
      unlinked_at: null, unlinked_by: null, created_at: "t0",
    };
    const db = mockDb(bustScopeChains(), [{ data: linkRow, error: null }]);
    const linked = await linkChangeOrder(db, {
      ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id, changeOrderId: "co_1", reason: "Fixes it",
    });
    expect(linked.ok).toBe(true);
    expect(linked.link.changeOrderId).toBe("co_1");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_package_bust_link_change_order", expect.objectContaining({
      p_bust_id: BUST_ROW.id, p_change_order_id: "co_1",
    }));
    // Unlink with a link that belongs to a different bust -> 404, no RPC.
    const db2 = mockDb([
      chain({ data: { id: "link_9", bust_id: "other_bust" }, error: null }),
    ]);
    const wrongBust = await unlinkChangeOrder(db2, {
      ownerId: OWNER, packageId: PKG, bustId: BUST_ROW.id, linkId: "link_9",
      expectedVersion: 1, reason: "Wrong order.",
    });
    expect(wrongBust.httpStatus).toBe(404);
    expect(db2.rpc).not.toHaveBeenCalled();
  });
});

describe("mapBustRpcError", () => {
  it("maps every WPP9 code to plain English with the right status, never the raw code", () => {
    const cases = [
      ["WPP9_WORKSPACE_FORBIDDEN", 404],
      ["WPP9_PACKAGE_NOT_FOUND", 404],
      ["WPP9_BUST_NOT_FOUND", 404],
      ["WPP9_CHANGE_ORDER_NOT_FOUND", 400],
      ["WPP9_LINK_NOT_FOUND", 404],
      ["WPP9_STALE_FINGERPRINT", 409],
      ["WPP9_IDEMPOTENCY_CONFLICT", 409],
      ["WPP9_INVALID_ACTOR", 401],
      ["WPP9_INVALID_DIMENSION", 400],
      ["WPP9_INVALID_SCOPE", 400],
      ["WPP9_INVALID_TARGET", 400],
      ["WPP9_TARGET_RETIRED", 409],
      ["WPP9_INVALID_BASELINE", 400],
      ["WPP9_INVALID_UNIT", 400],
      ["WPP9_INVALID_VALUE", 400],
      ["WPP9_INVALID_COST", 400],
      ["WPP9_INVALID_EVIDENCE", 400],
      ["WPP9_INVALID_STATUS", 400],
      ["WPP9_INVALID_TRANSITION", 409],
      ["WPP9_RESOLVED_BASELINE_REQUIRED", 400],
      ["WPP9_RESOLVED_BASELINE_NOT_FROZEN", 409],
      ["WPP9_RESOLVED_BASELINE_NOT_NEWER", 409],
      ["WPP9_RESOLVED_PROVENANCE_UNAVAILABLE", 409],
      ["WPP9_APPROVED_ORDER_REQUIRED", 409],
      ["WPP9_LINK_EXISTS", 409],
      ["WPP9_LINK_RETIRED", 409],
      ["WPP9_VERSION_CONFLICT", 409],
      ["WPP9_RETIRED", 409],
      ["WPP9_PACKAGE_TERMINAL", 409],
      ["WPP9_REASON_REQUIRED", 400],
      ["WPP9_REASON_TOO_LONG", 400],
    ];
    for (const [code, status] of cases) {
      const mapped = mapBustRpcError(new Error(code));
      expect(mapped.httpStatus).toBe(status);
      expect(mapped.error).not.toContain("WPP9");
      expect(mapped.error.length).toBeGreaterThan(0);
    }
  });

  it("a missing RPC reads as 503 notApplied; an unknown error throws", () => {
    const missing = mapBustRpcError({ code: "PGRST202", message: "Could not find the function" });
    expect(missing.httpStatus).toBe(503);
    expect(missing.error).toBe(NOT_APPLIED_ERROR);
    expect(() => mapBustRpcError(new Error("something entirely new"))).toThrow();
  });
});
