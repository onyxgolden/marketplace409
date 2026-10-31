// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { tenantHouseholdForSelection } from "./RentalTenantPanel.jsx";

// The Kent shape: one tenant holds a co_tenant membership on BOTH a
// cancelled lease and an active lease. The household view (and therefore
// the existing Make-primary button from PR #702) must resolve to the
// ACTIVE lease, never the cancelled one, regardless of array order.
const tenants = [
  { id: "tenant_1", display_name: "Jacquelyn Parmenter", email: "jackie@example.com" },
  { id: "tenant_2", display_name: "Taylor Parmenter", email: "taylor@example.com" },
];
const units = [{ id: "unit_1", label: "4800 KENT AVE" }];

describe("tenantHouseholdForSelection active-lease preference", () => {
  it("resolves to the active lease when the tenant is co_tenant on a cancelled lease and an active lease", () => {
    const leases = [
      { id: "lease_cancelled", unit_id: "unit_1", status: "cancelled" },
      { id: "lease_active", unit_id: "unit_1", status: "active" },
    ];
    const leaseMemberships = [
      { lease_id: "lease_cancelled", tenant_id: "tenant_1", occupancy_role: "co_tenant" },
      { lease_id: "lease_active", tenant_id: "tenant_1", occupancy_role: "co_tenant" },
    ];
    const household = tenantHouseholdForSelection(tenants[0], tenants, leases, leaseMemberships, units);
    expect(household.lease.id).toBe("lease_active");
    expect(household.unit.label).toBe("4800 KENT AVE");
  });

  it("still resolves to the active lease when the cancelled lease sorts first and the active lease has a true primary", () => {
    const leases = [
      { id: "lease_cancelled", unit_id: "unit_1", status: "cancelled" },
      { id: "lease_active", unit_id: "unit_1", status: "active" },
    ];
    const leaseMemberships = [
      { lease_id: "lease_cancelled", tenant_id: "tenant_1", occupancy_role: "co_tenant" },
      { lease_id: "lease_active", tenant_id: "tenant_1", occupancy_role: "primary" },
      { lease_id: "lease_active", tenant_id: "tenant_2", occupancy_role: "co_tenant" },
    ];
    const household = tenantHouseholdForSelection(tenants[0], tenants, leases, leaseMemberships, units);
    expect(household.lease.id).toBe("lease_active");
    expect(household.primaryTenant.id).toBe("tenant_1");
    expect(household.coTenants.map((tenant) => tenant.id)).toEqual(["tenant_2"]);
  });
});
