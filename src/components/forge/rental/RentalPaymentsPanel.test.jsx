import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalPaymentsPanel, { resolveScheduleContext } from "./RentalPaymentsPanel";

const baseData = {
  openCharges: [], payments: [], settlements: [],
  leases: [
    { id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" },
    { id: "lease_2", unit_id: "unit_2", property_id: "property-2", status: "active" },
  ],
  units: [
    { id: "unit_1", label: "Main residence", property_id: "property-1" },
    { id: "unit_2", label: "TEST-", property_id: "property-2" },
  ],
  tenants: [
    { id: "tenant_1", display_name: "Anthony Babino" },
    { id: "tenant_2", display_name: "Brandy Morgan" },
  ],
  leaseMemberships: [
    { lease_id: "lease_1", tenant_id: "tenant_1" },
    { lease_id: "lease_2", tenant_id: "tenant_2" },
  ],
  schedules: [
    { id: "schedule_1", lease_id: "lease_1", amount_cents: 130000, due_day: 1, status: "active" },
    { id: "schedule_2", lease_id: "lease_2", amount_cents: 130000, due_day: 1, status: "active" },
  ],
};

describe("resolveScheduleContext", () => {
  it("resolves tenant through lease memberships, unit through lease.unit_id, and property through the unit", () => {
    expect(resolveScheduleContext(baseData.schedules[1], baseData)).toEqual({
      leaseId: "lease_2", leaseStatus: "active", tenantLabel: "Brandy Morgan", unitLabel: "TEST-", propertyLabel: "property-2",
    });
  });

  it("distinguishes two schedules with identical rent and due day by tenant/unit/property", () => {
    expect(baseData.schedules[0].amount_cents).toBe(baseData.schedules[1].amount_cents);
    expect(baseData.schedules[0].due_day).toBe(baseData.schedules[1].due_day);
    const contextOne = resolveScheduleContext(baseData.schedules[0], baseData);
    const contextTwo = resolveScheduleContext(baseData.schedules[1], baseData);
    expect(contextOne.tenantLabel).not.toBe(contextTwo.tenantLabel);
    expect(contextOne.unitLabel).not.toBe(contextTwo.unitLabel);
    expect(contextOne.propertyLabel).not.toBe(contextTwo.propertyLabel);
  });

  it("joins every tenant on a multi-tenant lease instead of guessing a single one", () => {
    const data = { ...baseData, leaseMemberships: [...baseData.leaseMemberships, { lease_id: "lease_1", tenant_id: "tenant_2" }] };
    expect(resolveScheduleContext(baseData.schedules[0], data).tenantLabel).toBe("Anthony Babino, Brandy Morgan");
  });

  it("shows an explicit Unknown warning instead of silently omitting an unresolved tenant", () => {
    const data = { ...baseData, leaseMemberships: [] };
    expect(resolveScheduleContext(baseData.schedules[0], data).tenantLabel).toBe("Unknown tenant");
  });

  it("shows an explicit Unknown warning instead of silently omitting an unresolved unit", () => {
    const data = { ...baseData, units: [] };
    expect(resolveScheduleContext(baseData.schedules[0], data).unitLabel).toBe("Unknown unit");
  });

  it("falls back to the lease's own property id, then an explicit Unknown warning, when neither the unit nor lease can be resolved", () => {
    const noUnitData = { ...baseData, units: [] };
    expect(resolveScheduleContext(baseData.schedules[0], noUnitData).propertyLabel).toBe("property-1");
    const noLeaseData = { ...baseData, leases: [] };
    expect(resolveScheduleContext(baseData.schedules[0], noLeaseData).propertyLabel).toBe("Unknown property");
  });

  it("reports an unresolved lease explicitly instead of guessing a status", () => {
    const data = { ...baseData, leases: [] };
    expect(resolveScheduleContext(baseData.schedules[0], data).leaseStatus).toBeNull();
  });
});

describe("RentalPaymentsPanel charge-generation identity", () => {
  it("shows tenant, unit, and property for every charge-generation row, distinguishing identical-rent leases", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={baseData} initialAccount={null} initialShowSetup />);
    expect(markup).toContain("Anthony Babino");
    expect(markup).toContain("Main residence");
    expect(markup).toContain("property-1");
    expect(markup).toContain("Brandy Morgan");
    expect(markup).toContain("TEST-");
    expect(markup).toContain("property-2");
  });

  it("keeps the Generate monthly charge action tied to the correct schedule", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={baseData} initialAccount={null} initialShowSetup />);
    expect(markup.split("Generate monthly charge").length - 1).toBe(2);
  });

  it("shows an explicit Unknown warning in the row instead of silently omitting identity", () => {
    const orphanData = { ...baseData, leaseMemberships: [], units: [], leases: [] };
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={orphanData} initialAccount={null} initialShowSetup />);
    expect(markup).toContain("Unknown tenant");
    expect(markup).toContain("Unknown unit");
    expect(markup).toContain("Unknown property");
  });
});
