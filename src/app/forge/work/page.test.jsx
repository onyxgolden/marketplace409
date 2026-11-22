import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// D5: /forge/work list filters. The page keeps the same owner-scoped read
// (listWorkPackages with ownerId + an explicit project scope) and filters
// the loaded array in memory from allowlisted ?status / ?propertyId params.
// These tests mock the auth boundary and the service reads, then render the
// server component's markup directly — the same pattern as the health page
// test.
//
// PR B: the list is project-scoped — renders default to
// ?forgeProject=unassigned (the inbox), so the grid renders; a render
// with no scope shows the project chooser instead (see the chooser test
// at the end of the D5 suite). Detail / new-package / clear-filters links
// carry the active scope in their query.

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href) => { throw new Error(`NEXT_REDIRECT:${href}`); }),
  listWorkPackages: vi.fn(),
  listPackagePropertyOptions: vi.fn(),
  listPlanningProgressForPackages: vi.fn(),
  listCostSplitForPackages: vi.fn(),
  listWorkspacesForActor: vi.fn(),
  createAuthenticatedForgeApplication: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: mocks.createAuthenticatedForgeApplication,
}));

vi.mock("@/lib/supabase/resolveEffectiveOwnerId", () => ({
  listWorkspacesForActor: mocks.listWorkspacesForActor,
}));

vi.mock("@/application/work-management/workPackages", () => ({
  listWorkPackages: mocks.listWorkPackages,
  listPackagePropertyOptions: mocks.listPackagePropertyOptions,
}));

// D2: the bulk planning-% read is mocked like the other service reads;
// the default is an empty map (no package has a checklist yet), so the
// widget shows its coverage note. D2 tests override per-test.
vi.mock("@/application/work-management/planningProcess", () => ({
  listPlanningProgressForPackages: mocks.listPlanningProgressForPackages,
}));

// D2b: the bulk cost-split read is mocked the same way. The default
// synthesizes a reconciled all-labor allocation for every estimated
// package from its planned_cost_cents, using the REAL summarizeCostSplit
// — so the strip total always equals the fixture packages' estimates
// ($1,750.00 for PACKAGES) and the widget's five-way totals reconcile
// to the strip. D2b tests override per-test.
vi.mock("@/application/work-management/budgetAllocations", () => ({
  listCostSplitForPackages: mocks.listCostSplitForPackages,
}));

import WorkPackagesPage from "./page.jsx";
import { summarizeCostSplit } from "@/domains/work-management/budgetAllocations";

const PROPERTIES = [
  { slug: "1900-w-decker", label: "1900 W. Decker" },
  { slug: "4800-kent-ave", label: "4800 Kent Ave" },
];

const PACKAGES = [
  { id: "wp_1", code: "WP-0001", title: "Decker turnover", package_type: "rental_turn", priority: "normal", status: "draft", planned_start: "2026-10-05", planned_finish: "2026-10-20", percent_complete: 0, unit: "A", area: "Kitchen", system: "Plumbing", property_id: "1900-w-decker", planned_cost_cents: 150000, responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Alpha" }, updated_at: "2026-10-01T00:00:00Z" },
  { id: "wp_2", code: "WP-0002", title: "Kent kitchen", package_type: "remodel", priority: "high", status: "in_progress", planned_start: null, planned_finish: null, percent_complete: 40, unit: null, area: null, system: null, property_id: "4800-kent-ave", planned_cost_cents: null, responsible_party: null, updated_at: "2026-10-02T00:00:00Z" },
  { id: "wp_3", code: "WP-0003", title: "Unassigned repairs", package_type: "maintenance_repair", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: null, area: null, system: null, property_id: null, planned_cost_cents: 25000, responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Beta" }, updated_at: "2026-10-03T00:00:00Z" },
];

async function renderPage(params = {}) {
  // PR B: the list renders under an explicit scope — default to the
  // Unassigned inbox. Pass forgeProject: undefined explicitly to render
  // the no-scope chooser state.
  const element = await WorkPackagesPage({ searchParams: Promise.resolve({ forgeProject: "unassigned", ...params }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: PACKAGES });
  mocks.listPackagePropertyOptions.mockResolvedValue({ ok: true, properties: PROPERTIES });
  mocks.listPlanningProgressForPackages.mockResolvedValue({ ok: true, notApplied: false, byPackage: {} });
  mocks.listCostSplitForPackages.mockImplementation(async (db, { packages }) => {
    const byPackage = {};
    for (const pkg of packages) {
      if (pkg.planned_cost_cents != null) {
        byPackage[pkg.id] = {
          estimate: { id: `est_${pkg.id}`, version: 1, currentEstimateCents: pkg.planned_cost_cents },
          allocation: { id: `alloc_${pkg.id}`, version: 1, estimateId: `est_${pkg.id}`, estimateVersion: 1, categoryTotals: { labor: pkg.planned_cost_cents, material: 0, equipment: 0, external_services: 0, rental: 0 } },
          reconciled: true,
          reason: null,
        };
      } else {
        byPackage[pkg.id] = { estimate: null, allocation: null, reconciled: false, reason: "no_estimate" };
      }
    }
    return { ok: true, notApplied: false, byPackage, summary: summarizeCostSplit({ packages, costByPackage: byPackage }) };
  });
  mocks.listWorkspacesForActor.mockResolvedValue([
    { ownerId: "owner_1", role: "owner", label: "My workspace" },
  ]);
  mocks.createAuthenticatedForgeApplication.mockImplementation(async (opts) => ({
    supabaseClient: { fakeDb: true },
    effectiveOwnerId: opts?.requestedOwnerId || "owner_1",
    user: { id: "owner_1" },
  }));
});

describe("/forge/work list filters (D5)", () => {
  it("loads all of the owner's packages unfiltered when no params are given", async () => {
    const html = await renderPage();
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Kent kitchen");
    expect(html).toContain("Unassigned repairs");
    // Same owner-scoped read as before filtering existed: ownerId plus
    // the explicit Unassigned scope, no status/property filter pushed
    // into the query.
    expect(mocks.listWorkPackages).toHaveBeenCalledWith({ fakeDb: true }, { ownerId: "owner_1", scope: { kind: "unassigned" } });
  });

  it("shows the project chooser when no scope is selected (fix round 1)", async () => {
    const html = await renderPage({ forgeProject: undefined });
    expect(html).toContain("Choose a project to see its work packages.");
    expect(html).not.toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
    // The read still runs, but under NO_SCOPE — the service answers
    // with the chooser state, never an all-projects aggregate.
    expect(mocks.listWorkPackages).toHaveBeenCalledWith({ fakeDb: true }, { ownerId: "owner_1", scope: { kind: "none" } });
  });

  it("treats status=all and propertyId=all as no filter", async () => {
    const html = await renderPage({ status: "all", propertyId: "all" });
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Kent kitchen");
    expect(html).toContain("Unassigned repairs");
  });

  it("filters by a known status", async () => {
    const html = await renderPage({ status: "draft" });
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Unassigned repairs");
    expect(html).not.toContain("Kent kitchen");
  });

  it("filters by a canonical property slug", async () => {
    const html = await renderPage({ propertyId: "4800-kent-ave" });
    expect(html).toContain("Kent kitchen");
    expect(html).not.toContain("Decker turnover");
  });

  it("resolves an alias property param to the canonical slug", async () => {
    const html = await renderPage({ propertyId: "1900-west-decker" });
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
  });

  it("filters to unassigned packages with the sentinel", async () => {
    const html = await renderPage({ propertyId: "__unassigned__" });
    expect(html).toContain("Unassigned repairs");
    expect(html).not.toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
  });

  it("combines status and property filters", async () => {
    const html = await renderPage({ status: "draft", propertyId: "1900-w-decker" });
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Unassigned repairs");
    expect(html).not.toContain("Kent kitchen");
  });

  it("ignores an invalid status safely instead of erroring or widening", async () => {
    const html = await renderPage({ status: "bogus_status' OR 1=1" });
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Kent kitchen");
    expect(html).toContain("Unassigned repairs");
  });

  it("shows blank add-rows instead of an empty state when there are no packages yet, and keeps 'no matches' distinct", async () => {
    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: [] });
    const emptyHtml = await renderPage();
    // The grid fills the page with blank rows even with zero packages —
    // typing in one creates the next package. No separate empty state.
    expect(emptyHtml).not.toContain("No work packages yet");
    expect(emptyHtml).not.toContain("match these filters");
    expect(emptyHtml).toContain('role="table"');
    expect(emptyHtml).toContain("New package title");

    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: PACKAGES });
    const noMatchHtml = await renderPage({ status: "verified_closed" });
    expect(noMatchHtml).toContain("No work packages match these filters");
    expect(noMatchHtml).toContain('href="/forge/work?forgeProject=unassigned"');
    expect(noMatchHtml).toContain("Clear filters");
  });

  it("deep-links directly: params applied on first render with no client fetch", async () => {
    const html = await renderPage({ status: "in_progress", propertyId: "4800-kent-ave" });
    expect(html).toContain("Kent kitchen");
    expect(html).not.toContain("Decker turnover");
  });

  it("renders accessible native GET-form selects reflecting the active filters", async () => {
    const html = await renderPage({ status: "draft", propertyId: "1900-w-decker" });
    expect(html).toContain('action="/forge/work" method="get"');
    expect(html).toContain('for="filter-status"');
    expect(html).toContain('id="filter-status" name="status"');
    expect(html).toContain('for="filter-property"');
    expect(html).toContain('id="filter-property" name="propertyId"');
    expect(html).toContain("Apply filters");
    expect(html).toContain("All statuses");
    expect(html).toContain("All properties");
    expect(html).toContain("No property assigned");
    expect(html).toContain("1900 W. Decker");
    expect(html).toContain("4800 Kent Ave");
    // Native selects keep their value in the submitted URL on refresh.
    expect(html).toContain('value="draft" selected=""');
  });

  it("preserves the new-package and detail links", async () => {
    const html = await renderPage();
    expect(html).toContain('href="/forge/work/new?forgeProject=unassigned"');
    expect(html).toContain('href="/forge/work/wp_1?forgeProject=unassigned"');
    expect(html).toContain('href="/forge/work/wp_2?forgeProject=unassigned"');
  });

  // D7's other half (stale Status/Property select values left in the DOM
  // after Clear/Apply) is a client-side React-reconciliation bug: an
  // uncontrolled <select defaultValue> keeps its first-mount value when
  // React reuses the same DOM node across a client navigation. The fix
  // (keying each select to the active filters so React remounts it fresh
  // whenever they change) is not observable from renderToStaticMarkup output
  // — key is never serialized to HTML and this harness never hydrates or
  // navigates — so it is verified by inspection of React's documented
  // key/remount semantics, not by a test here. NOT EXECUTED as a live
  // click-through in this build environment (no Supabase credentials);
  // owed before/at merge per BUILD_CONTRACT.md §7.

  it("D7: blank add-rows follow the same filter rule as real rows — hidden under a non-matching status/property filter, shown when the filter matches a draft/unassigned shape", async () => {
    // A filter that cannot match a blank row's shape (status != draft):
    // zero real matches too, so the page must show "no matches", not blank rows.
    const nonMatching = await renderPage({ status: "in_progress", propertyId: "__unassigned__" });
    expect(nonMatching).not.toContain("New package title");
    expect(nonMatching).toContain("No work packages match these filters");

    // status=draft matches a blank row's shape (draft, no property) even
    // though real draft packages also exist — blank rows must still show.
    const draftFilter = await renderPage({ status: "draft" });
    expect(draftFilter).toContain("New package title");
    expect(draftFilter).toContain("Decker turnover");

    // A property filter excludes blank rows (no property assigned) even
    // though real packages match that property.
    const propertyFilter = await renderPage({ propertyId: "1900-w-decker" });
    expect(propertyFilter).not.toContain("New package title");
    expect(propertyFilter).toContain("Decker turnover");

    // The unassigned-property sentinel matches a blank row's shape.
    const unassignedFilter = await renderPage({ propertyId: "__unassigned__" });
    expect(unassignedFilter).toContain("New package title");
  });

  it("never leaks another owner's packages: filtering runs only over the owner-scoped read", async () => {
    const html = await renderPage({ propertyId: "4800-kent-ave" });
    expect(html).not.toContain("Decker turnover");
    expect(mocks.listWorkPackages).toHaveBeenCalledTimes(1);
    expect(mocks.listPackagePropertyOptions).toHaveBeenCalledWith({ fakeDb: true }, { ownerId: "owner_1" });
  });
});

describe("/forge/work dense grid (UI-density redesign)", () => {
  it("renders one row per package with the full column set", async () => {
    const html = await renderPage();
    expect(html).toContain('role="table"');
    expect(html).toContain("Package #");
    expect(html).toContain("Owner team");
    expect(html).toContain("Budget / Actual");
    expect(html).toContain("Effective window");
    expect(html).toContain("% Complete");
    expect(html).toContain("Scope");
    expect(html).toContain("Updated");
    // Row data: code, owner team, estimate, window, percent, scope, updated.
    expect(html).toContain("WP-0001");
    expect(html).toContain("Crew Alpha");
    expect(html).toContain("$1,500.00");
    expect(html).toContain("2026-10-05");
    expect(html).toContain("2026-10-20");
    expect(html).toContain("40%");
    expect(html).toContain("rental_turn");
    expect(html).toContain("Kitchen");
    expect(html).toContain("2026-10-01");
    // Budget shows the planned estimate only; actuals are blank pre-slice-8.
    expect(html).toContain("$1,500.00 / —");
    expect(html).toContain("Budget shows the planned estimate only");
    // Unbudgeted package shows an em dash, not $0.00.
    expect(html).toContain("— / —");
  });

  it("resolves the property label in the grid", async () => {
    const html = await renderPage();
    expect(html).toContain("1900 W. Decker");
    expect(html).toContain("4800 Kent Ave");
  });

  it("keeps rows click-to-open with real detail links", async () => {
    const html = await renderPage();
    expect(html).toContain('href="/forge/work/wp_1?forgeProject=unassigned"');
    expect(html).toContain('href="/forge/work/wp_2?forgeProject=unassigned"');
    expect(html).toContain('href="/forge/work/wp_3?forgeProject=unassigned"');
  });

  it("renders the filters as a compact bar, not a bordered card", async () => {
    const html = await renderPage();
    expect(html).toContain('action="/forge/work" method="get"');
    expect(html).not.toContain("rounded-lg border border-slate-200 bg-white p-4");
  });
});

describe("/forge/work workspace switcher (UI-density redesign)", () => {
  it("renders nothing when the actor has exactly one workspace", async () => {
    const html = await renderPage();
    expect(html).not.toContain("Workspace:");
    expect(html).not.toContain("My workspace");
  });

  it("renders one button per workspace when the actor has two, with the current one marked", async () => {
    mocks.listWorkspacesForActor.mockResolvedValue([
      { ownerId: "owner_1", role: "owner", label: "My workspace" },
      { ownerId: "owner_2", role: "co_owner", label: "Shared workspace" },
    ]);
    const html = await renderPage({ workspace: "owner_2" });
    expect(html).toContain("Workspace:");
    expect(html).toContain("My workspace");
    expect(html).toContain("Shared workspace (co owner)");
    // The switcher preserves the active project scope in its links
    // (rendered HTML escapes & as &amp; in href attributes).
    expect(html).toContain('href="/forge/work?forgeProject=unassigned&amp;workspace=owner_2"');
    expect(html).toContain('aria-current="page"');
    // The switch passes the requested workspace through to auth.
    expect(mocks.createAuthenticatedForgeApplication).toHaveBeenCalledWith({ requestedOwnerId: "owner_2" });
    // And the resolved workspace scopes the read.
    expect(mocks.listWorkPackages).toHaveBeenCalledWith({ fakeDb: true }, { ownerId: "owner_2", scope: { kind: "unassigned" } });
  });

  it("carries the workspace selection through row links, the new-package link, and the filter form", async () => {
    mocks.listWorkspacesForActor.mockResolvedValue([
      { ownerId: "owner_1", role: "owner", label: "My workspace" },
      { ownerId: "owner_2", role: "co_owner", label: "Shared workspace" },
    ]);
    const html = await renderPage({ workspace: "owner_2" });
    expect(html).toContain('href="/forge/work/wp_1?workspace=owner_2&amp;forgeProject=unassigned"');
    expect(html).toContain('href="/forge/work/new?workspace=owner_2&amp;forgeProject=unassigned"');
    expect(html).toContain('name="workspace" value="owner_2"');
  });
});

describe("/forge/work dashboard shell (D1)", () => {
  it("renders the strip and scope chart on a scoped view, slices reconciling to the strip", async () => {
    const html = await renderPage();
    // Strip: project, total control estimate ($1,500.00 + $250.00), total scope items.
    expect(html).toContain("Total control estimate");
    expect(html).toContain("$1,750.00");
    expect(html).toContain("Total scope items");
    expect(html).toContain("Scope by status");
    // Donut legend: draft 2 of 3, in progress 1 of 3 — slices add up to the strip.
    expect(html).toContain("draft: 2 of 3 packages");
    expect(html).toContain("in progress: 1 of 3 packages");
    // Every legend row filters the grid, preserving the scope (rendered
    // HTML escapes & as &amp; in href attributes).
    expect(html).toContain('href="/forge/work?forgeProject=unassigned&amp;status=draft"');
    expect(html).toContain('href="/forge/work?forgeProject=unassigned&amp;status=in_progress"');
    // The grid below is unchanged.
    expect(html).toContain('role="table"');
    expect(html).toContain("Decker turnover");
  });

  it("keeps the strip on the whole scope when the grid is filtered", async () => {
    const html = await renderPage({ status: "draft" });
    // The grid narrows to draft rows only...
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
    // ...but the strip still totals the whole project, and the donut
    // still shows the in-progress slice (the rows the filter hid).
    expect(html).toContain("$1,750.00");
    expect(html).toContain("in progress: 1 of 3 packages");
    // The active slice is marked and its link clears the filter.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('href="/forge/work?forgeProject=unassigned"');
  });

  it("fix round 1: drill-down counts reconcile with rows when property/mode filters are active", async () => {
    // Packages split across properties AND modes: two of the three draft
    // rows live on different properties with different modes, so a drill-
    // down link that preserved the active narrowing filters would
    // silently drop rows the chart count advertises (the P1: "draft: 2
    // of 2" landing on 1 row). The dashboard is project-wide: every
    // drill-down link must clear the narrowing filters.
    const splitPackages = [
      { id: "wp_a", code: "WP-A", title: "North draft industrial", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: "Unit A", area: "Process", system: "Exchanger", property_id: "1900-w-decker", mode: "industrial", planned_cost_cents: 100000, responsible_party: null, updated_at: "2026-10-01T00:00:00Z" },
      { id: "wp_b", code: "WP-B", title: "South draft commercial", package_type: "commercial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: "Unit B", area: "Utilities", system: "Pumping", property_id: "4800-kent-ave", mode: "commercial", planned_cost_cents: 200000, responsible_party: null, updated_at: "2026-10-02T00:00:00Z" },
      { id: "wp_c", code: "WP-C", title: "North in-progress commercial", package_type: "commercial", priority: "normal", status: "in_progress", planned_start: null, planned_finish: null, percent_complete: 40, unit: "Unit A", area: "Process", system: "Piping", property_id: "1900-w-decker", mode: "commercial", planned_cost_cents: null, responsible_party: null, updated_at: "2026-10-03T00:00:00Z" },
      { id: "wp_d", code: "WP-D", title: "South draft industrial", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: "Unit C", area: "Offsites", system: "Piping", property_id: "4800-kent-ave", mode: "industrial", planned_cost_cents: 300000, responsible_party: null, updated_at: "2026-10-04T00:00:00Z" },
    ];
    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: splitPackages });

    // Narrowing filters active: the grid narrows to the one matching row...
    const html = await renderPage({ propertyId: "1900-w-decker", mode: "industrial" });
    expect(html).toContain("North draft industrial");
    expect(html).not.toContain("South draft commercial");
    expect(html).not.toContain("South draft industrial");
    // ...but the dashboard still describes the whole project.
    expect(html).toContain("draft: 3 of 4 packages");
    expect(html).toContain("in progress: 1 of 4 packages");
    // The generated draft link must clear the narrowing filters — no
    // propertyId=, no mode= — so its destination rows equal the count.
    const draftLink = html.match(/href="([^"]*status=draft[^"]*)"/);
    expect(draftLink).not.toBeNull();
    expect(draftLink[1]).not.toContain("propertyId=");
    expect(draftLink[1]).not.toContain("mode=");
    // Follow the generated link exactly as rendered: the grid must show
    // all three draft rows the count advertises, and nothing else.
    const linkParams = Object.fromEntries(
      new URLSearchParams(draftLink[1].replace(/&amp;/g, "&").split("?")[1] || ""),
    );
    const drilled = await renderPage(linkParams);
    expect(drilled).toContain("North draft industrial");
    expect(drilled).toContain("South draft commercial");
    expect(drilled).toContain("South draft industrial");
    expect(drilled).not.toContain("North in-progress commercial");
  });

  it("renders no dashboard in the chooser state", async () => {
    const html = await renderPage({ forgeProject: undefined });
    expect(html).toContain("Choose a project to see its work packages.");
    expect(html).not.toContain("Total control estimate");
    expect(html).not.toContain("Scope by status");
  });

  it("renders no dashboard when the package load fails", async () => {
    mocks.listWorkPackages.mockResolvedValue({ ok: false });
    const html = await renderPage();
    expect(html).toContain("Unable to load work packages.");
    expect(html).not.toContain("Total control estimate");
    expect(html).not.toContain("Scope by status");
  });

  it("renders the empty face on a project with no packages yet", async () => {
    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: [] });
    const html = await renderPage();
    expect(html).toContain("Total scope items");
    expect(html).toContain("No packages in this project yet");
    expect(html).not.toContain("Scope by status: ");
    // The grid still fills the page with blank add-rows.
    expect(html).toContain('role="table"');
    expect(html).toContain("New package title");
  });
});

describe("/forge/work planning progress (D2)", () => {
  // wp_1 100% (complete), wp_2 40%, wp_3 0% (not started) — total
  // 1 of 3 complete, mean 46.7%. Planning % is the credit-weighted %
  // here, never the package percent_complete (wp_1 is 0 there).
  const PLANNING = {
    wp_1: { percentComplete: 100, initialized: true },
    wp_2: { percentComplete: 40, initialized: true },
    wp_3: { percentComplete: 0, initialized: false },
  };

  it("renders the progress widget from one bulk planning read", async () => {
    mocks.listPlanningProgressForPackages.mockResolvedValue({ ok: true, notApplied: false, byPackage: PLANNING });
    const html = await renderPage();
    // One bulk read for the whole project — never per-package.
    expect(mocks.listPlanningProgressForPackages).toHaveBeenCalledTimes(1);
    expect(mocks.listPlanningProgressForPackages).toHaveBeenCalledWith({ fakeDb: true }, { ownerId: "owner_1", packages: PACKAGES });
    expect(html).toContain("Planning progress");
    expect(html).toContain("All packages: 1 of 3 packages complete, 46.7% planning progress");
    expect(html).toContain("Plumbing: 1 of 1 packages complete, 100.0% planning progress");
  });

  it("filters the grid by planner, unit, and system", async () => {
    // Planner: Crew Alpha owns only the Decker turnover.
    let html = await renderPage({ planner: "Crew Alpha" });
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
    expect(html).not.toContain("Unassigned repairs");
    // Unit: only the Decker turnover has a unit.
    html = await renderPage({ unit: "A" });
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
    // System: Plumbing is the Decker turnover; the sentinel matches the two without one.
    html = await renderPage({ system: "Plumbing" });
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
    html = await renderPage({ system: "__none__" });
    expect(html).toContain("Kent kitchen");
    expect(html).toContain("Unassigned repairs");
    expect(html).not.toContain("Decker turnover");
    // Unassigned planner: only the Kent kitchen has no responsible party.
    html = await renderPage({ planner: "__unassigned__" });
    expect(html).toContain("Kent kitchen");
    expect(html).not.toContain("Decker turnover");
    expect(html).not.toContain("Unassigned repairs");
  });

  it("D2 regression (D1 fix round 1): following a progress drill link lands on exactly the group's rows", async () => {
    mocks.listPlanningProgressForPackages.mockResolvedValue({ ok: true, notApplied: false, byPackage: PLANNING });
    // A property filter is active: the grid narrows, but the widget
    // still describes the whole project — and its drill links must
    // clear the narrowing filter, or the count would lie.
    const html = await renderPage({ propertyId: "4800-kent-ave" });
    expect(html).toContain("Plumbing: 1 of 1 packages complete, 100.0% planning progress");
    const plumbingLink = html.match(/href="([^"]*system=Plumbing[^"]*)"/);
    expect(plumbingLink).not.toBeNull();
    expect(plumbingLink[1]).not.toContain("propertyId=");
    expect(plumbingLink[1]).not.toContain("mode=");
    expect(plumbingLink[1]).toContain("progressBy=system");
    // Follow the generated link exactly as rendered.
    const linkParams = Object.fromEntries(
      new URLSearchParams(plumbingLink[1].replace(/&amp;/g, "&").split("?")[1] || ""),
    );
    const drilled = await renderPage(linkParams);
    expect(drilled).toContain("Decker turnover");
    expect(drilled).not.toContain("Kent kitchen");
    expect(drilled).not.toContain("Unassigned repairs");
    // The widget still totals the whole project on the drill landing,
    // and the System tab is the active grouping.
    expect(drilled).toContain("All packages: 1 of 3 packages complete, 46.7% planning progress");
    expect(drilled).toContain('aria-pressed="true"');
  });

  it("fix round 1 (P1): combined group filters are mutually exclusive — the highlighted row reconciles with the grid", async () => {
    // The verdict's example: planner Crew Alpha owns two packages split
    // across units. Submitting planner + unit together used to highlight
    // Alpha's project-wide row ("1 of 2") while the grid showed only
    // the unit-B row — the count did not reconcile with the rows.
    const splitPackages = [
      { id: "wp_a", code: "WP-A", title: "Alpha unit A piping", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: "A", area: "Process", system: "Piping", property_id: "1900-w-decker", planned_cost_cents: 100000, responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Alpha" }, updated_at: "2026-10-01T00:00:00Z" },
      { id: "wp_b", code: "WP-B", title: "Alpha unit B exchanger", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: "B", area: "Process", system: "Exchanger", property_id: "4800-kent-ave", planned_cost_cents: 200000, responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Alpha" }, updated_at: "2026-10-02T00:00:00Z" },
      { id: "wp_c", code: "WP-C", title: "Beta unit A piping", package_type: "commercial", priority: "normal", status: "in_progress", planned_start: null, planned_finish: null, percent_complete: 40, unit: "A", area: "Utilities", system: "Piping", property_id: "1900-w-decker", planned_cost_cents: null, responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Beta" }, updated_at: "2026-10-03T00:00:00Z" },
    ];
    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: splitPackages });
    mocks.listPlanningProgressForPackages.mockResolvedValue({
      ok: true,
      notApplied: false,
      byPackage: {
        wp_a: { percentComplete: 100, initialized: true },
        wp_b: { percentComplete: 50, initialized: true },
        wp_c: { percentComplete: 0, initialized: false },
      },
    });

    // Submit combined filters: planner + unit together. The page
    // redirects to the canonical form — the kept dimension only — so
    // the address bar, the selects, the grid, and the widget agree.
    let redirectHref = null;
    try {
      await renderPage({ planner: "Crew Alpha", unit: "B" });
    } catch (err) {
      const match = /^NEXT_REDIRECT:(.+)$/.exec(err.message || "");
      redirectHref = match ? match[1] : null;
      if (!redirectHref) throw err;
    }
    expect(redirectHref).not.toBeNull();
    expect(redirectHref).toContain("planner=Crew+Alpha");
    expect(redirectHref).not.toContain("unit=");

    // Follow the canonical link exactly as rendered: the grid must hold
    // BOTH Crew Alpha packages — the rows the widget's 1-of-2 count
    // advertises — and nothing else.
    const linkParams = Object.fromEntries(
      new URLSearchParams(redirectHref.split("?")[1] || ""),
    );
    const landed = await renderPage(linkParams);
    expect(landed).toContain("Alpha unit A piping");
    expect(landed).toContain("Alpha unit B exchanger");
    expect(landed).not.toContain("Beta unit A piping");
    // The highlighted row is Crew Alpha's project-wide row with the
    // count the grid actually shows; the cleared dimension's select
    // shows "All units" — no unit stays selected.
    expect(landed).toContain("Crew Alpha: 1 of 2 packages complete, 75.0% planning progress");
    expect(landed).toContain("currently filtered, activate to show all");
    expect(landed).toContain('value="Crew Alpha" selected=""');
    expect(landed).not.toContain('value="B" selected=""');
    // The real next/link renders aria-pressed before href, so match the
    // tag by its aria-label and read the href out of it.
    const activeTag = landed.match(/<a[^>]*aria-label="Crew Alpha: 1 of 2 packages complete, 75\.0% planning progress[^"]*"[^>]*>/);
    expect(activeTag).not.toBeNull();
    expect(activeTag[0]).toContain('aria-pressed="true"');
    const activeRow = activeTag[0].match(/href="([^"]+)"/);
    expect(activeRow).not.toBeNull();

    // Follow the active row's toggle link: it clears the group filter,
    // so all three packages show — exactly what its label advertises.
    const toggleParams = Object.fromEntries(
      new URLSearchParams(activeRow[1].replace(/&amp;/g, "&").split("?")[1] || ""),
    );
    const cleared = await renderPage(toggleParams);
    expect(cleared).toContain("Alpha unit A piping");
    expect(cleared).toContain("Alpha unit B exchanger");
    expect(cleared).toContain("Beta unit A piping");
  });

  it("offers the project's planners, units, and systems in the filter form", async () => {
    const html = await renderPage();
    expect(html).toContain('<option value="Crew Alpha">Crew Alpha</option>');
    expect(html).toContain('<option value="Crew Beta">Crew Beta</option>');
    expect(html).toContain('<option value="__unassigned__">Unassigned</option>');
    expect(html).toContain('<option value="A">A</option>');
    expect(html).toContain('<option value="__none__">No unit</option>');
    expect(html).toContain('<option value="Plumbing">Plumbing</option>');
    expect(html).toContain('<option value="__none__">No system</option>');
  });

  it("shows the coverage note when no package has a checklist, and the not-available note when the read fails", async () => {
    const html = await renderPage();
    expect(html).toContain("Planning % covers 0 of 3 packages");
    mocks.listPlanningProgressForPackages.mockRejectedValue(new Error("db down"));
    const failed = await renderPage();
    expect(failed).toContain("Decker turnover");
    expect(failed).toContain("Planning progress isn&#x27;t available yet");
  });

  it("skips the bulk planning read for an empty project", async () => {
    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: [] });
    const html = await renderPage();
    expect(mocks.listPlanningProgressForPackages).not.toHaveBeenCalled();
    expect(html).toContain("No packages in this project yet");
  });
});

describe("/forge/work cost split (D2b)", () => {
  // D2b cost fixture: wp_1 reconciled $1,500.00 (labor $1,000.00,
  // material $500.00), wp_3 reconciled $250.00 (labor $250.00),
  // wp_2 no estimate. Five-way totals: labor $1,250.00, material
  // $500.00 — $1,750.00, the strip total.
  const COST_BY_PACKAGE = {
    wp_1: {
      estimate: { id: "est_1", version: 1, currentEstimateCents: 150000 },
      allocation: { id: "alloc_1", version: 1, estimateId: "est_1", estimateVersion: 1, categoryTotals: { labor: 100000, material: 50000, equipment: 0, external_services: 0, rental: 0 } },
      reconciled: true, reason: null,
    },
    wp_2: { estimate: null, allocation: null, reconciled: false, reason: "no_estimate" },
    wp_3: {
      estimate: { id: "est_3", version: 1, currentEstimateCents: 25000 },
      allocation: { id: "alloc_3", version: 1, estimateId: "est_3", estimateVersion: 1, categoryTotals: { labor: 25000, material: 0, equipment: 0, external_services: 0, rental: 0 } },
      reconciled: true, reason: null,
    },
  };
  function mockCost(byPackage = COST_BY_PACKAGE, packages = PACKAGES) {
    mocks.listCostSplitForPackages.mockResolvedValue({
      ok: true, notApplied: false, byPackage,
      summary: summarizeCostSplit({ packages, costByPackage: byPackage }),
    });
  }

  it("renders the cost-split widget from one bulk cost read", async () => {
    mockCost();
    const html = await renderPage();
    expect(html).toContain("Cost split");
    expect(html).toContain("All 2 estimated packages reconciled.");
    expect(mocks.listCostSplitForPackages).toHaveBeenCalledTimes(1);
    expect(mocks.listCostSplitForPackages).toHaveBeenCalledWith({ fakeDb: true }, { ownerId: "owner_1", packages: PACKAGES });
  });

  it("filters the grid by costCategory and ignores an unknown category", async () => {
    mockCost();
    const html = await renderPage({ costCategory: "material" });
    // Only wp_1 has a positive material total.
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
    expect(html).not.toContain("Unassigned repairs");
    // The strip and the widget still describe the whole project.
    expect(html).toContain("$1,750.00");
    // An unknown category is ignored, never widened into a filter.
    const bogus = await renderPage({ costCategory: "bogus" });
    expect(bogus).toContain("Decker turnover");
    expect(bogus).toContain("Kent kitchen");
    expect(bogus).toContain("Unassigned repairs");
  });

  it("D2b regression (D1 fix round 1): following a cost drill link lands on exactly the rows behind the count", async () => {
    mockCost();
    const html = await renderPage();
    const laborLink = html.match(/href="([^"]*costCategory=labor[^"]*)"/);
    expect(laborLink).not.toBeNull();
    // The drill link is project-wide: no status/property/mode/group
    // params ride along, so its destination rows equal the count.
    expect(laborLink[1]).not.toContain("status=");
    expect(laborLink[1]).not.toContain("propertyId=");
    const linkParams = Object.fromEntries(
      new URLSearchParams(laborLink[1].replace(/&amp;/g, "&").split("?")[1] || ""),
    );
    const drilled = await renderPage(linkParams);
    expect(drilled).toContain("Decker turnover");
    expect(drilled).toContain("Unassigned repairs");
    expect(drilled).not.toContain("Kent kitchen");
  });

  it("routes allocation=unallocated to exactly the estimated-but-unreconciled rows", async () => {
    // wp_3's allocation went stale: its $250.00 is unallocated, wp_1
    // stays reconciled, wp_2 has no estimate at all.
    const unreconciled = {
      ...COST_BY_PACKAGE,
      wp_3: {
        estimate: { id: "est_3", version: 2, currentEstimateCents: 25000 },
        allocation: { id: "alloc_3", version: 1, estimateId: "est_3", estimateVersion: 1, categoryTotals: { labor: 25000, material: 0, equipment: 0, external_services: 0, rental: 0 } },
        reconciled: false, reason: "stale",
      },
    };
    mockCost(unreconciled);
    const html = await renderPage();
    expect(html).toContain("Allocation incomplete — 1 of 2 estimated packages have no reconciled allocation, $250.00 unallocated. 1 of 2 reconciled.");
    const link = html.match(/href="([^"]*allocation=unallocated[^"]*)">Show unallocated packages/);
    expect(link).not.toBeNull();
    const linkParams = Object.fromEntries(
      new URLSearchParams(link[1].replace(/&amp;/g, "&").split("?")[1] || ""),
    );
    const drilled = await renderPage(linkParams);
    expect(drilled).toContain("Unassigned repairs");
    expect(drilled).not.toContain("Decker turnover");
    expect(drilled).not.toContain("Kent kitchen");
  });

  it("carries the cost filters through the filter form as hidden inputs", async () => {
    mockCost();
    const html = await renderPage({ costCategory: "labor", allocation: "unallocated" });
    expect(html).toContain('<input type="hidden" name="costCategory" value="labor"/>');
    expect(html).toContain('<input type="hidden" name="allocation" value="unallocated"/>');
    const plain = await renderPage();
    expect(plain).not.toContain('name="costCategory"');
    expect(plain).not.toContain('name="allocation"');
  });

  it("hides blank add-rows under a cost filter — a blank row has no cost data", async () => {
    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: [] });
    mockCost({}, []);
    const html = await renderPage({ costCategory: "labor" });
    expect(html).not.toContain("New package title");
    const plain = await renderPage();
    expect(plain).toContain("New package title");
  });

  it("shows the not-available note when the cost read fails, and the strip shows —", async () => {
    mocks.listCostSplitForPackages.mockRejectedValue(new Error("db down"));
    const html = await renderPage();
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Cost split isn&#x27;t available yet");
    expect(html).toContain("Cost split not available yet");
    expect(html).not.toContain("$1,750.00");
  });

  it("skips the bulk cost read for an empty project", async () => {
    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: [] });
    const html = await renderPage();
    expect(mocks.listCostSplitForPackages).not.toHaveBeenCalled();
    expect(html).toContain("No packages in this project yet");
  });
});

