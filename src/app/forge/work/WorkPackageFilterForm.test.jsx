// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// D2 fix round 2 (P1): the filter form must enforce mutual exclusion
// in the visible controls, not only in the submitted URL. Fix round 1
// normalized combined URLs server-side, but the three group selects
// stayed independent: after drilling into planner=Crew Alpha, picking
// unit=B and clicking Apply filters submitted planner=Crew Alpha&unit=B,
// and the canonicalizer silently dropped the newly picked Unit. These
// tests drive the actual form controls (the repo's jsdom + createRoot +
// native-setter idiom, as in CashForecastPanel.test.jsx) and then follow
// the submitted params through the real page render, asserting the
// destination grid, the highlighted progress row, and the selects.

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href) => { throw new Error(`NEXT_REDIRECT:${href}`); }),
  listWorkPackages: vi.fn(),
  listPackagePropertyOptions: vi.fn(),
  listPlanningProgressForPackages: vi.fn(),
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

vi.mock("@/application/work-management/planningProcess", () => ({
  listPlanningProgressForPackages: mocks.listPlanningProgressForPackages,
}));

import WorkPackageFilterForm from "./WorkPackageFilterForm.jsx";
import WorkPackagesPage from "./page.jsx";

const PROPERTIES = [
  { slug: "1900-w-decker", label: "1900 W. Decker" },
  { slug: "4800-kent-ave", label: "4800 Kent Ave" },
];

// Same split packages as the fix-round-1 regression: planner Crew Alpha
// owns two packages split across units A/B, plus a Crew Beta control.
const SPLIT_PACKAGES = [
  { id: "wp_a", code: "WP-A", title: "Alpha unit A piping", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: "A", area: "Process", system: "Piping", property_id: "1900-w-decker", planned_cost_cents: 100000, responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Alpha" }, updated_at: "2026-10-01T00:00:00Z" },
  { id: "wp_b", code: "WP-B", title: "Alpha unit B exchanger", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: "B", area: "Process", system: "Exchanger", property_id: "4800-kent-ave", planned_cost_cents: 200000, responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Alpha" }, updated_at: "2026-10-02T00:00:00Z" },
  { id: "wp_c", code: "WP-C", title: "Beta unit A piping", package_type: "commercial", priority: "normal", status: "in_progress", planned_start: null, planned_finish: null, percent_complete: 40, unit: "A", area: "Utilities", system: "Piping", property_id: "1900-w-decker", planned_cost_cents: null, responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Beta" }, updated_at: "2026-10-03T00:00:00Z" },
];

const PLANNING_BY_PACKAGE = {
  wp_a: { percentComplete: 100, initialized: true },
  wp_b: { percentComplete: 50, initialized: true },
  wp_c: { percentComplete: 0, initialized: false },
};

async function renderPage(params = {}) {
  const element = await WorkPackagesPage({ searchParams: Promise.resolve({ forgeProject: "unassigned", ...params }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: SPLIT_PACKAGES });
  mocks.listPackagePropertyOptions.mockResolvedValue({ ok: true, properties: PROPERTIES });
  mocks.listPlanningProgressForPackages.mockResolvedValue({ ok: true, notApplied: false, byPackage: PLANNING_BY_PACKAGE });
  mocks.listWorkspacesForActor.mockResolvedValue([
    { ownerId: "owner_1", role: "owner", label: "My workspace" },
  ]);
  mocks.createAuthenticatedForgeApplication.mockImplementation(async (opts) => ({
    supabaseClient: { fakeDb: true },
    effectiveOwnerId: opts?.requestedOwnerId || "owner_1",
    user: { id: "owner_1" },
  }));
});

const roots = [];
afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await act(async () => { root.unmount(); });
  }
  document.body.innerHTML = "";
});

async function mountForm(initialFilters) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <WorkPackageFilterForm
        filters={{ status: "all", propertyId: "all", mode: "all", planner: "all", unit: "all", system: "all", ...initialFilters }}
        statusOptions={["draft", "in_progress", "verified_closed"]}
        properties={PROPERTIES}
        modeOptions={["industrial", "commercial"]}
        plannerOptions={["Crew Alpha", "Crew Beta"]}
        unitOptions={["A", "B"]}
        systemOptions={["Exchanger", "Piping"]}
        hasUnassignedPlanner={false}
        hasNoUnit
        hasNoSystem
        requestedWorkspace={null}
        ownerId="owner_1"
        forgeProjectParam="unassigned"
        hasFilters
        clearHref="/forge/work"
      />,
    );
  });
  return container;
}

async function changeSelect(select, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  ).set;
  await act(async () => {
    nativeSetter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitAndCapture(form) {
  let submitted = null;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitted = new FormData(form);
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  return submitted;
}

function selectBlock(html, selectId) {
  const match = html.match(new RegExp(`<select[^>]*id="${selectId}"[^>]*>([\\s\\S]*?)</select>`));
  expect(match).not.toBeNull();
  return match[1];
}

describe("D2b: the filter form carries the cost filters as hidden inputs", () => {
  it("submits costCategory and allocation alongside the visible selects", async () => {
    const container = await mountForm({ costCategory: "labor", allocation: "unallocated" });
    const form = container.querySelector("form");
    const submitted = await submitAndCapture(form);
    expect(submitted.get("costCategory")).toBe("labor");
    expect(submitted.get("allocation")).toBe("unallocated");
    expect(submitted.get("status")).toBe("all");
  });

  it("omits the hidden inputs when no cost filter is active", async () => {
    const container = await mountForm({});
    const form = container.querySelector("form");
    const submitted = await submitAndCapture(form);
    expect(submitted.has("costCategory")).toBe(false);
    expect(submitted.has("allocation")).toBe(false);
  });
});

describe("D2 fix round 2 (P1): the filter form enforces mutual exclusion on change", () => {
  it("Planner -> Unit: picking a Unit while a Planner is active clears the Planner in the form and the submission", async () => {
    const container = await mountForm({ planner: "Crew Alpha" });
    const plannerSelect = container.querySelector("#filter-planner");
    const unitSelect = container.querySelector("#filter-unit");
    expect(plannerSelect.value).toBe("Crew Alpha");
    expect(unitSelect.value).toBe("all");

    await changeSelect(unitSelect, "B");

    // The visible form must reflect the switch: the newly picked Unit
    // is active and the Planner is cleared — otherwise Apply filters
    // would submit both and the canonicalizer would silently drop
    // the Unit the user just picked.
    expect(unitSelect.value).toBe("B");
    expect(plannerSelect.value).toBe("all");

    const submitted = await submitAndCapture(container.querySelector("form"));
    expect(submitted).not.toBeNull();
    expect(submitted.get("planner")).toBe("all");
    expect(submitted.get("unit")).toBe("B");

    // Follow the submitted params through the real page: the grid
    // holds exactly the Unit-B row, the Unit-B progress row is the
    // highlighted one, and the selects agree — Unit B active, no
    // Planner selected.
    const landed = await renderPage(Object.fromEntries(submitted.entries()));
    expect(landed).toContain("Alpha unit B exchanger");
    expect(landed).not.toContain("Alpha unit A piping");
    expect(landed).not.toContain("Beta unit A piping");
    expect(landed).toContain("B: 0 of 1 packages complete, 50.0% planning progress — currently filtered, activate to show all");
    expect(selectBlock(landed, "filter-unit")).toContain('value="B" selected=""');
    expect(selectBlock(landed, "filter-planner")).toContain('value="all" selected=""');
    expect(selectBlock(landed, "filter-planner")).not.toContain('value="Crew Alpha" selected=""');

    // The highlighted row's toggle link shows all packages again.
    const activeTag = landed.match(/<a[^>]*aria-label="B: 0 of 1 packages complete, 50\.0% planning progress[^\"]*"[^>]*>/);
    expect(activeTag).not.toBeNull();
    expect(activeTag[0]).toContain('aria-pressed="true"');
    const activeRow = activeTag[0].match(/href="([^"]+)"/);
    expect(activeRow).not.toBeNull();
    const cleared = await renderPage(Object.fromEntries(
      new URLSearchParams(activeRow[1].split("?")[1] || ""),
    ));
    expect(cleared).toContain("Alpha unit A piping");
    expect(cleared).toContain("Alpha unit B exchanger");
    expect(cleared).toContain("Beta unit A piping");
  });

  it("Unit -> System: picking a System while a Unit is active clears the Unit in the form and the submission", async () => {
    const container = await mountForm({ unit: "B" });
    const unitSelect = container.querySelector("#filter-unit");
    const systemSelect = container.querySelector("#filter-system");
    expect(unitSelect.value).toBe("B");
    expect(systemSelect.value).toBe("all");

    await changeSelect(systemSelect, "Piping");

    expect(systemSelect.value).toBe("Piping");
    expect(unitSelect.value).toBe("all");

    const submitted = await submitAndCapture(container.querySelector("form"));
    expect(submitted).not.toBeNull();
    expect(submitted.get("unit")).toBe("all");
    expect(submitted.get("system")).toBe("Piping");

    const landed = await renderPage(Object.fromEntries(submitted.entries()));
    expect(landed).toContain("Alpha unit A piping");
    expect(landed).toContain("Beta unit A piping");
    expect(landed).not.toContain("Alpha unit B exchanger");
    expect(landed).toContain("Piping: 1 of 2 packages complete, 50.0% planning progress — currently filtered, activate to show all");
    expect(selectBlock(landed, "filter-system")).toContain('value="Piping" selected=""');
    expect(selectBlock(landed, "filter-unit")).toContain('value="all" selected=""');
    expect(selectBlock(landed, "filter-unit")).not.toContain('value="B" selected=""');
  });
});

describe("S26+ slice 2: every filter select carries the D11 dark-mode classes", () => {
  // Jason's S26+ walkthrough (Nov 22, checks 2 + 4): the Mode filter
  // showed as an empty box on both screens. Root cause: the Mode
  // <select> was the ONLY filter control missing the D11 dark-mode
  // classes, so in dark mode it rendered the page's white text on the
  // browser's native white control background — white-on-white. The
  // same form serves both screens, so one missing class was two
  // sightings. These tests pin the Mode control to its siblings so
  // the bug class cannot recur on any filter here.
  const DARK_SELECT_CLASSES = ["dark:border-slate-600", "dark:bg-slate-800", "dark:text-white"];

  it("Mode select and label match their siblings", async () => {
    const container = await mountForm({});
    const modeSelect = container.querySelector("#filter-mode");
    expect(modeSelect).not.toBeNull();
    for (const cls of DARK_SELECT_CLASSES) {
      expect(modeSelect.className).toContain(cls);
    }
    const modeLabel = container.querySelector('label[for="filter-mode"]');
    expect(modeLabel).not.toBeNull();
    expect(modeLabel.className).toContain("dark:text-slate-300");
  });

  it("all six filter selects carry the same dark classes", async () => {
    const container = await mountForm({});
    for (const id of ["filter-status", "filter-property", "filter-mode", "filter-planner", "filter-unit", "filter-system"]) {
      const select = container.querySelector(`#${id}`);
      expect(select).not.toBeNull();
      for (const cls of DARK_SELECT_CLASSES) {
        expect(select.className).toContain(cls);
      }
    }
  });
});
