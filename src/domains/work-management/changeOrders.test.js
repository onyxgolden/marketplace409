// Work Package Planner slice 8 — domain unit tests: the Change Orders
// Log read model. Pure compute + validation; no database.

import { describe, it, expect } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  DEFAULT_CRAFT_RATE_CENTS_PER_HOUR,
  canonicalCostCents,
  changeOrderStatusLabel,
  changeOrderTypeLabel,
  computeChangeOrderSummary,
  isCountedChangeOrder,
  parseDollarsToCents,
  validateChangeOrderCreateInput,
  validateChangeOrderTransitionInput,
  validateChangeOrderUpdateInput,
  validateControlEstimateInput,
  validateCraftRateInput,
} from "./changeOrders.js";

function order(overrides = {}) {
  return {
    id: "forge_wco_1",
    changeOrderNumber: 1,
    type: "bust",
    description: "Shop piece arrived wrong",
    estimatedCostCents: 100000,
    approvedCostCents: null,
    actualCostCents: null,
    status: "estimated",
    ...overrides,
  };
}

describe("canonicalCostCents", () => {
  it("prefers approved, then estimated, then actual", () => {
    expect(canonicalCostCents(order({ approvedCostCents: 90000 }))).toBe(90000);
    expect(canonicalCostCents(order({ estimatedCostCents: 100000 }))).toBe(100000);
    expect(canonicalCostCents(order({ estimatedCostCents: null, actualCostCents: 95000 }))).toBe(95000);
    expect(canonicalCostCents(order({ estimatedCostCents: null, actualCostCents: null }))).toBeNull();
  });
});

describe("isCountedChangeOrder", () => {
  it("counts approved+ and never estimated or denied", () => {
    for (const status of ["approved", "material_ordered", "requisition_filed", "po_requested", "po_approved"]) {
      expect(isCountedChangeOrder(order({ status }))).toBe(true);
    }
    expect(isCountedChangeOrder(order({ status: "estimated" }))).toBe(false);
    expect(isCountedChangeOrder(order({ status: "denied" }))).toBe(false);
  });
});

describe("computeChangeOrderSummary", () => {
  const ESTIMATE = {
    originalControlEstimateCents: 10000000,
    currentControlEstimateCents: 10000000,
    contingencyCents: 1000000,
  };

  it("runs the contract-price math: current estimate + counted non-Deviations only", () => {
    const summary = computeChangeOrderSummary({
      estimate: ESTIMATE,
      changeOrders: [
        order({ changeOrderNumber: 1, type: "bust", status: "approved", approvedCostCents: 200000 }),
        order({ changeOrderNumber: 2, type: "scope_addition", status: "material_ordered", estimatedCostCents: 50000 }),
        order({ changeOrderNumber: 3, type: "deviation", status: "approved", approvedCostCents: 150000 }),
        order({ changeOrderNumber: 4, type: "bust", status: "estimated", estimatedCostCents: 999999 }),
        order({ changeOrderNumber: 5, type: "bust", status: "denied", estimatedCostCents: 888888 }),
      ],
      craftHours: [],
      craftRates: [],
    });
    expect(summary.runningContractPriceCents).toBe(10000000 + 200000 + 50000);
    expect(summary.contingencyRemainingCents).toBe(1000000 - 150000);
    expect(summary.countedChangeOrderCount).toBe(3);
    expect(summary.countedNonDeviationCents).toBe(250000);
    expect(summary.countedDeviationCents).toBe(150000);
    expect(summary.totalJobCostCents).toBe(10000000 + 250000);
    expect(summary.countsByStatus).toMatchObject({
      estimated: 1, approved: 2, material_ordered: 1, denied: 1,
    });
  });

  it("a Deviation never touches the contract price, and estimated/denied never count", () => {
    const summary = computeChangeOrderSummary({
      estimate: ESTIMATE,
      changeOrders: [
        order({ changeOrderNumber: 1, type: "deviation", status: "po_approved", approvedCostCents: 400000 }),
        order({ changeOrderNumber: 2, type: "bust", status: "estimated", estimatedCostCents: 700000 }),
      ],
      craftHours: [],
      craftRates: [],
    });
    expect(summary.runningContractPriceCents).toBe(10000000);
    expect(summary.contingencyRemainingCents).toBe(1000000 - 400000);
    expect(summary.countedChangeOrderCount).toBe(1);
  });

  it("rolls labor in at the $89/hr default and at an edited per-site rate", () => {
    const summary = computeChangeOrderSummary({
      estimate: ESTIMATE,
      changeOrders: [],
      craftHours: [
        { craftKey: "pipefitter", craftLabel: "Pipefitter", plannedHours: 40, stepCount: 2 },
        { craftKey: "welder", craftLabel: "Welder", plannedHours: 20, stepCount: 1 },
      ],
      craftRates: [
        { id: "forge_wcr_1", craftKey: "welder", craftLabel: "Welder", rateCentsPerHour: 10000, version: 1 },
      ],
    });
    const pipefitter = summary.laborByCraft.find((row) => row.craftKey === "pipefitter");
    const welder = summary.laborByCraft.find((row) => row.craftKey === "welder");
    expect(pipefitter.rateCentsPerHour).toBe(DEFAULT_CRAFT_RATE_CENTS_PER_HOUR);
    expect(pipefitter.isDefaultRate).toBe(true);
    expect(pipefitter.laborCostCents).toBe(40 * 8900);
    expect(welder.rateCentsPerHour).toBe(10000);
    expect(welder.isDefaultRate).toBe(false);
    expect(welder.laborCostCents).toBe(20 * 10000);
    expect(summary.laborCostCents).toBe(40 * 8900 + 20 * 10000);
    expect(summary.totalJobCostCents).toBe(10000000 + 40 * 8900 + 20 * 10000);
  });

  it("rounds fractional hours to the nearest cent", () => {
    const summary = computeChangeOrderSummary({
      estimate: ESTIMATE,
      changeOrders: [],
      craftHours: [{ craftKey: "pipefitter", craftLabel: "Pipefitter", plannedHours: 2.5, stepCount: 1 }],
      craftRates: [],
    });
    expect(summary.laborByCraft[0].laborCostCents).toBe(Math.round(2.5 * 8900));
  });

  it("warns on steps with no labor-cost basis and on overdrawn contingency, without clamping", () => {
    const summary = computeChangeOrderSummary({
      estimate: { ...ESTIMATE, contingencyCents: 10000 },
      changeOrders: [
        order({ changeOrderNumber: 1, type: "deviation", status: "approved", approvedCostCents: 25000 }),
      ],
      craftHours: [],
      craftRates: [],
      stepsWithoutCraftHours: 2,
    });
    expect(summary.contingencyRemainingCents).toBe(-15000);
    expect(summary.warnings.some((w) => w.code === "contingency_overdrawn")).toBe(true);
    expect(summary.warnings.some((w) => w.code === "steps_without_craft_hours")).toBe(true);
  });

  it("reports no figures without an estimate, and no labor without hours", () => {
    const summary = computeChangeOrderSummary({
      estimate: null,
      changeOrders: [order({ status: "approved", approvedCostCents: 1000 })],
      craftHours: [],
      craftRates: [],
    });
    expect(summary.hasEstimate).toBe(false);
    expect(summary.runningContractPriceCents).toBeNull();
    expect(summary.totalJobCostCents).toBeNull();
    expect(summary.laborCostCents).toBe(0);
    expect(summary.countedNonDeviationCents).toBe(1000);
  });
});

describe("ALLOWED_TRANSITIONS", () => {
  it("is a single forward chain plus denied, with po_approved and denied terminal", () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      estimated: ["approved", "denied"],
      approved: ["material_ordered", "denied"],
      material_ordered: ["requisition_filed", "denied"],
      requisition_filed: ["po_requested", "denied"],
      po_requested: ["po_approved", "denied"],
      po_approved: [],
      denied: [],
    });
  });
});

describe("labels", () => {
  it("names types and statuses in plain words", () => {
    expect(changeOrderTypeLabel("deviation")).toBe("Deviation");
    expect(changeOrderTypeLabel("field_condition")).toBe("Field condition");
    expect(changeOrderStatusLabel("po_requested")).toBe("PO requested");
  });
});

describe("parseDollarsToCents", () => {
  it("parses dollars to exact cents and rejects bad input", () => {
    expect(parseDollarsToCents("1250.00")).toEqual({ ok: true, cents: 125000 });
    expect(parseDollarsToCents("")).toEqual({ ok: true, cents: null });
    expect(parseDollarsToCents("10.005").ok).toBe(false);
    expect(parseDollarsToCents("-5").ok).toBe(false);
    expect(parseDollarsToCents("abc").ok).toBe(false);
  });
});

describe("validation", () => {
  it("create requires a valid type and description", () => {
    expect(validateChangeOrderCreateInput({ type: "nope", description: "x" }).ok).toBe(false);
    expect(validateChangeOrderCreateInput({ type: "bust", description: "  " }).ok).toBe(false);
    expect(validateChangeOrderCreateInput({ type: "bust", description: "Shop piece wrong", estimatedCostCents: 100 }).ok).toBe(true);
    expect(validateChangeOrderCreateInput({ type: "bust", description: "x", estimatedCostCents: -1 }).ok).toBe(false);
    expect(validateChangeOrderCreateInput({ type: "bust", description: "x", scheduleImpactDays: 400 }).ok).toBe(false);
  });

  it("update requires a version and a reason", () => {
    expect(validateChangeOrderUpdateInput({ expectedVersion: 1 }).ok).toBe(false);
    expect(validateChangeOrderUpdateInput({ expectedVersion: 1, reason: "Fix" }).ok).toBe(true);
    expect(validateChangeOrderUpdateInput({ expectedVersion: 0, reason: "Fix" }).ok).toBe(false);
  });

  it("transition requires a version, a valid target, and a reason", () => {
    const good = validateChangeOrderTransitionInput({ expectedVersion: 2, toStatus: "approved", reason: "Looks right" });
    expect(good.ok).toBe(true);
    expect(validateChangeOrderTransitionInput({ expectedVersion: 2, toStatus: "po_approved", reason: "x" }).ok).toBe(true);
    expect(validateChangeOrderTransitionInput({ expectedVersion: 2, toStatus: "estimated", reason: "x" }).ok).toBe(false);
    expect(validateChangeOrderTransitionInput({ expectedVersion: 2, toStatus: "approved" }).ok).toBe(false);
  });

  it("control estimate requires an original amount and a reason", () => {
    expect(validateControlEstimateInput({ originalCents: 100, reason: "Set" }).ok).toBe(true);
    expect(validateControlEstimateInput({ originalCents: null, reason: "Set" }).ok).toBe(false);
    expect(validateControlEstimateInput({ originalCents: 100 }).ok).toBe(false);
    expect(validateControlEstimateInput({ originalCents: -5, reason: "Set" }).ok).toBe(false);
  });

  it("craft rate requires a craft, a label, a rate in range, and a reason", () => {
    const good = validateCraftRateInput({ craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 8900, reason: "Site rate" });
    expect(good.ok).toBe(true);
    expect(validateCraftRateInput({ craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 0, reason: "x" }).ok).toBe(false);
    expect(validateCraftRateInput({ craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 100001, reason: "x" }).ok).toBe(false);
    expect(validateCraftRateInput({ craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 8900 }).ok).toBe(false);
  });
});
