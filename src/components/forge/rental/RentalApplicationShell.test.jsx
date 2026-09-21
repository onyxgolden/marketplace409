// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalApplicationShell, { buildRentalSurface, HIDEABLE_SIDEBAR_SECTIONS, RENTAL_FUNCTIONS, RENTAL_NAVIGATION, resolveRentalSectionParam } from "./RentalApplicationShell.jsx";
import RentalPageClient from "./RentalPageClient.jsx";
import RentalLeasePanel from "./RentalLeasePanel.jsx";

const EXPECTED_FUNCTION_IDS = [
  "overview",
  "setup", "insurance",
  "tenants", "leases", "lease-lifecycle", "lease-preparation", "readiness", "renewal", "communications", "messages", "animals",
  "charges", "deposits", "reconciliation",
  "maintenance", "inspections",
  "documents",
  "reports",
  "financial-setup", "autopay", "support", "rentec-migration", "rentec-files", "rentec-payment-import", "rentec-financial-history-import",
];

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
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("RentalApplicationShell navigation reachability (quieted nav rail)", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  it("keeps every existing destination reachable through the desktop nav rail even though non-active groups start collapsed", () => {
    const visited = [];
    mounted = mount(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={(id) => visited.push(id)} />);
    // Expand every collapsible header first — the quieted nav collapses non-active groups by
    // default, but every destination must still be reachable.
    let collapsedToggles;
    do {
      collapsedToggles = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button[aria-expanded="false"]'));
      collapsedToggles.forEach((toggle) => act(() => { toggle.click(); }));
    } while (collapsedToggles.length > 0);
    const itemButtons = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button'))
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

describe("RentalApplicationShell eight-section registry", () => {
  it("exposes exactly the eight owner-approved sections, in order", () => {
    expect(RENTAL_NAVIGATION.map(({ label }) => label)).toEqual([
      "Dashboard", "Properties", "Tenants", "Transactions", "Maintenance", "Documents", "Reports", "Settings",
    ]);
  });

  it("keeps every surviving function id byte-identical, in the new section order", () => {
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toEqual(EXPECTED_FUNCTION_IDS);
  });

  it("places animals under Tenants and the combined owner inbox under Tenants, not under a property split", () => {
    const tenants = RENTAL_NAVIGATION.find((group) => group.label === "Tenants");
    expect(tenants.items.map(({ id }) => id)).toContain("animals");
    expect(tenants.items.map(({ id }) => id)).toContain("messages");
    expect(tenants.items.find(({ id }) => id === "messages").label).toBe("Owner Inbox");
    const properties = RENTAL_NAVIGATION.find((group) => group.label === "Properties");
    expect(properties.items.map(({ id }) => id)).not.toContain("animals");
  });

  it("keeps Dashboard first so retired ids fall back to overview, and never offers Dashboard as hideable", () => {
    expect(RENTAL_FUNCTIONS[0].id).toBe("overview");
    expect(HIDEABLE_SIDEBAR_SECTIONS.map(({ sectionLabel }) => sectionLabel)).toEqual([
      "Properties", "Tenants", "Transactions", "Maintenance", "Documents", "Reports", "Settings",
    ]);
  });

  it("no longer carries RV, private-financing, or guide destinations in the rental shell", () => {
    const ids = RENTAL_FUNCTIONS.map(({ id }) => id);
    for (const retired of ["guide", "private-financing", "reservable-inventory", "reservation-dashboard", "reservations"]) {
      expect(ids).not.toContain(retired);
    }
  });
});

describe("resolveRentalSectionParam", () => {
  it("maps a section label to the section's first function id", () => {
    expect(resolveRentalSectionParam("properties")).toBe("setup");
    expect(resolveRentalSectionParam("tenants")).toBe("tenants");
    expect(resolveRentalSectionParam("dashboard")).toBe("overview");
    expect(resolveRentalSectionParam("settings")).toBe("financial-setup");
    expect(resolveRentalSectionParam("reports")).toBe("reports");
  });

  it("accepts a function id directly, case-insensitively with surrounding whitespace tolerated", () => {
    expect(resolveRentalSectionParam("maintenance")).toBe("maintenance");
    expect(resolveRentalSectionParam("  Messages ")).toBe("messages");
  });

  it("returns null for unknown, empty, or missing values so the caller falls back to overview", () => {
    expect(resolveRentalSectionParam("nope")).toBeNull();
    expect(resolveRentalSectionParam("")).toBeNull();
    expect(resolveRentalSectionParam(null)).toBeNull();
    expect(resolveRentalSectionParam(undefined)).toBeNull();
  });
});

describe("RentalPageClient section deep-linking", () => {
  it("honors ?section=properties by landing on the Properties section's first destination", () => {
    const markup = renderToStaticMarkup(<RentalPageClient initialSection="properties" />);
    expect(markup).toContain('data-active-function="setup"');
  });

  it("falls back to the dashboard overview for a retired id", () => {
    const markup = renderToStaticMarkup(<RentalPageClient initialSection="guide" />);
    expect(markup).toContain('data-active-function="overview"');
  });

  it("defaults to the dashboard overview with no section", () => {
    const markup = renderToStaticMarkup(<RentalPageClient />);
    expect(markup).toContain('data-active-function="overview"');
  });
});

describe("RentalApplicationShell retired-id fallback", () => {
  it("resolves a stored retired id to overview instead of crashing", () => {
    for (const retired of ["guide", "private-financing", "reservable-inventory"]) {
      const markup = renderToStaticMarkup(<RentalApplicationShell activeFunctionId={retired} onFunctionChange={() => {}} />);
      expect(markup).toContain('data-active-function="overview"');
    }
  });
});

describe("RentalApplicationShell", () => {
  it("renders an exception-first dashboard in grouped navigation", () => {
    const markup = renderToStaticMarkup(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    expect(markup).toContain("Rental operations");
    expect(markup).toContain("Loading rental summary");
    expect(markup).toContain('aria-label="Rental Manager functions"');
    expect(RENTAL_NAVIGATION.map(({ label }) => label)).toEqual(["Dashboard", "Properties", "Tenants", "Transactions", "Maintenance", "Documents", "Reports", "Settings"]);
  });
  it("renders the first-tenant readiness surface as its own reachable function", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("readiness"));
    expect(markup).toContain("Prepare a tenant for move-in");
  });
  it("renders the lease-renewal surface as its own reachable function", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("renewal"));
    expect(markup).toContain("Renew an expiring lease");
  });
  it("renders today's priorities as the retired guide surface, now absorbed into the dashboard", () => {
    // renderToStaticMarkup captures only the pre-effect state: the retired guide id renders
    // RentalTodaysPrioritiesPanel, whose loading copy is distinct from the other surfaces.
    const markup = renderToStaticMarkup(buildRentalSurface("guide"));
    expect(markup).toContain("today&#x27;s priorities");
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
  it("renders the combined owner inbox without filtering to rental-only messaging",()=>{
    // renderToStaticMarkup captures only the pre-effect state; the MessagesPanel loading state
    // proves the messages id routes to the inbox panel rather than a rental-only surface.
    const markup=renderToStaticMarkup(buildRentalSurface("messages"));expect(markup).toContain("Loading messages");
  });
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
