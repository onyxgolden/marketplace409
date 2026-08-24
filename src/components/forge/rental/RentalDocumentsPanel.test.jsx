import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalDocumentsPanel from "./RentalDocumentsPanel.jsx";

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
