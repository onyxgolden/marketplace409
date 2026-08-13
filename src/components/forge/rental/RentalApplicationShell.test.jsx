import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalApplicationShell, { buildRentalSurface, RENTAL_FUNCTIONS } from "./RentalApplicationShell.jsx";
describe("RentalApplicationShell", () => {
  it("offers the complete first-tenant operating functions", () => {
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toEqual(["overview", "setup", "tenants", "leases", "charges", "insurance", "maintenance", "documents", "communications", "reconciliation", "reports", "deposits", "inspections", "lease-lifecycle", "lease-preparation", "autopay"]);
  });
  it("renders the Kent Avenue launch overview", () => {
    const markup = renderToStaticMarkup(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    expect(markup).toContain("4800 Kent Avenue");
    expect(markup).toContain("First production rental");
  });
  it("renders one selected function surface", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("leases"));
    expect(markup).toContain("Record lease and rent schedule");
    expect(markup).not.toContain("4800 Kent Avenue");
  });
  it("renders functional tenant and lease setup surfaces", () => {
    expect(renderToStaticMarkup(buildRentalSurface("tenants"))).toContain("Create the Kent Avenue tenant");
    expect(renderToStaticMarkup(buildRentalSurface("leases"))).toContain("Record lease and rent schedule");
  });
  it("requires persisted unit and tenant selections instead of manual ids", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("leases"));
    expect(markup).toContain("Select a saved unit");
    expect(markup).toContain("Select a saved tenant");
    expect(markup).not.toContain("Tenant ID");
  });
  it("renders the explicit lease activation and first-charge workflow", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("charges"));
    expect(markup).toContain("Activate lease and create first charge");
    expect(markup).toContain("Activation starts billing");
  });
  it("renders the maintenance request operations surface", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("maintenance"));
    expect(markup).toContain("Requests and work orders");
    expect(markup).toContain("No maintenance requests have been submitted");
  });
  it("renders the secure rental document library", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("documents"));
    expect(markup).toContain("Lease documents and notices");
    expect(markup).toContain("Publish this document to the tenant portal");
  });
  it("renders the auditable notification outbox",()=>{const markup=renderToStaticMarkup(buildRentalSurface("communications"));expect(markup).toContain("Notification outbox");expect(markup).toContain("Real email sending remains disabled");});
  it("renders payment reconciliation boundaries",()=>{const markup=renderToStaticMarkup(buildRentalSurface("reconciliation"));expect(markup).toContain("Payment reconciliation");expect(markup).toContain("gross rental income posting is implemented");});
  it("renders rent roll and tenant ledger reporting",()=>{const markup=renderToStaticMarkup(buildRentalSurface("reports"));expect(markup).toContain("Rent roll and tenant ledger");expect(markup).toContain("Loading report");});
  it("renders a separate security-deposit liability ledger",()=>{const markup=renderToStaticMarkup(buildRentalSurface("deposits"));expect(markup).toContain("Security deposits");expect(markup).toContain("never treated as rent or NOI");});
  it("renders controlled move-in and move-out inspections",()=>{const markup=renderToStaticMarkup(buildRentalSurface("inspections"));expect(markup).toContain("Move-in, move-out, and periodic inspections");expect(markup).toContain("never creates a deduction");});
  it("renders auditable lease changes and owner-controlled late fees",()=>{const markup=renderToStaticMarkup(buildRentalSurface("lease-lifecycle"));expect(markup).toContain("Renewals, amendments, and prorating");expect(markup).toContain("Owner-controlled late fees");});
  it("renders editable lease preparation without claiming a licensed form",()=>{const markup=renderToStaticMarkup(buildRentalSurface("lease-preparation"));expect(markup).toContain("Editable terms and version history");expect(markup).toContain("not the Texas REALTORS® form");expect(markup).toContain("Save immutable draft version");});
  it("shows owner autopay authorization without claiming consent activates a debit",()=>{const markup=renderToStaticMarkup(buildRentalSurface("autopay"));expect(markup).toContain("Tenant authorizations");expect(markup).toContain("Consent alone never activates a debit");});
});
