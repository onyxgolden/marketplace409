import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalTenantPanel, { activeBalanceCentsForTenant, propertyLabelForTenant, tenantHouseholdForSelection } from "./RentalTenantPanel";

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

// FORGE does not collect tenant birth dates -- verifies the field is gone from the form and never
// re-appears even for a legacy tenant record that still happens to carry a stored date_of_birth
// value (proving it's not displayed, not merely not requested for new tenants).
describe("RentalTenantPanel birth-date removal", () => {
  it("never renders a date-of-birth field or label, even for a legacy tenant record with a stored value", () => {
    const legacyTenant = {
      id: "tenant_1", display_name: "Ashley George", email: "ashley@example.com", phone: "555-1000",
      date_of_birth: "1990-01-01", status: "active",
    };
    const markup = renderToStaticMarkup(<RentalTenantPanel initialTenants={[legacyTenant]} />);
    expect(markup).not.toContain("Date of birth");
    expect(markup).not.toContain("dateOfBirth");
    expect(markup).not.toContain("1990-01-01");
  });

  it("does not include a dateOfBirth field in the tenant-creation form submission shape", () => {
    // The create form only ever sends displayName/email/phone (see RentalTenantPanel.jsx's save()) --
    // this pins that shape so a birth-date field can't be silently reintroduced there either.
    const markup = renderToStaticMarkup(<RentalTenantPanel initialTenants={[]} />);
    expect(markup).not.toContain("Date of birth");
    expect(markup).not.toContain('name="dateOfBirth"');
  });
});
