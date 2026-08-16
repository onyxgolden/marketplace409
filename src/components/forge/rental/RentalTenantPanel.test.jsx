import { describe, expect, it } from "vitest";
import { propertyLabelForTenant } from "./RentalTenantPanel";

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
