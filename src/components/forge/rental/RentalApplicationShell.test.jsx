// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache, fetchWithDedupe, seedCacheEntry } from "../../../hooks/swrCache";
import RentalApplicationShell, { applyTerminologyToNavigation, buildRentalSurface, HIDEABLE_SIDEBAR_SECTIONS, RENTAL_FUNCTIONS, RENTAL_NAVIGATION, resolveRentalSectionParam } from "./RentalApplicationShell.jsx";
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
  "rental:autopay": { autopayEnrollments: [] },
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
afterEach(() => { clearSWRCache(); vi.unstubAllGlobals(); });

const EXPECTED_FUNCTION_IDS = [
  "overview",
  "setup", "insurance", "maintenance", "inspections", "documents",
  "tenants", "leases", "lease-lifecycle", "lease-preparation", "readiness", "renewal", "communications", "mailing", "messages", "animals",
  "listings", "applications",
  "charges", "deposits", "checks-deposits", "reconciliation", "bank-ledger", "vendors", "receipts", "chart-of-accounts", "batch-entry",
  "owners",
  "reports", "owner-statements", "tax-1099",
  "tax-strategies", "finding-the-money",
  "financial-setup", "autopay", "support", "rentec-migration", "rentec-files", "rentec-payment-import", "rentec-financial-history-import", "terminology", "team", "setup-guide",
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

// Slice 1: surfaces are demand-loaded, so a synchronous markup render only
// sees the section skeleton. Mount, wait for the chunk to resolve (the
// skeleton marker disappears), then read. For statically rendered content
// there is never a skeleton, so this returns immediately.
async function renderSurfaceMarkup(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  for (let attempt = 0; attempt < 500 && container.innerHTML.includes("data-rental-surface-loading"); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  const html = container.innerHTML;
  act(() => { root.unmount(); });
  container.remove();
  return html;
}

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

describe("RentalApplicationShell ten-section Rentec-style registry", () => {
  it("exposes exactly the ten sections, in order (Learn added 2026-10-10 for the education package)", () => {
    expect(RENTAL_NAVIGATION.map(({ label }) => label)).toEqual([
      "Summary", "Properties", "Tenants", "Leasing", "Banking", "Owners", "Reports", "Tax", "Learn", "Settings",
    ]);
  });

  it("homes the two education pages under Learn with stable function ids", () => {
    const learn = RENTAL_NAVIGATION.find((group) => group.label === "Learn");
    expect(learn.items).toEqual([
      { id: "tax-strategies", label: "Tax Strategies" },
      { id: "finding-the-money", label: "Finding the Money" },
    ]);
    expect(buildRentalSurface("tax-strategies")).toBeTruthy();
    expect(buildRentalSurface("finding-the-money")).toBeTruthy();
    expect(resolveRentalSectionParam("learn")).toBe("tax-strategies");
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
    expect(banking.items.map(({ id }) => id)).toEqual(["charges", "deposits", "checks-deposits", "reconciliation", "bank-ledger", "vendors", "receipts", "chart-of-accounts", "batch-entry"]);
    expect(banking.items.find(({ id }) => id === "charges").label).toBe("Rent & Payments");
  });

  it("gives Owners its own section home as the R9 mount point", async () => {
    const owners = RENTAL_NAVIGATION.find((group) => group.label === "Owners");
    expect(owners.items.map(({ id }) => id)).toEqual(["owners"]);
    // Slice 1: Owners is demand-loaded, so the first paint is the section
    // skeleton; the real panel arrives once its chunk resolves.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(buildRentalSurface("owners")); });
    expect(container.innerHTML).toContain("data-rental-surface-loading");
    for (let attempt = 0; attempt < 20 && !container.innerHTML.includes("data-rental-owners-home"); attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    expect(container.innerHTML).toContain("data-rental-owners-home");
    expect(container.innerHTML).toContain("data-owner-statements-mount");
    expect(container.innerHTML).toContain("Owner statements");
    act(() => { root.unmount(); });
    container.remove();
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
      "Properties", "Tenants", "Leasing", "Banking", "Owners", "Reports", "Tax", "Learn", "Settings",
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
  it("honors ?section=properties by landing on the Properties section's first destination", async () => {
    const markup = await renderSurfaceMarkup(<RentalPageClient initialSection="properties" />);
    expect(markup).toContain('data-active-function="setup"');
  });

  it("falls back to the dashboard overview for a retired id", async () => {
    const markup = await renderSurfaceMarkup(<RentalPageClient initialSection="guide" />);
    expect(markup).toContain('data-active-function="overview"');
  });

  it("defaults to the dashboard overview with no section", async () => {
    const markup = await renderSurfaceMarkup(<RentalPageClient />);
    expect(markup).toContain('data-active-function="overview"');
  });
});

describe("Slice 1 guard: next-frame navigation feedback (brief section 4 condition 3)", () => {
  it("a section click paints the new selection synchronously, before the chunk arrives", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<RentalPageClient />); });
    await flush();
    // Leases lives in a collapsed group -- expand every group toggle first.
    let toggles;
    do {
      toggles = Array.from(container.querySelectorAll('nav[aria-label="Rental Manager functions"] button[aria-expanded="false"]'));
      toggles.forEach((toggle) => act(() => { toggle.click(); }));
    } while (toggles.length > 0);
    const leasesButton = Array.from(container.querySelectorAll('nav[aria-label="Rental Manager functions"] button'))
      .filter((button) => !button.hasAttribute("aria-expanded"))
      .find((button) => button.textContent.includes("Leases"));
    expect(leasesButton).not.toBeUndefined();
    // The click itself: navigate() sets state synchronously, so the selected
    // paint must be in the DOM the moment the click's act() returns -- no
    // await, no frame wait. A regression that defers the state update (or
    // fetches before painting) fails here. The pending paint is the skeleton
    // on a cold chunk, or the panel itself when the chunk is already warm in
    // this test run -- either way the overview is gone synchronously.
    act(() => { leasesButton.click(); });
    expect(leasesButton.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector('[data-active-function="leases"]')).not.toBeNull();
    expect(
      container.querySelector("[data-rental-surface-loading]") !== null
        || container.querySelector('main')?.textContent.includes("Leases"),
    ).toBe(true);
    act(() => { root.unmount(); });
    container.remove();
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

  it("pushes a history entry on navigation so the Back button restores the previous surface", async () => {
    mounted = mount(<RentalPageClient />);
    expect(mounted.container.querySelector('[data-active-function-surface="overview"]')).not.toBeNull();
    const nav = 'nav[aria-label="Rental Manager functions"]';
    // Nav groups start collapsed (persisted per browser): expand the Tenants group if needed, then click the item.
    const groupToggle = [...mounted.container.querySelectorAll(`${nav} button[aria-expanded]`)].find((button) => button.textContent.includes("Tenants"));
    if (groupToggle.getAttribute("aria-expanded") !== "true") {
      await act(async () => { groupToggle.click(); });
    }
    const tenantsButton = [...mounted.container.querySelectorAll(`${nav} button:not([aria-expanded])`)]
      .find((button) => button.textContent.trim() === "Tenants");
    expect(tenantsButton).not.toBeUndefined();
    await act(async () => { tenantsButton.click(); });
    expect(window.location.search).toContain("section=tenants");
    expect(mounted.container.querySelector('[data-active-function-surface="tenants"]')).not.toBeNull();
    // Browser Back: the popstate handler re-derives the section from the URL.
    // (The traversal itself is the browser's job; the handler is ours.)
    await act(async () => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(mounted.container.querySelector('[data-active-function-surface="overview"]')).not.toBeNull();
  });
});

describe("RentalApplicationShell retired-id fallback", () => {
  it("resolves a stored retired id to overview instead of crashing", async () => {
    for (const retired of ["guide", "private-financing", "reservable-inventory"]) {
      const markup = await renderSurfaceMarkup(<RentalApplicationShell activeFunctionId={retired} onFunctionChange={() => {}} />);
      expect(markup).toContain('data-active-function="overview"');
    }
  });
});

describe("RentalApplicationShell", () => {
  it("renders an exception-first summary in grouped navigation", async () => {
    const markup = await renderSurfaceMarkup(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    expect(markup).toContain("Rental operations");
    expect(markup).toContain("Loading rental summary");
    expect(markup).toContain('aria-label="Rental Manager functions"');
    expect(RENTAL_NAVIGATION.map(({ label }) => label)).toEqual(["Summary", "Properties", "Tenants", "Leasing", "Banking", "Owners", "Reports", "Tax", "Learn", "Settings"]);
  });
  it("renders the first-tenant readiness surface as its own reachable function", async () => {
    const markup = await renderSurfaceMarkup(buildRentalSurface("readiness"));
    expect(markup).toContain("Prepare a tenant for move-in");
  });
  it("renders the lease-renewal surface as its own reachable function", async () => {
    const markup = await renderSurfaceMarkup(buildRentalSurface("renewal"));
    expect(markup).toContain("Renew an expiring lease");
  });
  it("renders today's priorities as the retired guide surface, now absorbed into the dashboard", async () => {
    // Client render with no seeded data: the retired guide id renders
    // RentalTodaysPrioritiesPanel, whose loading copy is distinct from the other surfaces.
    // (innerHTML does not escape apostrophes the way renderToStaticMarkup did.)
    const markup = await renderSurfaceMarkup(buildRentalSurface("guide"));
    expect(markup).toContain("today's priorities");
  });
  it("renders a preview-only Rentec migration surface",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("rentec-migration"));expect(markup).toContain("Import from Rentec Direct");expect(markup).toContain("cannot write Rentec or FORGE records");});
  it("renders a metadata-only Rentec file inventory",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("rentec-files"));expect(markup).toContain("Rentec files and renter photos");expect(markup).toContain("Inspect Rentec files");expect(markup).toContain("file names and contents are not returned");});
  it("preserves selected-record context while navigating between rental surfaces",async () =>{const markup=await renderSurfaceMarkup(<RentalApplicationShell activeFunctionId="charges" activeRecordContext={{recordType:"tenant",recordId:"tenant_1",recordLabel:"Test Tenant"}} onFunctionChange={()=>{}}/>);expect(markup).toContain('data-record-context="tenant_1"');expect(markup).toContain("Working with tenant: Test Tenant");expect(markup).toContain("Back to tenants")});
  it("requires persisted unit and tenant selections instead of manual ids", async () => {
    const markup = await renderSurfaceMarkup(buildRentalSurface("leases"));
    expect(markup).toContain("Select a saved unit");
    expect(markup).toContain("Select a saved tenant");
    expect(markup).not.toContain("Tenant ID");
  });
  it("routes tenant-scoped lease navigation directly to RentalLeasePanel instead of the tenant-filtered contextual surface, so the full unit list stays available", async () => {
    const recordContext = { recordType: "tenant", recordId: "tenant_brandy", recordLabel: "Brandy Morgan" };
    const element = buildRentalSurface("leases", { recordContext });
    expect(element.props.recordContext).toEqual(recordContext);
    // Slice 1: the surface is demand-loaded, so identity is proven by rendering
    // the lease panel (full unit picker) rather than by the component reference.
    const markup = await renderSurfaceMarkup(element);
    expect(markup).toContain("Select a saved unit");
  });
  it("keeps lease activation and first-charge controls in secondary billing setup", async () => {
    const markup = await renderSurfaceMarkup(buildRentalSurface("charges"));
    expect(markup).toContain("Rent &amp; payments");
    expect(markup).toContain("Billing setup");
    expect(markup).not.toContain("Activate lease and schedule");
  });
  it("renders the maintenance request operations surface", async () => {
    const markup = await renderSurfaceMarkup(buildRentalSurface("maintenance"));
    expect(markup).toContain("Requests and work orders");
    expect(markup).toContain("No maintenance requests have been submitted");
  });
  it("renders the secure rental document library", async () => {
    const markup = await renderSurfaceMarkup(buildRentalSurface("documents"));
    expect(markup).toContain("Lease documents and notices");
    expect(markup).toContain("Upload document");
    expect(markup).not.toContain("Publish this document to the tenant portal");
  });
  it("renders the auditable notification outbox with reminder setup hidden",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("communications"));expect(markup).toContain("Notification outbox");expect(markup).toContain("Email delivery is not active");expect(markup).toContain("Queue reminder");expect(markup).not.toContain("Maximum attempts");});
  it("renders the combined owner inbox without filtering to rental-only messaging",async () =>{
    // Slice 1: the surface mounts for real, so pin the panel's fetch pending and
    // assert its loading state -- that proves the messages id routes to the
    // inbox panel rather than a rental-only surface.
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const markup=await renderSurfaceMarkup(buildRentalSurface("messages"));expect(markup).toContain("Loading messages");
  });
  it("renders payment reconciliation boundaries",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("reconciliation"));expect(markup).toContain("Payment reconciliation");expect(markup).toContain("gross rental income posting is implemented");});
  it("renders the Rentec payment import surface as preview-only",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("rentec-payment-import"));expect(markup).toContain("Import Rentec payments");expect(markup).toContain("Preview only");});
  it("renders the Rentec financial history import surface as preview-only",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("rentec-financial-history-import"));expect(markup).toContain("Import Rentec financial history");expect(markup).toContain("Preview only");});
  it("renders rent roll and tenant ledger reporting",async () =>{vi.stubGlobal("fetch", () => new Promise(() => {}));const markup=await renderSurfaceMarkup(buildRentalSurface("reports"));expect(markup).toContain("Rent roll and tenant ledger");expect(markup).toContain("Loading report");});
  it("renders a separate security-deposit liability ledger",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("deposits"));expect(markup).toContain("Security deposits");expect(markup).toContain("never treated as rent or NOI");});
  it("renders the checks and deposits banking tools",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("checks-deposits"));expect(markup).toContain("Print recorded check payments");expect(markup).toContain("Print checks");expect(markup).toContain("Bank deposits");});
  it("renders controlled move-in and move-out inspections",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("inspections"));expect(markup).toContain("Move-in, move-out, and periodic inspections");expect(markup).toContain("never creates a deduction");});
  it("renders auditable lease changes and owner-controlled late fees",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("lease-lifecycle"));expect(markup).toContain("Renewals, amendments, and prorating");expect(markup).toContain("Owner-controlled late fees");});
  it("renders editable lease preparation without claiming a licensed form",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("lease-preparation"));expect(markup).toContain("Editable terms and version history");expect(markup).toContain("not the Texas REALTORS® form");expect(markup).toContain("Save immutable draft version");});
  it("shows owner autopay authorization without claiming consent activates a debit",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("autopay"));expect(markup).toContain("Tenant authorizations");expect(markup).toContain("Consent alone never activates a debit");});
  it("separates pet fees from assistance-animal review",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("animals"));expect(markup).toContain("Pet approvals and assistance review");expect(markup).toContain("can never receive a pet fee");});
  it("renders support cases without automatic money movement",async () =>{const markup=await renderSurfaceMarkup(buildRentalSurface("support"));expect(markup).toContain("Support and incident cases");expect(markup).toContain("without automatically moving money");});
  it("renders the property financial setup surface scoped to the selected property's exact property_id", async () => {
    // Slice 1: the surface mounts for real, so pin the panel's fetch pending --
    // the loading state is the proof, and the panel's own tests cover the
    // post-fetch "Financial setup — {propertyId}" render.
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const recordContext = { recordType: "unit", recordId: "unit_1", propertyId: "930 Highland Drive" };
    const markup = await renderSurfaceMarkup(buildRentalSurface("financial-setup", { recordContext }));
    expect(markup).toContain("Loading financial setup");
    expect(await renderSurfaceMarkup(buildRentalSurface("financial-setup"))).toContain("Select a property before opening financial setup");
  });
  it("keeps financial-setup a recognized function id, not just a surface -- resolveActiveFunction falls back to overview for anything outside RENTAL_FUNCTIONS", async () => {
    // Regression: adding the surface to buildRentalSurface alone was not enough. The Property
    // actions menu calls onNavigate("financial-setup", context), which sets activeFunctionId --
    // but RentalApplicationShell resolves that id through resolveActiveFunction(RENTAL_FUNCTIONS,
    // ...) before ever calling buildRentalSurface, and silently falls back to a default function
    // id for anything not in RENTAL_FUNCTIONS. Confirmed live: clicking "Financial setup" rendered
    // the Overview dashboard instead, because the id wasn't registered in RENTAL_NAVIGATION.
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toContain("financial-setup");
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const markup = await renderSurfaceMarkup(<RentalApplicationShell activeFunctionId="financial-setup" activeRecordContext={{ recordType: "unit", recordId: "unit_1", propertyId: "930 Highland Drive" }} onFunctionChange={() => {}} />);
    expect(markup).toContain('data-active-function="financial-setup"');
    expect(markup).toContain("Loading financial setup");
  });
  it("renders the Terminology settings surface under Settings", async () => {
    const markup = await renderSurfaceMarkup(buildRentalSurface("terminology"));
    expect(markup).toContain("data-rental-terminology-panel");
    expect(markup).toContain("Live preview");
    expect(markup).toContain("Save terminology");
  });

  it("keeps terminology a recognized function id so Settings → Terminology navigates instead of falling back to overview", async () => {
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toContain("terminology");
    const markup = await renderSurfaceMarkup(<RentalApplicationShell activeFunctionId="terminology" onFunctionChange={() => {}} />);
    expect(markup).toContain('data-active-function="terminology"');
  });
});

describe("R25 terminology — applyTerminologyToNavigation", () => {
  const CUSTOM_TERMS = {
    tenant: { singular: "resident", plural: "residents" },
    property: { singular: "unit", plural: "units" },
    lease: { singular: "rental agreement", plural: "rental agreements" },
    owner: { singular: "landlord", plural: "landlords" },
    vendor: { singular: "contractor", plural: "contractors" },
  };

  it("renames term-aware group and item labels while keeping ids byte-identical", () => {
    const localized = applyTerminologyToNavigation(RENTAL_NAVIGATION, CUSTOM_TERMS);
    const tenants = localized.find((group) => group.defaultLabel === "Tenants");
    expect(tenants.label).toBe("Residents");
    expect(tenants.items.find((item) => item.id === "tenants").label).toBe("Residents");
    expect(tenants.items.find((item) => item.id === "leases").label).toBe("Rental agreements");
    expect(tenants.items.find((item) => item.id === "lease-lifecycle").label).toBe("Rental agreement Changes");
    expect(tenants.items.find((item) => item.id === "renewal").label).toBe("Renew a rental agreement");
    expect(tenants.items.find((item) => item.id === "readiness").label).toBe("Prepare a resident");
    expect(tenants.items.find((item) => item.id === "messages").label).toBe("Landlord Inbox");
    const properties = localized.find((group) => group.defaultLabel === "Properties");
    expect(properties.label).toBe("Units");
    expect(properties.items.find((item) => item.id === "setup").label).toBe("Units");
    const transactions = localized.find((group) => group.defaultLabel === "Banking");
    expect(transactions.items.find((item) => item.id === "vendors").label).toBe("Contractors");
    // Non-term labels are untouched.
    expect(transactions.items.find((item) => item.id === "charges").label).toBe("Rent & Payments");
    expect(localized.find((group) => group.defaultLabel === "Summary").label).toBe("Summary");
    // The static registry is unchanged — ids and default labels are the stable contract.
    expect(RENTAL_NAVIGATION.find((group) => group.label === "Tenants").items.find((item) => item.id === "tenants").label).toBe("Tenants");
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toEqual(EXPECTED_FUNCTION_IDS);
  });

  it("falls back to the baseline labels when the term map is unset", () => {
    const localized = applyTerminologyToNavigation(RENTAL_NAVIGATION, null);
    expect(localized.map(({ label }) => label)).toEqual(RENTAL_NAVIGATION.map(({ label }) => label));
  });
});

describe("R25 terminology — shell nav reflects custom terms", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      act(() => { mounted.root.unmount(); });
      mounted.container.remove();
      mounted = null;
    }
    vi.restoreAllMocks();
  });

  it("renders custom nav labels and still navigates by stable item ids", async () => {
    vi.spyOn(window, "fetch").mockImplementation((url) => {
      if (String(url) === "/api/rental/terminology") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            terms: { tenant: { singular: "resident", plural: "residents" }, property: { singular: "unit", plural: "units" } },
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });
    const visited = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={(id) => visited.push(id)} />); });
    mounted = { container, root };
    await flush();
    // Expand every collapsible group, then read the nav labels.
    let collapsedToggles;
    do {
      collapsedToggles = Array.from(container.querySelectorAll('nav[aria-label="Rental Manager functions"] button[aria-expanded="false"]'));
      collapsedToggles.forEach((toggle) => act(() => { toggle.click(); }));
    } while (collapsedToggles.length > 0);
    const nav = container.querySelector('nav[aria-label="Rental Manager functions"]');
    expect(nav.textContent).toContain("Residents");
    expect(nav.textContent).toContain("Units");
    expect(nav.textContent).not.toContain("Tenants");
    // Ids are untouched: clicking the renamed item still navigates by "tenants".
    const residentsButton = Array.from(nav.querySelectorAll("button")).find((button) => button.textContent === "Residents");
    act(() => { residentsButton.click(); });
    expect(visited).toEqual(["tenants"]);
  });
});

describe("RentalApplicationShell help control", () => {
  it("renders a contextual Help control without opening the guide initially", async () => {
    const markup = await renderSurfaceMarkup(<RentalApplicationShell activeFunctionId="maintenance" onFunctionChange={() => {}} />);
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
      ...buildSetupWizardStatus({ units: [], tenants: [], bankAccountCount: 0, settingsConfigured: false, members: [] }),
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

  it("maps the setup-guide destination to the re-runnable wizard panel", async () => {
    const element = buildRentalSurface("setup-guide", { onNavigate: () => {} });
    expect(element.props.mode).toBe("guide");
    // Slice 1: the surface is demand-loaded, so identity is proven by rendering
    // the wizard in guide mode rather than by the component reference.
    const markup = await renderSurfaceMarkup(element);
    expect(markup).toContain("Back to Summary");
  });
});
