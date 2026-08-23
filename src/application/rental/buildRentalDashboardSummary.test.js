import { describe, expect, it } from "vitest";
import { buildRentalDashboardSummary } from "./buildRentalDashboardSummary";

describe("buildRentalDashboardSummary", () => {
  it("derives actionable exceptions from rental records", () => {
    const summary = buildRentalDashboardSummary({
      units: [{ id: "u1" }, { id: "u2" }],
      leases: [{ id: "l1", unit_id: "u1", status: "active", end_date: "2026-09-01" }],
      maintenanceRequests: [{ status: "open" }, { status: "completed" }],
      workOrders: [{ status: "assigned" }],
      payments: [{ status: "succeeded" }, { status: "failed" }],
      insurancePolicies: [],
      supportCases: [{ status: "open" }, { status: "resolved" }],
    }, { summary: { overdueBalanceCents: 2500, monthlyScheduledCents: 200000, collectedCents: 197500, externallyManagedCents: 1427000, externallyManagedChargeCount: 9 } }, "2026-08-13");
    expect(summary).toMatchObject({ vacancies: 1, expiringLeases: 1, overdueBalanceCents: 2500, externallyManagedCents: 1427000, externallyManagedChargeCount: 9, openMaintenance: 2, awaitingSettlement: 1, missingInsurance: 1, missingDeposits: 1, missingMoveInInspections: 1, openSupportCases: 1, occupiedUnits: 1, totalUnits: 2 });
  });

  it("defaults externally-managed figures to zero when the report has no such data", () => {
    const summary = buildRentalDashboardSummary({ units: [], leases: [] }, null, "2026-08-13");
    expect(summary).toMatchObject({ externallyManagedCents: 0, externallyManagedChargeCount: 0 });
  });

  it("does not flag verified insurance or completed work", () => {
    const summary = buildRentalDashboardSummary({
      units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      insurancePolicies: [{ lease_id: "l1", status: "verified" }], workOrders: [{ status: "completed" }],
      payments: [{ status: "succeeded", settled_at: "2026-08-13T12:00:00Z" }], deposits: [{ lease_id: "l1" }],
      inspections: [{ lease_id: "l1", inspection_type: "move_in", status: "finalized" }],
    }, null, "2026-08-13");
    expect(summary).toMatchObject({ vacancies: 0, openMaintenance: 0, awaitingSettlement: 0, missingInsurance: 0, missingDeposits: 0, missingMoveInInspections: 0 });
  });

  it("sums only this calendar month's succeeded payments, net of refunds, for collectedThisMonthCents", () => {
    const summary = buildRentalDashboardSummary({
      units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      payments: [
        { status: "succeeded", succeeded_at: "2026-08-05T00:00:00Z", amount_cents: 150000, refunded_amount_cents: 0 },
        { status: "succeeded", succeeded_at: "2026-08-20T00:00:00Z", amount_cents: 50000, refunded_amount_cents: 10000 },
        { status: "succeeded", succeeded_at: "2026-07-05T00:00:00Z", amount_cents: 999999, refunded_amount_cents: 0 },
        { status: "failed", succeeded_at: "2026-08-10T00:00:00Z", amount_cents: 999999, refunded_amount_cents: 0 },
      ],
    }, null, "2026-08-13");
    expect(summary.collectedThisMonthCents).toBe(190000);
  });

  it("passes billingEnabled through as a strict boolean, defaulting to false (paused) when absent", () => {
    expect(buildRentalDashboardSummary({ units: [], leases: [] }, null, "2026-08-13").billingEnabled).toBe(false);
    expect(buildRentalDashboardSummary({ units: [], leases: [], billingEnabled: true }, null, "2026-08-13").billingEnabled).toBe(true);
    expect(buildRentalDashboardSummary({ units: [], leases: [], billingEnabled: "true" }, null, "2026-08-13").billingEnabled).toBe(false);
  });

  it("ranks needsAttention with the largest FORGE-collectible overdue balance first, never conflating it with the externally-managed amount", () => {
    const summary = buildRentalDashboardSummary(
      { units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }] },
      { summary: { overdueBalanceCents: 20000, externallyManagedCents: 1427000, externallyManagedChargeCount: 9, monthlyScheduledCents: 200000, collectedCents: 0 } },
      "2026-08-13",
    );
    expect(summary.needsAttention[0]).toMatchObject({ id: "overdue-forge", amountCents: 20000 });
    expect(summary.needsAttention.find((item) => item.id === "externally-managed")).toMatchObject({ amountCents: 1427000 });
  });

  it("never lets a large externally-managed dollar amount outrank a critical urgent-maintenance item — severity tier beats raw amount", () => {
    const summary = buildRentalDashboardSummary({
      units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      maintenanceRequests: [{ id: "m1", status: "open", priority: "urgent", submitted_at: "2026-08-10" }],
    }, { summary: { overdueBalanceCents: 0, externallyManagedCents: 99_000_000, externallyManagedChargeCount: 400, monthlyScheduledCents: 0, collectedCents: 0 } }, "2026-08-13");
    expect(summary.needsAttention[0].id).toBe("urgent-maintenance");
    expect(summary.needsAttention[1].id).toBe("externally-managed");
  });

  it("returns an empty needsAttention queue when nothing is outstanding", () => {
    const summary = buildRentalDashboardSummary({
      units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      insurancePolicies: [{ lease_id: "l1", status: "verified" }], deposits: [{ lease_id: "l1" }],
      inspections: [{ lease_id: "l1", inspection_type: "move_in", status: "finalized" }],
    }, { summary: { overdueBalanceCents: 0, externallyManagedCents: 0, externallyManagedChargeCount: 0, monthlyScheduledCents: 0, collectedCents: 0 } }, "2026-08-13");
    expect(summary.needsAttention).toEqual([]);
  });

  it("builds a six-month collection trend ending on the current month, using only recorded payments", () => {
    const summary = buildRentalDashboardSummary({
      units: [], leases: [],
      payments: [{ status: "succeeded", succeeded_at: "2026-08-05T00:00:00Z", amount_cents: 100000, refunded_amount_cents: 0 }],
    }, null, "2026-08-13");
    expect(summary.monthlyCollectionTrend).toHaveLength(6);
    expect(summary.monthlyCollectionTrend.map((point) => point.month)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(summary.monthlyCollectionTrend.at(-1)).toEqual({ month: "2026-08", collectedCents: 100000 });
  });
});
