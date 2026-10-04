import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import RentalLeasePanel from "./RentalLeasePanel.jsx";
import RentalSetupPanel from "./RentalSetupPanel.jsx";
import RentalTenantPanel from "./RentalTenantPanel.jsx";

describe("rental existing-record safety", () => {
  afterEach(() => { clearSWRCache(); });
  it("shows an existing lease and hides duplicate creation by default", async () => {
    // Seed the SWR cache so the converted panel renders its lease detail
    // instead of the loading skeleton on a cold static render.
    const initialSetup = { units: [{ id: "unit_1", label: "Main residence" }], tenants: [], leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", monthly_rent_cents: 200000, start_date: "2026-08-12", end_date: null }] };
    await fetchWithDedupe("rental:lease-setup", () => Promise.resolve(initialSetup));
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={initialSetup} />);
    expect(markup).toContain("Selected lease");
    expect(markup).toContain("$2,000.00 monthly");
    expect(markup).toContain("Add a lease for an existing tenant");
    expect(markup).not.toContain("Save draft lease and schedule");
  });

  it("warns about an existing lease and provides a setup cancel action", async () => {
    // Rendered with loadOnMount={false} so the static render exercises the
    // open create form against initialSetup. Seeding the SWR cache would let
    // the panel's one-time data adoption collapse the form during a static
    // render (the old adoption ran in an effect, which static renders skip;
    // the exception-first dashboard slice moved it to render time).
    const initialSetup = { units: [{ id: "unit_1", label: "Main residence" }], tenants: [{ id: "tenant_1", display_name: "John Jones" }], leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", monthly_rent_cents: 200000, start_date: "2026-08-12" }] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialShowCreate initialSetup={initialSetup} loadOnMount={false} />);
    expect(markup).toContain("Other leases already exist");
    expect(markup).toContain("Cancel setup");
    expect(markup).toContain("Save draft lease and schedule");
  });

  it("keeps unit and tenant creation behind explicit add actions", () => {
    const unitMarkup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "Main residence", property_id: "4800-kent-ave" }]} />);
    const tenantIndexMarkup = renderToStaticMarkup(<RentalTenantPanel initialTenants={[{ id: "tenant_1", display_name: "John Jones", email: "tenant@example.com" }]} />);
    const tenantRecordMarkup = renderToStaticMarkup(<RentalTenantPanel initialTenants={[{ id: "tenant_1", display_name: "John Jones", email: "tenant@example.com" }]} recordContext={{ recordType: "tenant", recordId: "tenant_1" }} />);
    expect(unitMarkup).toContain("Add a new property / unit");
    expect(unitMarkup).toContain("Selected unit");
    expect(unitMarkup).toContain("Property actions");
    expect(unitMarkup).toContain("Edit property details");
    expect(unitMarkup).toContain("Financial setup");
    expect(unitMarkup).toContain("Work orders");
    expect(unitMarkup).toContain("File library");
    expect(unitMarkup).not.toContain("Save Kent Avenue unit");
    // Index mode is a pure list: no record preview, no creation form.
    expect(tenantIndexMarkup).toContain("Add a new tenant");
    expect(tenantIndexMarkup).not.toContain("Tenant record");
    expect(tenantIndexMarkup).not.toContain(">Save tenant</button>");
    // Record mode: the dedicated tenant record page leads with the details tab;
    // the profile ("Primary tenant") renders immediately, the ledger is one click away.
    expect(tenantRecordMarkup).toContain("Tenant record");
    expect(tenantRecordMarkup).toContain('data-record-tab="details"');
    expect(tenantRecordMarkup).toContain('data-record-tab="ledger"');
    expect(tenantRecordMarkup).toContain("Primary tenant");
    expect(tenantRecordMarkup).toContain("Tenant actions");
    expect(tenantRecordMarkup).toContain("Rent &amp; payments");
    expect(tenantRecordMarkup).toContain("Messaging");
    expect(tenantRecordMarkup).toContain("File library");
    expect(tenantRecordMarkup).not.toContain(">Save tenant</button>");
  });
});
