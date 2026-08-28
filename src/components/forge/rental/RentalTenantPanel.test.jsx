import { describe, expect, it } from "vitest";
import { activeBalanceCentsForTenant, propertyLabelForTenant, tenantHouseholdForSelection } from "./RentalTenantPanel";

const leases = [
  { id: "lease_1", unit_id: "unit_1", status: "active" },
  { id: "lease_2", unit_id: "unit_2", status: "ended" },
];
const leaseMemberships = [{ lease_id: "lease_1", tenant_id: "tenant_1" }, { lease_id: "lease_2", tenant_id: "tenant_2" }];
const units = [{ id: "unit_1", label: "Main residence" }, { id: "unit_2", label: "Rear unit" }];

describe("propertyLabelForTenant", () => {
  it("resolves the unit label from the tenant's active lease", () => {
    expect(propertyLabelForTenant({ id: "tenant_1" }, leases, leaseMemberships, units)).toBe("Main residence");
  });
  it("returns null when the tenant's only lease is not active", () => {
    expect(propertyLabelForTenant({ id: "tenant_2" }, leases, leaseMemberships, units)).toBeNull();
  });
  it("returns null when the tenant has no lease membership at all", () => {
    expect(propertyLabelForTenant({ id: "tenant_3" }, leases, leaseMemberships, units)).toBeNull();
  });
  it("falls back to the raw unit id if the unit record is missing", () => {
    expect(propertyLabelForTenant({ id: "tenant_1" }, leases, leaseMemberships, [])).toBe("unit_1");
  });
});

describe("activeBalanceCentsForTenant", () => {
  it("totals the remaining open charges on the tenant's active lease", () => {
    const charges = [
      { lease_id: "lease_1", amount_cents: 120000, paid_amount_cents: 20000 },
      { lease_id: "lease_1", amount_cents: 5000, paid_amount_cents: 0 },
      { lease_id: "lease_2", amount_cents: 90000, paid_amount_cents: 0 },
    ];
    expect(activeBalanceCentsForTenant({ id: "tenant_1" }, leases, leaseMemberships, charges)).toBe(105000);
  });
  it("returns zero when an active tenant has no open charges", () => {
    expect(activeBalanceCentsForTenant({ id: "tenant_1" }, leases, leaseMemberships, [])).toBe(0);
  });
  it("returns null when the tenant has no active lease", () => {
    expect(activeBalanceCentsForTenant({ id: "tenant_2" }, leases, leaseMemberships, [])).toBeNull();
  });
});

describe("tenantHouseholdForSelection", () => {
  it("keeps the stored primary tenant first and returns co-tenants separately", () => {
    const householdTenants = [{ id: "tenant_1", display_name: "Primary" }, { id: "tenant_2", display_name: "Spouse" }];
    const memberships = [{ lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }, { lease_id: "lease_1", tenant_id: "tenant_2", occupancy_role: "co_tenant" }];
    const household = tenantHouseholdForSelection(householdTenants[1], householdTenants, [{ id: "lease_1", unit_id: "unit_1", status: "active" }], memberships, units);
    expect(household.primaryTenant.display_name).toBe("Primary");
    expect(household.coTenants.map((tenant) => tenant.display_name)).toEqual(["Spouse"]);
  });
});
