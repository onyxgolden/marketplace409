import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalSetupPanel, { activeBalanceCentsForUnit, tenantLabelForUnit } from "./RentalSetupPanel";

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

describe("activeBalanceCentsForUnit", () => {
  it("totals the remaining open charges on the unit's active lease", () => {
    const charges = [
      { lease_id: "lease_1", amount_cents: 120000, paid_amount_cents: 20000 },
      { lease_id: "lease_1", amount_cents: 5000, paid_amount_cents: 0 },
      { lease_id: "lease_2", amount_cents: 90000, paid_amount_cents: 0 },
    ];
    expect(activeBalanceCentsForUnit({ id: "unit_1" }, leases, charges)).toBe(105000);
  });
  it("returns zero when an occupied unit has no open charges", () => {
    expect(activeBalanceCentsForUnit({ id: "unit_1" }, leases, [])).toBe(0);
  });
  it("returns null when the unit has no active lease", () => {
    expect(activeBalanceCentsForUnit({ id: "unit_2" }, leases, [])).toBeNull();
  });
});

describe("RentalSetupPanel new-unit creation", () => {
  it("labels the create action generically instead of naming a specific property", () => {
    const markup = renderToStaticMarkup(<RentalSetupPanel />);
    expect(markup).toContain("Review and create property / unit");
    expect(markup).not.toContain("Save Kent Avenue unit");
  });
  it("uses the wide property-address, tenant, and balance layout for saved properties", () => {
    const markup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "occupied" }]} />);
    expect(markup).toContain('data-list-size="wide"');
    expect(markup).toContain("Property address");
    expect(markup).toContain("Tenant");
    expect(markup).toContain("Active balance");
    expect(markup).toContain("930 Highland Drive");
  });
});
