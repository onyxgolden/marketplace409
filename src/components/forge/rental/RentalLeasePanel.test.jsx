import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalLeasePanel, { deriveLeaseFormDefaults, propertyIdForSelectedUnit } from "./RentalLeasePanel";

const draftSetup = {
  units: [{ id: "unit_1", label: "1218 Wagner", property_id: "1218-wagner" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino", email: "a@example.com" }],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status: "draft", monthly_rent_cents: 130000, rent_due_day: 1, start_date: "2026-08-01", end_date: "2027-08-01" }],
  schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "draft" }],
};

describe("RentalLeasePanel", () => {
  it("shows an Activate lease button for a draft lease", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={draftSetup} loadOnMount={false} />);
    expect(markup).toContain("Activate lease");
    expect(markup).toContain("draft");
  });
  it("does not show an Activate lease button once the lease is active", () => {
    const activeSetup = { ...draftSetup, leases: [{ ...draftSetup.leases[0], status: "active" }] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={activeSetup} loadOnMount={false} />);
    expect(markup).not.toContain("Activate lease");
  });
  it("shows a rent schedule setup form instead of Activate lease when the lease has no schedule yet", () => {
    const noScheduleSetup = { ...draftSetup, schedules: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={noScheduleSetup} loadOnMount={false} />);
    expect(markup).not.toContain("Activate lease");
    expect(markup).toContain("No rent schedule yet");
    expect(markup).toContain("Save rent schedule");
    expect(markup).toContain('value="1300.00"');
  });
  it("shows a Cancel this lease action for a draft lease", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={draftSetup} loadOnMount={false} />);
    expect(markup).toContain("Cancel this lease");
  });
  it("does not show Cancel this lease once the lease is active", () => {
    const activeSetup = { ...draftSetup, leases: [{ ...draftSetup.leases[0], status: "active" }] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={activeSetup} loadOnMount={false} />);
    expect(markup).not.toContain("Cancel this lease");
  });
  it("color-codes lease status in the list and detail badge", () => {
    const activeSetup = { ...draftSetup, leases: [{ ...draftSetup.leases[0], status: "active" }] };
    const draftMarkup = renderToStaticMarkup(<RentalLeasePanel initialSetup={draftSetup} loadOnMount={false} />);
    const activeMarkup = renderToStaticMarkup(<RentalLeasePanel initialSetup={activeSetup} loadOnMount={false} />);
    expect(draftMarkup).toContain("text-amber-700");
    expect(activeMarkup).toContain("text-emerald-700");
  });

  it("never falls back to a hardcoded Kent Avenue property id when creating a lease with no records yet", () => {
    const emptySetup = { units: [], tenants: [], leases: [], schedules: [], leaseMemberships: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={emptySetup} loadOnMount={false} />);
    expect(markup).not.toContain("4800-kent-ave");
    expect(markup).not.toContain('name="propertyId"');
  });

  it("includes a newly saved unit in the rental unit dropdown", () => {
    const setup = { units: [{ id: "unit_test", label: "TEST unit", property_id: "test-property" }],
      tenants: [{ id: "tenant_1", display_name: "Brandy Morgan", email: "brandy@example.com" }],
      leases: [], schedules: [], leaseMemberships: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("TEST unit — test-property");
  });

  it("preselects the tenant and opens lease creation when navigated from a tenant with no existing lease", () => {
    const setup = { units: [{ id: "unit_test", label: "TEST unit", property_id: "test-property" }],
      tenants: [{ id: "tenant_brandy", display_name: "Brandy Morgan", email: "brandy@example.com" },
        { id: "tenant_other", display_name: "Other Tenant", email: "other@example.com" }],
      leases: [], schedules: [], leaseMemberships: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false}
      recordContext={{ recordType: "tenant", recordId: "tenant_brandy", recordLabel: "Brandy Morgan" }} />);
    expect(markup).toContain('value="tenant_brandy" selected');
  });

  it("does not silently substitute the first tenant when a tenant context is given", () => {
    const setup = { units: [], tenants: [{ id: "tenant_first", display_name: "First Tenant", email: "first@example.com" },
      { id: "tenant_brandy", display_name: "Brandy Morgan", email: "brandy@example.com" }], leases: [], schedules: [], leaseMemberships: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false}
      recordContext={{ recordType: "tenant", recordId: "tenant_brandy", recordLabel: "Brandy Morgan" }} />);
    expect(markup).not.toContain('value="tenant_first" selected');
    expect(markup).toContain('value="tenant_brandy" selected');
  });

  it("derives the property from the selected unit instead of accepting free text", () => {
    const setup = { units: [{ id: "unit_test", label: "TEST unit", property_id: "test-property" }],
      tenants: [{ id: "tenant_1", display_name: "Brandy Morgan", email: "brandy@example.com" }],
      leases: [], schedules: [], leaseMemberships: [] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).not.toContain('name="propertyId"');
    expect(markup).toContain("Select a rental unit");
  });
});

describe("deriveLeaseFormDefaults", () => {
  it("opens creation and preselects the tenant when the context tenant has no existing lease", () => {
    const setup = { leases: [], leaseMemberships: [] };
    expect(deriveLeaseFormDefaults(setup, { recordType: "tenant", recordId: "tenant_brandy" }))
      .toEqual({ tenantId: "tenant_brandy", showCreate: true, selectedId: null });
  });

  it("selects the tenant's existing lease instead of creation when one already exists", () => {
    const setup = { leases: [{ id: "lease_1" }], leaseMemberships: [{ tenant_id: "tenant_brandy", lease_id: "lease_1" }] };
    expect(deriveLeaseFormDefaults(setup, { recordType: "tenant", recordId: "tenant_brandy" }))
      .toEqual({ tenantId: "tenant_brandy", showCreate: false, selectedId: "lease_1" });
  });

  it("falls back to the generic first-lease behavior without a tenant context", () => {
    const setup = { leases: [{ id: "lease_1" }], leaseMemberships: [] };
    expect(deriveLeaseFormDefaults(setup, null)).toEqual({ tenantId: null, showCreate: false, selectedId: "lease_1" });
  });

  it("opens creation with no records at all", () => {
    expect(deriveLeaseFormDefaults({ leases: [], leaseMemberships: [] }, null))
      .toEqual({ tenantId: null, showCreate: true, selectedId: null });
  });
});

describe("propertyIdForSelectedUnit", () => {
  it("resolves the property id from the matching unit", () => {
    const units = [{ id: "unit_1", property_id: "1218-wagner" }, { id: "unit_2", property_id: "test-property" }];
    expect(propertyIdForSelectedUnit(units, "unit_2")).toBe("test-property");
  });
  it("returns null when no unit is selected or found", () => {
    const units = [{ id: "unit_1", property_id: "1218-wagner" }];
    expect(propertyIdForSelectedUnit(units, "")).toBeNull();
    expect(propertyIdForSelectedUnit(units, "unit_missing")).toBeNull();
  });
});
