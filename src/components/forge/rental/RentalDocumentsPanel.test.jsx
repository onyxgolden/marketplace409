import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalDocumentsPanel, { leaseOptionsFor } from "./RentalDocumentsPanel.jsx";

const baseData = { documents: [], schedules: [] };

describe("RentalDocumentsPanel", () => {
  it("shows the general lease-document header outside property context", () => {
    const markup = renderToStaticMarkup(<RentalDocumentsPanel initialData={baseData} />);
    expect(markup).toContain("Lease documents and notices");
    expect(markup).toContain("Upload document");
    expect(markup).not.toContain("Publish this document to the tenant portal");
  });

  it("scopes the header to the property when navigated from Property actions -> File library", () => {
    const markup = renderToStaticMarkup(<RentalDocumentsPanel initialData={baseData} recordContext={{ recordType: "unit", recordId: "unit_1", propertyId: "930 Highland Drive" }} />);
    expect(markup).toContain("Documents — 930 Highland Drive");
  });

  it("shows a search box", () => {
    const markup = renderToStaticMarkup(<RentalDocumentsPanel initialData={baseData} />);
    expect(markup).toContain("Search documents");
  });

  it("selects the first document by default and surfaces its version, category, and action controls", () => {
    const data = {
      documents: [{
        id: "rental_document_1", title: "Survey / Plat", category: "survey_plat", property_id: "930 Highland Drive",
        lease_id: null, version_number: 1, is_current_version: true, tenant_visible: false,
        original_filename: "survey.pdf", created_at: "2026-08-24T00:00:00Z", acknowledgements: [], expiration_status: null,
      }],
      schedules: [],
    };
    const markup = renderToStaticMarkup(<RentalDocumentsPanel initialData={data} recordContext={{ recordType: "unit", recordId: "unit_1", propertyId: "930 Highland Drive" }} />);
    expect(markup).toContain("Survey / Plat");
    expect(markup).toContain("v1 (current)");
    expect(markup).toContain("Property document (not publishable)");
    expect(markup).toContain("Preview");
    expect(markup).toContain("Download");
    expect(markup).toContain("Upload new version");
    expect(markup).toContain("Version history");
    expect(markup).toContain("Audit trail");
    expect(markup).toContain("Remove");
  });

  it("shows an expiration badge with its status and date when a document has expires_at", () => {
    const data = {
      documents: [{
        id: "rental_document_1", title: "Insurance policy", category: "insurance_policy", property_id: "930 Highland Drive",
        lease_id: null, version_number: 1, is_current_version: true, tenant_visible: false, expires_at: "2020-01-01",
        expiration_status: "expired", original_filename: "policy.pdf", created_at: "2026-08-24T00:00:00Z", acknowledgements: [],
      }],
      schedules: [],
    };
    const markup = renderToStaticMarkup(<RentalDocumentsPanel initialData={data} />);
    expect(markup).toContain("Expired");
  });

  it("never claims a property-only document is published to the tenant portal", () => {
    const data = {
      documents: [{
        id: "rental_document_1", title: "Deed", category: "deed", property_id: "930 Highland Drive", lease_id: null,
        version_number: 1, is_current_version: true, tenant_visible: false, original_filename: "deed.pdf",
        created_at: "2026-08-24T00:00:00Z", acknowledgements: [], expiration_status: null,
      }],
      schedules: [],
    };
    const markup = renderToStaticMarkup(<RentalDocumentsPanel initialData={data} />);
    expect(markup).toContain("The tenant cannot access this document.");
    expect(markup).not.toContain("Published to the tenant portal");
  });
});

describe("leaseOptionsFor", () => {
  const data = {
    leases: [{ id: "lease_1", unit_id: "unit_1", status: "active" }],
    units: [{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive" }],
    tenants: [{ id: "tenant_1", display_name: "Ashley George" }],
    leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
  };
  it("labels each lease option with tenant, unit, and property instead of a raw UUID", () => {
    const options = leaseOptionsFor([{ id: "sched_1", lease_id: "lease_1" }], data);
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe("lease_1");
    expect(options[0].label).toBe("Ashley George · 930 Highland Drive · 930-highland-drive");
    expect(options[0].label).not.toMatch(/lease_1/);
  });
  it("falls back to a short lease id when no labels resolve", () => {
    const options = leaseOptionsFor([{ id: "sched_9", lease_id: "rental_lease_9530cad2-7457-4bca-8d7c-974cc5d6c1e3" }], {});
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe("Lease rental_l");
  });
  it("dedupes schedules that share a lease", () => {
    const options = leaseOptionsFor([{ id: "s_1", lease_id: "lease_1" }, { id: "s_2", lease_id: "lease_1" }], data);
    expect(options).toHaveLength(1);
  });
});
