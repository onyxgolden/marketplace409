import { describe, expect, it } from "vitest";
import { buildDelinquentTenantsReport, delinquentTenantsReportToCsv } from "./buildDelinquentTenantsReport.js";

const forgeSchedule = { id: "s1", collection_mode: "forge", forge_cutover_date: "2026-01-01" };
const externalSchedule = { id: "s2", collection_mode: "external", forge_cutover_date: null };

const input = {
  units: [{ id: "u1", label: "Main residence" }],
  tenants: [{ id: "t1", display_name: "John Jones", email: "jj@example.com", phone: "555-1000" }],
  leases: [{ id: "l1", property_id: "kent", unit_id: "u1", status: "active", monthly_rent_cents: 200000 }],
  memberships: [{ lease_id: "l1", tenant_id: "t1" }],
  charges: [
    { lease_id: "l1", schedule_id: "s1", status: "overdue", due_date: "2026-07-01", amount_cents: 200000, paid_amount_cents: 50000 },
    { lease_id: "l1", schedule_id: "s1", status: "paid", due_date: "2026-08-01", amount_cents: 200000, paid_amount_cents: 200000 },
  ],
  schedules: [forgeSchedule],
};

describe("delinquent tenants report", () => {
  it("includes only leases with an overdue FORGE balance and totals it", () => {
    const report = buildDelinquentTenantsReport(input, "2026-08-16");
    expect(report.summary).toMatchObject({ delinquentLeaseCount: 1, totalOverdueCents: 150000, externallyManagedCents: 0, externallyManagedChargeCount: 0 });
    expect(report.rows[0]).toMatchObject({ unitLabel: "Main residence", tenantNames: ["John Jones"], tenantEmails: ["jj@example.com"], overdueCents: 150000, oldestDueDate: "2026-07-01" });
  });

  it("excludes leases with no overdue charges", () => {
    const report = buildDelinquentTenantsReport({ ...input, charges: [input.charges[1]] }, "2026-08-16");
    expect(report.rows).toHaveLength(0);
  });

  it("excludes void charges from overdue totals", () => {
    const report = buildDelinquentTenantsReport({ ...input, charges: [{ ...input.charges[0], status: "void" }] }, "2026-08-16");
    expect(report.summary.totalOverdueCents).toBe(0);
  });

  it("exports quoted CSV rows including the externally-managed columns", () => {
    const csv = delinquentTenantsReportToCsv(buildDelinquentTenantsReport(input, "2026-08-16"));
    expect(csv).toContain('"John Jones"');
    expect(csv).toContain("Externally managed (reconciliation required)");
    expect(csv).toContain('"1500.00"');
  });

  // Rental billing cutover containment: an externally-managed lease (Rentec still authoritative)
  // must not appear as a FORGE delinquency, even though the obligation is real and overdue.
  describe("FORGE vs externally-managed containment", () => {
    const externallyManagedInput = {
      ...input,
      charges: [{ lease_id: "l1", schedule_id: "s2", status: "overdue", due_date: "2026-07-01", amount_cents: 150000, paid_amount_cents: 0 }],
      schedules: [externalSchedule],
    };

    it("does not count an externally-managed overdue charge as a FORGE delinquency", () => {
      const report = buildDelinquentTenantsReport(externallyManagedInput, "2026-08-16");
      expect(report.summary.delinquentLeaseCount).toBe(0);
      expect(report.summary.totalOverdueCents).toBe(0);
    });

    it("still surfaces the externally-managed obligation, in full, as reconciliation-required — never hidden", () => {
      const report = buildDelinquentTenantsReport(externallyManagedInput, "2026-08-16");
      expect(report.summary.externallyManagedCents).toBe(150000);
      expect(report.summary.externallyManagedChargeCount).toBe(1);
      expect(report.rows[0].externallyManagedCents).toBe(150000);
    });

    it("classifies an overdue charge with no matching schedule row as externally managed, never as a FORGE delinquency (fails safe)", () => {
      const report = buildDelinquentTenantsReport({ ...externallyManagedInput, schedules: [] }, "2026-08-16");
      expect(report.summary.delinquentLeaseCount).toBe(0);
      expect(report.summary.externallyManagedCents).toBe(150000);
    });
  });
});
