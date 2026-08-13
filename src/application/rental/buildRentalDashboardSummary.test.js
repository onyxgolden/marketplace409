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
    }, { summary: { overdueBalanceCents: 2500, monthlyScheduledCents: 200000, collectedCents: 197500 } }, "2026-08-13");
    expect(summary).toMatchObject({ vacancies: 1, expiringLeases: 1, overdueBalanceCents: 2500, openMaintenance: 2, awaitingSettlement: 1, missingInsurance: 1, openSupportCases: 1, occupiedUnits: 1, totalUnits: 2 });
  });

  it("does not flag verified insurance or completed work", () => {
    const summary = buildRentalDashboardSummary({
      units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      insurancePolicies: [{ lease_id: "l1", status: "verified" }], workOrders: [{ status: "completed" }],
      payments: [{ status: "succeeded", settled_at: "2026-08-13T12:00:00Z" }],
    }, null, "2026-08-13");
    expect(summary).toMatchObject({ vacancies: 0, openMaintenance: 0, awaitingSettlement: 0, missingInsurance: 0 });
  });
});
