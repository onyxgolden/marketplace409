// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// D1 dashboard shell: number strip + scope-by-status pivot chart
// (donut ↔ bars) with click-to-filter on every chart row. The strip and
// the chart read one summary, so these tests pin the strip totals, the
// filter hrefs (scope preserved, status appended), the chart-type switch,
// the active-slice toggle-off, and the empty / no-cost states.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import PlannerDashboardShell from "./PlannerDashboardShell.jsx";

const PACKAGES = [
  { id: "wp_1", code: "WP-0001", title: "Decker turnover", package_type: "rental_turn", priority: "normal", status: "draft", planned_start: "2026-10-05", planned_finish: "2026-10-20", percent_complete: 0, unit: "A", area: "Kitchen", system: "Plumbing", property_id: "1900-w-decker", planned_cost_cents: 150000, responsible_party: null, updated_at: "2026-10-01T00:00:00Z" },
  { id: "wp_2", code: "WP-0002", title: "Kent kitchen", package_type: "remodel", priority: "high", status: "in_progress", planned_start: null, planned_finish: null, percent_complete: 40, unit: null, area: null, system: null, property_id: "4800-kent-ave", planned_cost_cents: null, responsible_party: null, updated_at: "2026-10-02T00:00:00Z" },
  { id: "wp_3", code: "WP-0003", title: "Unassigned repairs", package_type: "maintenance_repair", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: null, area: null, system: null, property_id: null, planned_cost_cents: 25000, responsible_party: null, updated_at: "2026-10-03T00:00:00Z" },
];

const BASE_HREF = "/forge/work?forgeProject=unassigned";

let root = null;
let container = null;

function renderShell(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <PlannerDashboardShell
        projectLabel="Unassigned packages"
        projectSublabel="Packages not assigned to a project yet"
        packages={PACKAGES}
        baseHref={BASE_HREF}
        activeStatus={null}
        {...props}
      />,
    );
  });
  return container;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

function legendLinks() {
  return [...container.querySelectorAll('[data-testid="planner-status-legend"] a')];
}

describe("PlannerDashboardShell", () => {
  it("renders the strip: project, total planned cost, total scope items", () => {
    renderShell();
    expect(container.textContent).toContain("Unassigned packages");
    expect(container.textContent).toContain("Total planned cost");
    expect(container.textContent).toContain("$1,750.00");
    expect(container.textContent).toContain("Total scope items");
    // The strip total (3) and the legend counts (2 draft + 1 in progress)
    // reconcile: the slices add up to the strip.
    const donut = container.querySelector('[data-testid="planner-donut"]');
    expect(donut).not.toBeNull();
    expect(donut.getAttribute("aria-label")).toContain("draft 2 of 3");
    expect(donut.getAttribute("aria-label")).toContain("in progress 1 of 3");
  });

  it("shows — (never a false $0.00) when no package carries a cost yet", () => {
    renderShell({ packages: PACKAGES.map((p) => ({ ...p, planned_cost_cents: null })) });
    expect(container.textContent).toContain("No package estimated yet");
    const costBlock = container.querySelector('a[aria-label^="Total planned cost"]');
    expect(costBlock.textContent).toContain("—");
  });

  it("links every legend row to the status filter, preserving the scope", () => {
    renderShell();
    const links = legendLinks();
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe(`${BASE_HREF}&status=draft`);
    expect(links[1].getAttribute("href")).toBe(`${BASE_HREF}&status=in_progress`);
    // The strip's cost/items blocks clear the filter to the rows behind
    // the totals.
    expect(container.querySelector('a[aria-label^="Total planned cost"]').getAttribute("href")).toBe(BASE_HREF);
    expect(container.querySelector('a[aria-label^="Total scope items"]').getAttribute("href")).toBe(BASE_HREF);
  });

  it("toggles the active status off when its row is clicked again", () => {
    renderShell({ activeStatus: "draft" });
    const links = legendLinks();
    expect(links[0].getAttribute("aria-pressed")).toBe("true");
    expect(links[0].getAttribute("href")).toBe(BASE_HREF);
    expect(links[1].getAttribute("aria-pressed")).toBe("false");
    expect(links[1].getAttribute("href")).toBe(`${BASE_HREF}&status=in_progress`);
  });

  it("switches the pivot chart from donut to bars and back", () => {
    renderShell();
    expect(container.querySelector('[data-testid="planner-donut"]')).not.toBeNull();
    const barsButton = [...container.querySelectorAll('button')].find((b) => b.textContent === "Bars");
    act(() => { barsButton.click(); });
    expect(container.querySelector('[data-testid="planner-donut"]')).toBeNull();
    expect(barsButton.getAttribute("aria-pressed")).toBe("true");
    // Same legend rows, now with bars.
    expect(legendLinks()).toHaveLength(2);
    const donutButton = [...container.querySelectorAll('button')].find((b) => b.textContent === "Donut");
    act(() => { donutButton.click(); });
    expect(container.querySelector('[data-testid="planner-donut"]')).not.toBeNull();
  });

  it("renders the empty face when the project has no packages", () => {
    renderShell({ packages: [] });
    expect(container.textContent).toContain("No packages in this project yet");
    expect(container.querySelector('[data-testid="planner-donut"]')).toBeNull();
    expect(container.querySelector('[data-testid="planner-status-legend"]')).toBeNull();
    const itemsBlock = container.querySelector('a[aria-label^="Total scope items"]');
    expect(itemsBlock.textContent).toContain("0");
  });
});
