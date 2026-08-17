import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalLeasePanel from "./RentalLeasePanel.jsx";
import RentalSetupPanel from "./RentalSetupPanel.jsx";
import RentalTenantPanel from "./RentalTenantPanel.jsx";

describe("rental existing-record safety", () => {
  it("shows an existing lease and hides duplicate creation by default", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={{ units: [{ id: "unit_1", label: "Main residence" }], tenants: [], leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", monthly_rent_cents: 200000, start_date: "2026-08-12", end_date: null }] }} />);
    expect(markup).toContain("Selected lease");
    expect(markup).toContain("$2,000.00 monthly");
    expect(markup).toContain("Add a lease for an existing tenant");
    expect(markup).not.toContain("Save draft lease and schedule");
  });

  it("warns about an existing lease and provides a setup cancel action", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialShowCreate initialSetup={{ units: [{ id: "unit_1", label: "Main residence" }], tenants: [{ id: "tenant_1", display_name: "John Jones" }], leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", monthly_rent_cents: 200000, start_date: "2026-08-12" }] }} />);
    expect(markup).toContain("Other leases already exist");
    expect(markup).toContain("Cancel setup");
    expect(markup).toContain("Save draft lease and schedule");
  });

  it("keeps unit and tenant creation behind explicit add actions", () => {
    const unitMarkup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "Main residence", property_id: "4800-kent-ave" }]} />);
    const tenantMarkup = renderToStaticMarkup(<RentalTenantPanel initialTenants={[{ id: "tenant_1", display_name: "John Jones", email: "tenant@example.com" }]} />);
    expect(unitMarkup).toContain("Add a new property / unit");
    expect(unitMarkup).toContain("Selected unit");
    expect(unitMarkup).toContain("Property actions");
    expect(unitMarkup).toContain("Edit property details");
    expect(unitMarkup).toContain("Work orders");
    expect(unitMarkup).toContain("File library");
    expect(unitMarkup).not.toContain("Save Kent Avenue unit");
    expect(tenantMarkup).toContain("Add a new tenant");
    expect(tenantMarkup).toContain("Selected tenant");
    expect(tenantMarkup).toContain("Tenant actions");
    expect(tenantMarkup).toContain("Rent &amp; payments");
    expect(tenantMarkup).toContain("Messaging");
    expect(tenantMarkup).toContain("File library");
    expect(tenantMarkup).not.toContain("Save tenant");
  });
});
