// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe, seedCacheEntry } from "../../../hooks/swrCache";
import RentalApplicationShell, { buildRentalSurface, HIDEABLE_SIDEBAR_SECTIONS, RENTAL_FUNCTIONS, RENTAL_NAVIGATION, resolveRentalSectionParam } from "./RentalApplicationShell.jsx";
import { resolveRentalRecordContextParam } from "./rentalRecordParam.js";
import { RENTAL_DASHBOARD_PAYLOAD_SWR_KEY } from "./useRentalDashboardPayload.js";
import RentalSetupWizardPanel, { SETUP_WIZARD_DISMISSAL_STORAGE_KEY } from "./RentalSetupWizardPanel.jsx";
import { buildSetupWizardStatus } from "@/application/rental/setupWizard";
import RentalPageClient from "./RentalPageClient.jsx";
import RentalLeasePanel from "./RentalLeasePanel.jsx";

// The converted rental panels render ForgeLoadingState until their SWR cache
// entry exists. Seed the shared cache with empty-but-valid payloads so the
// cold SSR renders exercise the panels' real markup (headings, copy, controls)
// instead of the loading skeletons.
const SWR_SEEDS = {
  "rental:autopay": [],
  "rental:communications": { notifications: [], charges: [] },
  "rental:email-settings": { settings: null, readiness: { resendConfigured: false, workerConfigured: false, domainConfigured: false, verifiedDomain: null } },
  "rental:deposits": { deposits: [], transactions: [], schedules: [], tenants: [] },
  "rental:inspections": { inspections: [], units: [], tenants: [], documents: [], inspectionItems: [], inspectionAcknowledgements: [] },
  "rental:lease-lifecycle": { leases: [], leaseChanges: [], lateFeeRules: [], lateFeeAssessments: [], tenants: [], units: [], properties: [] },
  "rental:lease-preparation": { leases: [], leasePreparations: [], leasePreparationVersions: [], leaseMemberships: [], leaseSignatures: [], tenants: [] },
  "rental:lease-setup": { units: [], tenants: [], leases: [], schedules: [], leaseMemberships: [] },
  "rental:maintenance": { maintenanceRequests: [], contractors: [], workOrders: [], workEvents: [] },
  "rental:payments": { openCharges: [], payments: [], settlements: [], schedules: [], billingEnabled: false },
  "rental:stripe-account": null,
  "rental:reconciliation": { payments: [], settlements: [] },
  "rental:setup": { units: [] },
  "rental:support": [],
};
async function seedSWR() {
  clearSWRCache();
  await Promise.all(Object.entries(SWR_SEEDS).map(([key, payload]) => fetchWithDedupe(key, () => Promise.resolve(payload))));
}
beforeEach(async () => { await seedSWR(); });
afterEach(() => { clearSWRCache(); });

const EXPECTED_FUNCTION_IDS = [
  "overview",
  "setup", "insurance", "maintenance", "inspections", "documents",
  "tenants", "leases", "lease-lifecycle", "lease-preparation", "readiness", "renewal", "communications", "messages", "animals",
  "charges", "deposits", "checks-deposits", "reconciliation", "bank-ledger", "vendors", "chart-of-accounts", "batch-entry",
  "owners",
  "reports", "owner-statements",
  "financial-setup", "autopay", "support", "rentec-migration", "rentec-files", "rentec-payment-import", "rentec-financial-history-import", "setup-guide",
];
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

  it("carries the selected property across sidebar navigation to financial-setup instead of landing on a dead end", () => {
    // Regression: Financial Setup showed "Select a property before opening financial
    // setup" with no way to select one, even right after selecting a property --
    // sidebar navigation dropped the record context.
    const visited = [];
    const recordContext = { recordType: "unit", recordId: "unit_1", propertyId: "930 Highland Drive" };
    mounted = mount(
      <RentalApplicationShell activeFunctionId="overview" activeRecordContext={recordContext} onFunctionChange={(id, context, filter) => visited.push([id, context, filter])} />
    );
    // Nav collapse state persists in localStorage across tests -- expand only when needed.
    const settingsToggle = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button[aria-expanded]'))
      .find((button) => button.textContent.includes("Settings"));
    if (settingsToggle.getAttribute("aria-expanded") === "false") act(() => { settingsToggle.click(); });
    const financialSetupButton = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button'))
      .find((button) => button.textContent === "Financial Setup");
    expect(financialSetupButton).not.toBeUndefined();
    act(() => { financialSetupButton.click(); });
    expect(visited).toEqual([["financial-setup", { ...recordContext, recordLabel: "930 Highland Drive" }, null]]);
  });

  it("does not carry record context to surfaces that work fine without it", () => {
    const visited = [];
    const recordContext = { recordType: "unit", recordId: "unit_1", propertyId: "930 Highland Drive" };
    mounted = mount(
      <RentalApplicationShell activeFunctionId="overview" activeRecordContext={recordContext} onFunctionChange={(id, context, filter) => visited.push([id, context, filter])} />
    );
    const reportsToggle = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button[aria-expanded]'))
      .find((button) => button.textContent.includes("Reports"));
    if (reportsToggle.getAttribute("aria-expanded") === "false") act(() => { reportsToggle.click(); });
    const reportsButton = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button'))
      .find((button) => button.textContent === "Reports");
    act(() => { reportsButton.click(); });
    expect(visited).toEqual([["reports", null, null]]);
  });
});

describe("RentalApplicationShell seven-section Rentec-style registry", () => {
  it("exposes exactly the seven Rentec-style sections, in order", () => {
    expect(RENTAL_NAVIGATION.map(({ label }) => label)).toEqual([
      "Summary", "Properties", "Tenants", "Banking", "Owners", "Reports", "Settings",
    ]);
  });

  it("keeps every surviving function id byte-identical, in the new section order", () => {
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toEqual(EXPECTED_FUNCTION_IDS);
  });

  it("labels the landing destination Summary while keeping the overview function id for old links and stored prefs", () => {
    const summary = RENTAL_NAVIGATION[0];
    expect(summary.label).toBe("Summary");
    expect(summary.items).toEqual([{ id: "overview", label: "Summary" }]);
  });

  it("homes maintenance, inspections, and documents under Properties", () => {
    const properties = RENTAL_NAVIGATION.find((group) => group.label === "Properties");
    expect(properties.items.map(({ id }) => id)).toEqual(["setup", "insurance", "maintenance", "inspections", "documents"]);
  });

  it("groups the money screens under Banking", () => {
    const banking = RENTAL_NAVIGATION.find((group) => group.label === "Banking");
    expect(banking.items.map(({ id }) => id)).toEqual(["charges", "deposits", "checks-deposits", "reconciliation", "bank-ledger", "vendors", "chart-of-accounts", "batch-entry"]);
    expect(banking.items.find(({ id }) => id === "charges").label).toBe("Rent & Payments");
  });

  it("gives Owners its own section home as the R9 mount point", () => {
    const owners = RENTAL_NAVIGATION.find((group) => group.label === "Owners");
    expect(owners.items.map(({ id }) => id)).toEqual(["owners"]);
    const markup = renderToStaticMarkup(buildRentalSurface("owners"));
    expect(markup).toContain("data-rental-owners-home");
    expect(markup).toContain("data-owner-statements-mount");
    expect(markup).toContain("Owner statements");
  });

  it("places animals under Tenants and the combined owner inbox under Tenants, not under a property split", () => {
    const tenants = RENTAL_NAVIGATION.find((group) => group.label === "Tenants");
    expect(tenants.items.map(({ id }) => id)).toContain("animals");
    expect(tenants.items.map(({ id }) => id)).toContain("messages");
    expect(tenants.items.find(({ id }) => id === "messages").label).toBe("Owner Inbox");
    const properties = RENTAL_NAVIGATION.find((group) => group.label === "Properties");
    expect(properties.items.map(({ id }) => id)).not.toContain("animals");
  });

  it("keeps Summary first so retired ids fall back to overview, and never offers Summary as hideable", () => {
    expect(RENTAL_FUNCTIONS[0].id).toBe("overview");
    expect(HIDEABLE_SIDEBAR_SECTIONS.map(({ sectionLabel }) => sectionLabel)).toEqual([
      "Properties", "Tenants", "Banking", "Owners", "Reports", "Settings",
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
    expect(resolveRentalSectionParam("banking")).toBe("charges");
    expect(resolveRentalSectionParam("owners")).toBe("owners");
    expect(resolveRentalSectionParam("summary")).toBe("overview");
    expect(resolveRentalSectionParam("settings")).toBe("financial-setup");
    expect(resolveRentalSectionParam("reports")).toBe("reports");
  });

  it("keeps retired pre-R8 group labels resolving to their Rentec-style successors", () => {
    expect(resolveRentalSectionParam("dashboard")).toBe("overview");
    expect(resolveRentalSectionParam("transactions")).toBe("charges");
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

describe("resolveRentalRecordContextParam", () => {
  it("resolves a valid property context", () => {
    expect(resolveRentalRecordContextParam({ recordType: "property", recordId: "308-paula", propertyId: "308-paula" }))
      .toEqual({ recordType: "property", recordId: "308-paula", propertyId: "308-paula" });
  });

  it("resolves tenant and unit contexts and omits propertyId when absent", () => {
    expect(resolveRentalRecordContextParam({ recordType: "tenant", recordId: "t1" }))
      .toEqual({ recordType: "tenant", recordId: "t1" });
    expect(resolveRentalRecordContextParam({ recordType: "unit", recordId: "u9", propertyId: "p2" }))
      .toEqual({ recordType: "unit", recordId: "u9", propertyId: "p2" });
  });

  it("rejects unknown types, missing ids, and overlong values", () => {
    expect(resolveRentalRecordContextParam({ recordType: "spaceship", recordId: "x" })).toBeNull();
    expect(resolveRentalRecordContextParam({ recordType: "property", recordId: "" })).toBeNull();
    expect(resolveRentalRecordContextParam({ recordType: "property", recordId: "x".repeat(201) })).toBeNull();
    expect(resolveRentalRecordContextParam({})).toBeNull();
    expect(resolveRentalRecordContextParam({ recordType: "property" })).toBeNull();
  });
});

describe("RentalPageClient record-context URL sync", () => {
  let mounted;
  beforeEach(() => {
    // The dashboard overview hydrates from the shared SWR cache -- seed it so
    // the DOM mounts below never attempt a real network fetch.
    seedCacheEntry(RENTAL_DASHBOARD_PAYLOAD_SWR_KEY, {
      rentalBody: { units: [], leases: [] },
      reports: { available: true, report: { summary: { openBalanceCents: 0, overdueBalanceCents: 0 } } },
    });
  });
  afterEach(() => {
    if (mounted) { act(() => { mounted.root.unmount(); }); mounted.container.remove(); mounted = null; }
    window.history.replaceState(null, "", "/");
  });

  it("writes section and record context to the URL so a reload restores the property page", () => {
    mounted = mount(
      <RentalPageClient
        initialSection="financial-setup"
        initialRecordContext={{ recordType: "property", recordId: "308-paula", propertyId: "308-paula" }}
      />,
    );
    const search = window.location.search;
    expect(search).toContain("section=financial-setup");
    expect(search).toContain("recordType=property");
    expect(search).toContain("recordId=308-paula");
    expect(search).toContain("propertyId=308-paula");
  });

  it("keeps the dashboard URL param-free", () => {
    mounted = mount(<RentalPageClient />);
    expect(window.location.search).toBe("");
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
  it("renders an exception-first summary in grouped navigation", () => {
    const markup = renderToStaticMarkup(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    expect(markup).toContain("Rental operations");
    expect(markup).toContain("Loading rental summary");
    expect(markup).toContain('aria-label="Rental Manager functions"');
    expect(RENTAL_NAVIGATION.map(({ label }) => label)).toEqual(["Summary", "Properties", "Tenants", "Banking", "Owners", "Reports", "Settings"]);
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
  it("renders the checks and deposits banking tools",()=>{const markup=renderToStaticMarkup(buildRentalSurface("checks-deposits"));expect(markup).toContain("Print recorded check payments");expect(markup).toContain("Print checks");expect(markup).toContain("Bank deposits");});
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

describe("RentalApplicationShell first-run setup wizard (R16)", () => {
  let mounted;
  let wizardPayload;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => wizardPayload })));
  });
  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    window.localStorage.removeItem(SETUP_WIZARD_DISMISSAL_STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  function seedWizard(unsetup) {
    wizardPayload = {
      success: true,
      ...buildSetupWizardStatus({ units: [], tenants: [], bankAccountCount: 0, settingsConfigured: false, memberCount: 1 }),
      unsetup,
    };
    seedCacheEntry("rental:setup-wizard-status", wizardPayload);
  }

  it("shows the guided tour instead of the empty dashboard on an unsetup workspace", async () => {
    seedWizard(true);
    mounted = mount(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    await flush();
    const wizard = mounted.container.querySelector('[data-setup-wizard-panel][data-setup-wizard-mode="first-run"]');
    expect(wizard).not.toBeNull();
    expect(wizard.textContent).toContain("This takes about 10 minutes and you only do it once");
    // The overview surface is replaced, not stacked.
    expect(mounted.container.querySelector("[data-setup-wizard-panel] [data-setup-wizard-step]")).not.toBeNull();
  });

  it("shows the normal dashboard when the workspace already has properties", async () => {
    seedWizard(false);
    mounted = mount(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    await flush();
    expect(mounted.container.querySelector("[data-setup-wizard-panel]")).toBeNull();
  });

  it("never traps the user: skip dismisses the tour and restores the dashboard", async () => {
    seedWizard(true);
    mounted = mount(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    await flush();
    const skip = mounted.container.querySelector("[data-setup-wizard-skip]");
    expect(skip).not.toBeNull();
    act(() => { skip.click(); });
    await flush();
    expect(window.localStorage.getItem(SETUP_WIZARD_DISMISSAL_STORAGE_KEY)).toBe("1");
    expect(mounted.container.querySelector("[data-setup-wizard-panel]")).toBeNull();
  });

  it("stays dismissed on reload: a dismissed tour never hijacks the landing again", async () => {
    window.localStorage.setItem(SETUP_WIZARD_DISMISSAL_STORAGE_KEY, "1");
    seedWizard(true);
    mounted = mount(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    await flush();
    expect(mounted.container.querySelector("[data-setup-wizard-panel]")).toBeNull();
  });

  it("does not hijack deep links: the tour only replaces the landing view", async () => {
    seedWizard(true);
    mounted = mount(<RentalApplicationShell activeFunctionId="tenants" onFunctionChange={() => {}} />);
    await flush();
    expect(mounted.container.querySelector("[data-setup-wizard-panel]")).toBeNull();
  });

  it("offers the Setup guide under Settings as the re-run entry", async () => {
    const visited = [];
    mounted = mount(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={(id) => visited.push(id)} />);
    await flush();
    const settingsToggle = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button[aria-expanded]'))
      .find((button) => button.textContent.includes("Settings"));
    if (settingsToggle.getAttribute("aria-expanded") === "false") act(() => { settingsToggle.click(); });
    const guideButton = Array.from(mounted.container.querySelectorAll('nav[aria-label="Rental Manager functions"] button'))
      .find((button) => button.textContent === "Setup guide");
    expect(guideButton).not.toBeUndefined();
    act(() => { guideButton.click(); });
    expect(visited).toEqual(["setup-guide"]);
  });

  it("maps the setup-guide destination to the re-runnable wizard panel", () => {
    const element = buildRentalSurface("setup-guide", { onNavigate: () => {} });
    expect(element.type).toBe(RentalSetupWizardPanel);
    expect(element.props.mode).toBe("guide");
  });
});
