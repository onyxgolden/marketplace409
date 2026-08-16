import { describe, expect, it } from "vitest";
import { tenantLabelForUnit } from "./RentalSetupPanel";

const leases = [
  { id: "lease_1", unit_id: "unit_1", status: "active" },
  { id: "lease_2", unit_id: "unit_2", status: "ended" },
];
const leaseMemberships = [{ lease_id: "lease_1", tenant_id: "tenant_1" }, { lease_id: "lease_1", tenant_id: "tenant_2" }];
const tenants = [{ id: "tenant_1", display_name: "Ashley George" }, { id: "tenant_2", display_name: "Justin Graham" }];

describe("tenantLabelForUnit", () => {
  it("joins every tenant on the unit's active lease", () => {
    expect(tenantLabelForUnit({ id: "unit_1" }, leases, leaseMemberships, tenants)).toBe("Ashley George, Justin Graham");
  });
  it("returns null when the unit's only lease is not active", () => {
    expect(tenantLabelForUnit({ id: "unit_2" }, leases, leaseMemberships, tenants)).toBeNull();
  });
  it("returns null when the unit has no lease at all", () => {
    expect(tenantLabelForUnit({ id: "unit_3" }, leases, leaseMemberships, tenants)).toBeNull();
  });
  it("returns null when an active lease has no tenant membership recorded", () => {
    expect(tenantLabelForUnit({ id: "unit_1" }, leases, [], tenants)).toBeNull();
  });
});
