import { describe, expect, it } from "vitest";
import { buildRentalOperatingReport, rentalReportToCsv } from "./buildRentalOperatingReport.js";

const forgeSchedule = { id: "s1", collection_mode: "forge", forge_cutover_date: "2026-01-01" };
const externalSchedule = { id: "s2", collection_mode: "external", forge_cutover_date: null };

const input = {
  units: [{ id: "u1", label: "Main residence", status: "occupied" }],
  tenants: [{ id: "t1", display_name: "John Jones" }],
  leases: [{ id: "l1", property_id: "kent", unit_id: "u1", status: "active", start_date: "2026-08-12", end_date: null, monthly_rent_cents: 200000 }],
  memberships: [{ lease_id: "l1", tenant_id: "t1" }],
  charges: [
    { lease_id: "l1", schedule_id: "s1", status: "paid", due_date: "2026-09-01", amount_cents: 200000, paid_amount_cents: 200000 },
    { lease_id: "l1", schedule_id: "s1", status: "overdue", due_date: "2026-10-01", amount_cents: 200000, paid_amount_cents: 50000 },
  ],
  payments: [{ lease_id: "l1", status: "succeeded", amount_cents: 200000, refunded_amount_cents: 0 }],
  schedules: [forgeSchedule],
};

describe("rental operating report", () => {
  it("builds rent roll, collection, balance and delinquency totals for FORGE-collectible charges", () => {
    const report = buildRentalOperatingReport(input, "2026-10-05");
    expect(report.summary).toMatchObject({ activeLeases: 1, occupiedUnits: 1, monthlyScheduledCents: 200000, openBalanceCents: 150000, overdueBalanceCents: 150000, collectedCents: 200000, externallyManagedCents: 0, externallyManagedChargeCount: 0 });
    expect(report.rentRoll[0].tenantNames).toEqual(["John Jones"]);
  });

  it("excludes void charges and refunds from collected cash", () => {
    const report = buildRentalOperatingReport({ ...input, charges: [{ lease_id: "l1", schedule_id: "s1", status: "void", due_date: "2026-08-01", amount_cents: 200000, paid_amount_cents: 0 }], payments: [{ lease_id: "l1", status: "succeeded", amount_cents: 200000, refunded_amount_cents: 50000 }] }, "2026-10-05");
    expect(report.summary.openBalanceCents).toBe(0);
    expect(report.summary.collectedCents).toBe(150000);
  });

  it("derives occupied units from unique active lease assignments", () => {
    const report = buildRentalOperatingReport({ ...input, units: [{ id: "u1", label: "Main residence", status: "preparing" }, { id: "u2", label: "Rear unit", status: "occupied" }], leases: [...input.leases, { ...input.leases[0], id: "l2" }, { ...input.leases[0], id: "l3", unit_id: "u2", status: "ended" }] }, "2026-10-05");
    expect(report.summary.activeLeases).toBe(2);
    expect(report.summary.occupiedUnits).toBe(1);
  });

  it("exports quoted CSV rows including the externally-managed columns", () => {
    const csv = rentalReportToCsv(buildRentalOperatingReport(input, "2026-10-05"));
    expect(csv).toContain('"Lease ID","Property ID"');
    expect(csv).toContain("Externally managed (reconciliation required)");
    expect(csv).toContain('"John Jones"');
    expect(csv).toContain('"1500.00"');
  });

  // Rental billing cutover containment / correction pass: a real rent obligation whose schedule is
  // still 'external' (Rentec authoritative) must never inflate FORGE overdue/collectible totals —
  // it must remain fully visible, but only in the separate externally-managed bucket.
  describe("FORGE vs externally-managed containment", () => {
    const externallyManagedInput = {
      ...input,
      charges: [
        { lease_id: "l1", schedule_id: "s2", status: "overdue", due_date: "2026-08-01", amount_cents: 1427000, paid_amount_cents: 0 },
      ],
      schedules: [externalSchedule],
    };

    it("does not count an externally-managed charge as FORGE overdue or FORGE open balance", () => {
      const report = buildRentalOperatingReport(externallyManagedInput, "2026-10-05");
      expect(report.summary.overdueBalanceCents).toBe(0);
      expect(report.summary.openBalanceCents).toBe(0);
    });

    it("surfaces the externally-managed obligation in full, separately, as reconciliation-required — never hidden or dropped", () => {
      const report = buildRentalOperatingReport(externallyManagedInput, "2026-10-05");
      expect(report.summary.externallyManagedCents).toBe(1427000);
      expect(report.summary.externallyManagedChargeCount).toBe(1);
      expect(report.rentRoll[0].externallyManagedCents).toBe(1427000);
      expect(report.rentRoll[0].externallyManagedChargeCount).toBe(1);
    });

    it("classifies a charge with no matching schedule row as externally managed, never as FORGE overdue (fails safe on missing evidence)", () => {
      const report = buildRentalOperatingReport({ ...externallyManagedInput, schedules: [] }, "2026-10-05");
      expect(report.summary.overdueBalanceCents).toBe(0);
      expect(report.summary.externallyManagedCents).toBe(1427000);
    });

    it("classifies a FORGE-mode charge dated before its own schedule's cutover as externally managed, not FORGE overdue", () => {
      const preCutover = { ...externallyManagedInput, charges: [{ lease_id: "l1", schedule_id: "s1", status: "overdue", due_date: "2025-12-01", amount_cents: 1427000, paid_amount_cents: 0 }], schedules: [forgeSchedule] };
      const report = buildRentalOperatingReport(preCutover, "2026-10-05");
      expect(report.summary.overdueBalanceCents).toBe(0);
      expect(report.summary.externallyManagedCents).toBe(1427000);
    });

    it("a mixed rent roll keeps FORGE and externally-managed totals separate rather than blended into one figure", () => {
      const mixed = {
        ...input,
        charges: [
          { lease_id: "l1", schedule_id: "s1", status: "overdue", due_date: "2026-08-01", amount_cents: 20000, paid_amount_cents: 0 },
          { lease_id: "l1", schedule_id: "s2", status: "overdue", due_date: "2026-08-01", amount_cents: 1427000, paid_amount_cents: 0 },
        ],
        schedules: [forgeSchedule, externalSchedule],
      };
      const report = buildRentalOperatingReport(mixed, "2026-10-05");
      expect(report.summary.overdueBalanceCents).toBe(20000);
      expect(report.summary.externallyManagedCents).toBe(1427000);
    });

    it("does not count a paid-off externally-managed charge toward the externally-managed reconciliation-required total", () => {
      const paidExternal = { ...externallyManagedInput, charges: [{ lease_id: "l1", schedule_id: "s2", status: "paid", due_date: "2026-08-01", amount_cents: 1427000, paid_amount_cents: 1427000 }] };
      const report = buildRentalOperatingReport(paidExternal, "2026-10-05");
      expect(report.summary.externallyManagedCents).toBe(0);
      expect(report.summary.externallyManagedChargeCount).toBe(0);
    });
  });
});
