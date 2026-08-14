import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalApplicationShell, { buildRentalSurface, RENTAL_FUNCTIONS, RENTAL_NAVIGATION } from "./RentalApplicationShell.jsx";
describe("RentalApplicationShell", () => {
  it("offers the complete first-tenant operating functions", () => {
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toEqual(["overview", "setup", "tenants", "leases", "rentec-migration", "charges", "reconciliation", "deposits", "reports", "maintenance", "inspections", "insurance", "documents", "communications", "lease-lifecycle", "lease-preparation", "autopay", "animals", "support"]);
  });
  it("renders an exception-first summary in grouped navigation", () => {
    const markup = renderToStaticMarkup(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    expect(markup).toContain("Rental operations");
    expect(markup).toContain("Loading rental summary");
    expect(markup).toContain('aria-label="Rental Manager functions"');
    expect(RENTAL_NAVIGATION.map(({ label }) => label)).toEqual(["Overview", "Portfolio", "Money", "Operations", "Controls"]);
  });
  it("renders one selected function surface", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("leases"));
    expect(markup).toContain("Leases and rent schedules");
    expect(markup).not.toContain("4800 Kent Avenue");
  });
  it("renders functional tenant and lease setup surfaces", () => {
    expect(renderToStaticMarkup(buildRentalSurface("tenants"))).toContain("Tenants");
    expect(renderToStaticMarkup(buildRentalSurface("leases"))).toContain("Leases and rent schedules");
  });
  it("renders a preview-only Rentec migration surface",()=>{const markup=renderToStaticMarkup(buildRentalSurface("rentec-migration"));expect(markup).toContain("Import from Rentec Direct");expect(markup).toContain("cannot write Rentec or FORGE records");});
  it("preserves selected-record context while navigating between rental surfaces",()=>{const markup=renderToStaticMarkup(<RentalApplicationShell activeFunctionId="charges" activeRecordContext={{recordType:"tenant",recordId:"tenant_1",recordLabel:"Test Tenant"}} onFunctionChange={()=>{}}/>);expect(markup).toContain('data-record-context="tenant_1"');expect(markup).toContain("Working with tenant: Test Tenant");expect(markup).toContain("Back to record")});
  it("requires persisted unit and tenant selections instead of manual ids", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("leases"));
    expect(markup).toContain("Select a saved unit");
    expect(markup).toContain("Select a saved tenant");
    expect(markup).not.toContain("Tenant ID");
  });
  it("keeps lease activation and first-charge controls in secondary billing setup", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("charges"));
    expect(markup).toContain("Rent &amp; payments");
    expect(markup).toContain("Billing setup");
    expect(markup).not.toContain("Activate lease and schedule");
  });
  it("renders the maintenance request operations surface", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("maintenance"));
    expect(markup).toContain("Requests and work orders");
    expect(markup).toContain("No maintenance requests have been submitted");
  });
  it("renders the secure rental document library", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("documents"));
    expect(markup).toContain("Lease documents and notices");
    expect(markup).toContain("Upload document");
    expect(markup).not.toContain("Publish this document to the tenant portal");
  });
  it("renders the auditable notification outbox with reminder setup hidden",()=>{const markup=renderToStaticMarkup(buildRentalSurface("communications"));expect(markup).toContain("Notification outbox");expect(markup).toContain("Email delivery is not active");expect(markup).toContain("Queue reminder");expect(markup).not.toContain("Maximum attempts");});
  it("renders payment reconciliation boundaries",()=>{const markup=renderToStaticMarkup(buildRentalSurface("reconciliation"));expect(markup).toContain("Payment reconciliation");expect(markup).toContain("gross rental income posting is implemented");});
  it("renders rent roll and tenant ledger reporting",()=>{const markup=renderToStaticMarkup(buildRentalSurface("reports"));expect(markup).toContain("Rent roll and tenant ledger");expect(markup).toContain("Loading report");});
  it("renders a separate security-deposit liability ledger",()=>{const markup=renderToStaticMarkup(buildRentalSurface("deposits"));expect(markup).toContain("Security deposits");expect(markup).toContain("never treated as rent or NOI");});
  it("renders controlled move-in and move-out inspections",()=>{const markup=renderToStaticMarkup(buildRentalSurface("inspections"));expect(markup).toContain("Move-in, move-out, and periodic inspections");expect(markup).toContain("never creates a deduction");});
  it("renders auditable lease changes and owner-controlled late fees",()=>{const markup=renderToStaticMarkup(buildRentalSurface("lease-lifecycle"));expect(markup).toContain("Renewals, amendments, and prorating");expect(markup).toContain("Owner-controlled late fees");});
  it("renders editable lease preparation without claiming a licensed form",()=>{const markup=renderToStaticMarkup(buildRentalSurface("lease-preparation"));expect(markup).toContain("Editable terms and version history");expect(markup).toContain("not the Texas REALTORS® form");expect(markup).toContain("Save immutable draft version");});
  it("shows owner autopay authorization without claiming consent activates a debit",()=>{const markup=renderToStaticMarkup(buildRentalSurface("autopay"));expect(markup).toContain("Tenant authorizations");expect(markup).toContain("Consent alone never activates a debit");});
  it("separates pet fees from assistance-animal review",()=>{const markup=renderToStaticMarkup(buildRentalSurface("animals"));expect(markup).toContain("Pet approvals and assistance review");expect(markup).toContain("can never receive a pet fee");});
  it("renders support cases without automatic money movement",()=>{const markup=renderToStaticMarkup(buildRentalSurface("support"));expect(markup).toContain("Support and incident cases");expect(markup).toContain("without automatically moving money");});
});
