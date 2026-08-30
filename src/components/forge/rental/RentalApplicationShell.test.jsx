// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalApplicationShell, { buildRentalSurface, RENTAL_FUNCTIONS, RENTAL_NAVIGATION } from "./RentalApplicationShell.jsx";
import RentalLeasePanel from "./RentalLeasePanel.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

describe("RentalApplicationShell navigation reachability (quieted nav rail)", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  it("keeps every existing destination reachable through the desktop nav rail even though non-active groups start collapsed", () => {
    const visited = [];
    mounted = mount(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={(id) => visited.push(id)} />);
    // Expand every collapsible group header first — the quieted nav collapses non-active groups
    // by default, but every destination must still be one click away.
    const groupToggles = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] > div > button'));
    groupToggles.forEach((toggle) => {
      if (toggle.getAttribute("aria-expanded") === "false") act(() => { toggle.click(); });
    });
    const itemButtons = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button[aria-current], nav[aria-label="Rental Manager functions"] div > div > button'))
      .filter((button) => !button.hasAttribute("aria-expanded"));
    itemButtons.forEach((button) => act(() => { button.click(); }));
    expect(new Set(visited)).toEqual(new Set(RENTAL_FUNCTIONS.map(({ id }) => id)));
  });

  it("also exposes every destination through the mobile select fallback", () => {
    mounted = mount(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    const options = Array.from(mounted.container.querySelectorAll("select option")).map((option) => option.value);
    expect(new Set(options)).toEqual(new Set(RENTAL_FUNCTIONS.map(({ id }) => id)));
  });
});

describe("RentalApplicationShell", () => {
  it("offers the complete first-tenant operating functions", () => {
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toEqual(["overview", "guide", "readiness", "renewal", "setup", "tenants", "leases", "rentec-migration", "rentec-files", "charges", "reconciliation", "rentec-payment-import", "rentec-financial-history-import", "financial-setup", "deposits", "reports", "private-financing", "maintenance", "inspections", "insurance", "documents", "communications", "lease-lifecycle", "lease-preparation", "autopay", "animals", "support"]);
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
  it("renders the first-tenant readiness surface as its own reachable function", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("readiness"));
    expect(markup).toContain("Prepare a tenant for move-in");
  });
  it("renders the private-financing surface as its own reachable function under Money", () => {
    const moneyGroup = RENTAL_NAVIGATION.find((group) => group.label === "Money");
    expect(moneyGroup.items.map(({ id }) => id)).toContain("private-financing");
    const markup = renderToStaticMarkup(buildRentalSurface("private-financing"));
    expect(markup).toContain("Private Financing");
  });
  it("renders the lease-renewal surface as its own reachable function", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("renewal"));
    expect(markup).toContain("Renew an expiring lease");
  });
  it("renders a preview-only Rentec migration surface",()=>{const markup=renderToStaticMarkup(buildRentalSurface("rentec-migration"));expect(markup).toContain("Import from Rentec Direct");expect(markup).toContain("cannot write Rentec or FORGE records");});
  it("renders a metadata-only Rentec file inventory",()=>{const markup=renderToStaticMarkup(buildRentalSurface("rentec-files"));expect(markup).toContain("Rentec files and renter photos");expect(markup).toContain("Inspect Rentec files");expect(markup).toContain("file names and contents are not returned");});
  it("preserves selected-record context while navigating between rental surfaces",()=>{const markup=renderToStaticMarkup(<RentalApplicationShell activeFunctionId="charges" activeRecordContext={{recordType:"tenant",recordId:"tenant_1",recordLabel:"Test Tenant"}} onFunctionChange={()=>{}}/>);expect(markup).toContain('data-record-context="tenant_1"');expect(markup).toContain("Working with tenant: Test Tenant");expect(markup).toContain("Back to record")});
  it("requires persisted unit and tenant selections instead of manual ids", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("leases"));
    expect(markup).toContain("Select a saved unit");
    expect(markup).toContain("Select a saved tenant");
    expect(markup).not.toContain("Tenant ID");
  });
  it("routes tenant-scoped lease navigation directly to RentalLeasePanel instead of the tenant-filtered contextual surface, so the full unit list stays available", () => {
    const recordContext = { recordType: "tenant", recordId: "tenant_brandy", recordLabel: "Brandy Morgan" };
    const element = buildRentalSurface("leases", { recordContext });
    expect(element.type).toBe(RentalLeasePanel);
    expect(element.props.recordContext).toEqual(recordContext);
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
  it("renders the Rentec payment import surface as preview-only",()=>{const markup=renderToStaticMarkup(buildRentalSurface("rentec-payment-import"));expect(markup).toContain("Import Rentec payments");expect(markup).toContain("Preview only");});
  it("renders the Rentec financial history import surface as preview-only",()=>{const markup=renderToStaticMarkup(buildRentalSurface("rentec-financial-history-import"));expect(markup).toContain("Import Rentec financial history");expect(markup).toContain("Preview only");});
  it("renders rent roll and tenant ledger reporting",()=>{const markup=renderToStaticMarkup(buildRentalSurface("reports"));expect(markup).toContain("Rent roll and tenant ledger");expect(markup).toContain("Loading report");});
  it("renders a separate security-deposit liability ledger",()=>{const markup=renderToStaticMarkup(buildRentalSurface("deposits"));expect(markup).toContain("Security deposits");expect(markup).toContain("never treated as rent or NOI");});
  it("renders controlled move-in and move-out inspections",()=>{const markup=renderToStaticMarkup(buildRentalSurface("inspections"));expect(markup).toContain("Move-in, move-out, and periodic inspections");expect(markup).toContain("never creates a deduction");});
  it("renders auditable lease changes and owner-controlled late fees",()=>{const markup=renderToStaticMarkup(buildRentalSurface("lease-lifecycle"));expect(markup).toContain("Renewals, amendments, and prorating");expect(markup).toContain("Owner-controlled late fees");});
  it("renders editable lease preparation without claiming a licensed form",()=>{const markup=renderToStaticMarkup(buildRentalSurface("lease-preparation"));expect(markup).toContain("Editable terms and version history");expect(markup).toContain("not the Texas REALTORS® form");expect(markup).toContain("Save immutable draft version");});
  it("shows owner autopay authorization without claiming consent activates a debit",()=>{const markup=renderToStaticMarkup(buildRentalSurface("autopay"));expect(markup).toContain("Tenant authorizations");expect(markup).toContain("Consent alone never activates a debit");});
  it("separates pet fees from assistance-animal review",()=>{const markup=renderToStaticMarkup(buildRentalSurface("animals"));expect(markup).toContain("Pet approvals and assistance review");expect(markup).toContain("can never receive a pet fee");});
  it("renders support cases without automatic money movement",()=>{const markup=renderToStaticMarkup(buildRentalSurface("support"));expect(markup).toContain("Support and incident cases");expect(markup).toContain("without automatically moving money");});
  it("renders the property financial setup surface scoped to the selected property's exact property_id", () => {
    // renderToStaticMarkup captures only the pre-effect state, so this is the loading state --
    // the panel's own tests cover the post-fetch "Financial setup — {propertyId}" render.
    const recordContext = { recordType: "unit", recordId: "unit_1", propertyId: "930 Highland Drive" };
    const markup = renderToStaticMarkup(buildRentalSurface("financial-setup", { recordContext }));
    expect(markup).toContain("Loading financial setup");
    expect(renderToStaticMarkup(buildRentalSurface("financial-setup"))).toContain("Select a property before opening financial setup");
  });
  it("keeps financial-setup a recognized function id, not just a surface -- resolveActiveFunction falls back to overview for anything outside RENTAL_FUNCTIONS", () => {
    // Regression: adding the surface to buildRentalSurface alone was not enough. The Property
    // actions menu calls onNavigate("financial-setup", context), which sets activeFunctionId --
    // but RentalApplicationShell resolves that id through resolveActiveFunction(RENTAL_FUNCTIONS,
    // ...) before ever calling buildRentalSurface, and silently falls back to a default function
    // id for anything not in RENTAL_FUNCTIONS. Confirmed live: clicking "Financial setup" rendered
    // the Overview dashboard instead, because the id wasn't registered in RENTAL_NAVIGATION.
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toContain("financial-setup");
    const markup = renderToStaticMarkup(<RentalApplicationShell activeFunctionId="financial-setup" activeRecordContext={{ recordType: "unit", recordId: "unit_1", propertyId: "930 Highland Drive" }} onFunctionChange={() => {}} />);
    expect(markup).toContain('data-active-function="financial-setup"');
    expect(markup).toContain("Loading financial setup");
  });
  it("renders a contextual Help control without opening the guide initially", () => {
    const markup = renderToStaticMarkup(<RentalApplicationShell activeFunctionId="maintenance" onFunctionChange={() => {}} />);
    expect(markup).toContain('title="Rental Manager workflows and button guide"');
    expect(markup).not.toContain("data-rental-help");
  });

  it("opens help for the active section and closes it without changing the selected Rental Manager function", () => {
    const visited = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(<RentalApplicationShell activeFunctionId="charges" onFunctionChange={(id) => visited.push(id)} />));
      const helpButton = container.querySelector('button[title="Rental Manager workflows and button guide"]');
      expect(helpButton).not.toBeNull();
      act(() => helpButton.click());
      const help = container.querySelector("[data-rental-help]");
      expect(help).not.toBeNull();
      expect(help.textContent).toContain("Rent & Payments");
      const closeButton = Array.from(help.querySelectorAll("button")).find((button) => button.textContent === "Close");
      act(() => closeButton.click());
      expect(container.querySelector("[data-rental-help]")).toBeNull();
      expect(visited).toEqual([]);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

});
