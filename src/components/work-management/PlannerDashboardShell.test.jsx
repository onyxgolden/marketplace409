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

// D3 fix round 1: PlannerScopeBlockMap writes the canonical URL state
// via router.replace when a scopeBy/scopeView override is active.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import PlannerDashboardShell from "./PlannerDashboardShell.jsx";
import { summarizeCostSplit } from "@/domains/work-management/budgetAllocations";

const PACKAGES = [
  { id: "wp_1", code: "WP-0001", title: "Decker turnover", package_type: "rental_turn", priority: "normal", status: "draft", planned_start: "2026-10-05", planned_finish: "2026-10-20", percent_complete: 0, unit: "A", area: "Kitchen", system: "Plumbing", property_id: "1900-w-decker", planned_cost_cents: 150000, responsible_party: null, updated_at: "2026-10-01T00:00:00Z" },
  { id: "wp_2", code: "WP-0002", title: "Kent kitchen", package_type: "remodel", priority: "high", status: "in_progress", planned_start: null, planned_finish: null, percent_complete: 40, unit: null, area: null, system: null, property_id: "4800-kent-ave", planned_cost_cents: null, responsible_party: null, updated_at: "2026-10-02T00:00:00Z" },
  { id: "wp_3", code: "WP-0003", title: "Unassigned repairs", package_type: "maintenance_repair", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: null, area: null, system: null, property_id: null, planned_cost_cents: 25000, responsible_party: null, updated_at: "2026-10-03T00:00:00Z" },
];

const BASE_HREF = "/forge/work?forgeProject=unassigned";

// D2b cost fixture: wp_1 reconciled at $1,500.00 across all five
// categories (labor $600.00 = two lines $400.00 + $200.00 at the RPC
// level — the summary carries the aggregated totals), wp_3 reconciled
// at $250.00 across all five, wp_2 with no estimate. Five-way totals:
// labor $700.00, material $450.00, equipment $350.00, external
// services $180.00, rental $70.00 — $1,750.00, the strip total.
function reconciledCostEntry(estimateCents, categoryTotals, estimateId = "est_1") {
  return {
    packageId: null,
    estimate: { id: estimateId, version: 1, currentEstimateCents: estimateCents },
    allocation: { id: `alloc_${estimateId}`, version: 1, estimateId, estimateVersion: 1, categoryTotals },
    reconciled: true,
    reason: null,
  };
}
const COST_BY_PACKAGE = {
  wp_1: reconciledCostEntry(150000, { labor: 60000, material: 40000, equipment: 30000, external_services: 15000, rental: 5000 }),
  wp_2: { packageId: "wp_2", estimate: null, allocation: null, reconciled: false, reason: "no_estimate" },
  wp_3: reconciledCostEntry(25000, { labor: 10000, material: 5000, equipment: 5000, external_services: 3000, rental: 2000 }, "est_3"),
};
const COST_SUMMARY = summarizeCostSplit({ packages: PACKAGES, costByPackage: COST_BY_PACKAGE });

// The shorted variant for the §9 non-vacuous regression: wp_3's
// allocation went stale (estimate moved under it), so its $250.00
// leaves the five-way totals and reads as unallocated instead.
const COST_BY_PACKAGE_SHORTED = {
  ...COST_BY_PACKAGE,
  wp_3: {
    packageId: "wp_3",
    estimate: { id: "est_3", version: 2, currentEstimateCents: 25000 },
    allocation: { id: "alloc_est_3", version: 1, estimateId: "est_3", estimateVersion: 1, categoryTotals: { labor: 10000, material: 5000, equipment: 5000, external_services: 3000, rental: 2000 } },
    reconciled: false,
    reason: "stale",
  },
};
const COST_SUMMARY_SHORTED = summarizeCostSplit({ packages: PACKAGES, costByPackage: COST_BY_PACKAGE_SHORTED });

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
  // D2 progress fixture: wp_1 100% (complete), wp_2 40%, wp_3 0%
  // (not started) — total 1 of 3 complete, mean 46.7%. Planning % is
  // the credit-weighted % here, never the package percent_complete.
  const PLANNING = {
    wp_1: { percentComplete: 100, initialized: true },
    wp_2: { percentComplete: 40, initialized: true },
    wp_3: { percentComplete: 0, initialized: false },
  };

  function progressLinks() {
    return [...container.querySelectorAll('[data-testid="planner-progress-groups"] a')];
  }

  it("renders the strip: project, total control estimate, total scope items", () => {
    renderShell({ costSummary: COST_SUMMARY });
    expect(container.textContent).toContain("Unassigned packages");
    expect(container.textContent).toContain("Total control estimate");
    expect(container.textContent).toContain("$1,750.00");
    expect(container.textContent).toContain("Total scope items");
    // The strip total (3) and the legend counts (2 draft + 1 in progress)
    // reconcile: the slices add up to the strip.
    const donut = container.querySelector('[data-testid="planner-donut"]');
    expect(donut).not.toBeNull();
    expect(donut.getAttribute("aria-label")).toContain("draft 2 of 3");
    expect(donut.getAttribute("aria-label")).toContain("in progress 1 of 3");
  });

  it("shows — (never a false $0.00) when the cost split is unavailable or no estimate exists", () => {
    renderShell({ packages: PACKAGES.map((p) => ({ ...p, planned_cost_cents: null })) });
    expect(container.textContent).toContain("Cost split not available yet");
    const costBlock = container.querySelector('a[aria-label^="Total control estimate"]');
    expect(costBlock.textContent).toContain("—");
    renderShell({ costSummary: summarizeCostSplit({ packages: PACKAGES, costByPackage: {} }) });
    expect(container.textContent).toContain("No control estimate set yet");
    expect(container.querySelector('a[aria-label^="Total control estimate"]').textContent).toContain("—");
  });

  it("links every legend row to the status filter, preserving the scope", () => {
    renderShell();
    const links = legendLinks();
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe(`${BASE_HREF}&status=draft`);
    expect(links[1].getAttribute("href")).toBe(`${BASE_HREF}&status=in_progress`);
    // The strip's cost/items blocks clear the filter to the rows behind
    // the totals.
    expect(container.querySelector('a[aria-label^="Total control estimate"]').getAttribute("href")).toBe(BASE_HREF);
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
    expect(container.querySelector('[data-testid="planner-progress"]')).toBeNull();
    const itemsBlock = container.querySelector('a[aria-label^="Total scope items"]');
    expect(itemsBlock.textContent).toContain("0");
  });

  it("D2: renders the progress widget — total + system groups reconciling to the strip", () => {
    renderShell({ planningByPackage: PLANNING });
    expect(container.textContent).toContain("Planning progress");
    expect(container.textContent).toContain("Credit-weighted % from the 22-step planning checklist");
    // Total: 1 of 3 complete (only wp_1 at 100%), mean (100+40+0)/3 = 46.7%.
    const total = container.querySelector('[data-testid="planner-progress-total"] a');
    expect(total.getAttribute("aria-label")).toContain("All packages: 1 of 3 packages complete, 46.7% planning progress");
    expect(total.getAttribute("href")).toBe(BASE_HREF);
    // Default tab is System: Plumbing 1 of 1 at 100%, No system 2 at 20%.
    // The named group sorts before the missing-value bucket.
    const links = progressLinks();
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("aria-label")).toContain("Plumbing: 1 of 1 packages complete, 100.0% planning progress");
    expect(links[1].getAttribute("aria-label")).toContain("No system: 0 of 2 packages complete, 20.0% planning progress");
    // Group counts add up to the total: 1 + 2 = 3 packages, 1 complete.
    expect(container.textContent).toContain("draft 2 · in progress 1");
  });

  it("D2: progress drill-down links carry the group filter + tab, never narrowing filters", () => {
    renderShell({ planningByPackage: PLANNING });
    const links = progressLinks();
    expect(links[0].getAttribute("href")).toBe(`${BASE_HREF}&progressBy=system&system=Plumbing`);
    expect(links[1].getAttribute("href")).toBe(`${BASE_HREF}&progressBy=system&system=__none__`);
    for (const link of links) {
      expect(link.getAttribute("href")).not.toContain("status=");
      expect(link.getAttribute("href")).not.toContain("propertyId=");
      expect(link.getAttribute("href")).not.toContain("mode=");
    }
  });

  it("D2: marks the active group row and clears it on click", () => {
    renderShell({
      planningByPackage: PLANNING,
      activeDimension: "system",
      activeGroup: { dimension: "system", key: "Plumbing" },
    });
    const links = progressLinks();
    expect(links[0].getAttribute("aria-pressed")).toBe("true");
    // Clearing keeps the tab (progressBy=system) but drops the group.
    expect(links[0].getAttribute("href")).toBe(`${BASE_HREF}&progressBy=system`);
    expect(links[1].getAttribute("aria-pressed")).toBe("false");
    // The total row is not the active one while a group is filtered.
    expect(container.querySelector('[data-testid="planner-progress-total"] a').getAttribute("aria-pressed")).toBe("false");
  });

  it("D2: grouping tabs follow the active dimension and carry the tab in their href", () => {
    renderShell({ planningByPackage: PLANNING, activeDimension: "planner" });
    const tabs = [...container.querySelectorAll('[aria-label="Group progress by"] a')];
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual(["System", "Planner", "Unit"]);
    expect(tabs[1].getAttribute("aria-pressed")).toBe("true");
    expect(tabs[0].getAttribute("href")).toBe(`${BASE_HREF}&progressBy=system`);
    expect(tabs[2].getAttribute("href")).toBe(`${BASE_HREF}&progressBy=unit`);
    // Planner tab: all three packages are unassigned (no responsible_party).
    const links = progressLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("aria-label")).toContain("Unassigned: 1 of 3 packages complete, 46.7% planning progress");
    expect(links[0].getAttribute("href")).toBe(`${BASE_HREF}&progressBy=planner&planner=__unassigned__`);
  });

  it("D2: switches the progress pivot from table to bars and back", () => {
    renderShell({ planningByPackage: PLANNING });
    const widget = container.querySelector('[data-testid="planner-progress"]');
    expect(widget.querySelector('span[style*="width: 46.7%"]')).toBeNull();
    const barsButton = [...widget.querySelectorAll('[aria-label="Progress view"] button')].find((b) => b.textContent === "Bars");
    act(() => { barsButton.click(); });
    expect(barsButton.getAttribute("aria-pressed")).toBe("true");
    expect(widget.querySelector('span[style*="width: 46.7%"]')).not.toBeNull();
    const tableButton = [...widget.querySelectorAll('[aria-label="Progress view"] button')].find((b) => b.textContent === "Table");
    act(() => { tableButton.click(); });
    expect(widget.querySelector('span[style*="width: 46.7%"]')).toBeNull();
  });

  it("D2: shows the not-available note when planning data is missing, and the coverage note when rows lack a checklist", () => {
    renderShell();
    expect(container.textContent).toContain("Planning progress isn't available yet");
    renderShell({ planningByPackage: {} });
    expect(container.textContent).toContain("Planning % covers 0 of 3 packages");
    expect(container.textContent).toContain("3 have no checklist yet");
    const total = container.querySelector('[data-testid="planner-progress-total"] a');
    expect(total.getAttribute("aria-label")).toContain("0 of 3 packages complete, — planning progress");
  });

  describe("D2b cost split", () => {
    // §9 non-vacuous regression: two packages spanning all five
    // categories, one with multiple lines in a category — the exact
    // five totals must appear and sum to the strip total. A
    // implementation that merely sums whatever lines exist (including
    // stale ones) would show $700.00 labor here.
    it("shows the exact five totals and the strip equality", () => {
      renderShell({ costSummary: COST_SUMMARY });
      const widget = container.querySelector('[data-testid="planner-cost-split"]');
      expect(widget).not.toBeNull();
      expect(widget.textContent).toContain("Cost split");
      expect(widget.textContent).toContain("All 2 estimated packages reconciled.");
      // Row labels and amounts sit in separate spans, so textContent
      // joins them without a space ("Labor$700.00") — the link
      // aria-labels carry the spaced form; the donut label too.
      const donut = widget.querySelector('[data-testid="planner-cost-donut"]');
      expect(donut.getAttribute("aria-label")).toContain("Labor $700.00");
      expect(donut.getAttribute("aria-label")).toContain("Material $450.00");
      expect(donut.getAttribute("aria-label")).toContain("Equipment $350.00");
      expect(donut.getAttribute("aria-label")).toContain("External services $180.00");
      expect(donut.getAttribute("aria-label")).toContain("Rental $70.00");
      for (const [label, amount] of [["Labor", "$700.00"], ["Material", "$450.00"], ["Equipment", "$350.00"], ["External services", "$180.00"], ["Rental", "$70.00"]]) {
        const row = [...widget.querySelectorAll("a")].find((a) => a.getAttribute("aria-label").startsWith(label));
        expect(row.getAttribute("aria-label")).toContain(amount);
      }
      // The five rows add up to the strip total — $1,750.00 — exactly.
      expect(container.querySelector('a[aria-label^="Total control estimate"]').textContent).toContain("$1,750.00");
    });

    it("shorting one line removes the false chart and shows the precise incomplete amount", () => {
      renderShell({ costSummary: COST_SUMMARY_SHORTED });
      const widget = container.querySelector('[data-testid="planner-cost-split"]');
      // The false chart — wp_3's stale $250.00 still counted — is
      // absent: the full $700.00 labor total must not appear anywhere.
      expect(widget.textContent).not.toContain("$700.00");
      expect(widget.textContent).not.toContain("All 2 estimated packages reconciled.");
      expect(widget.textContent).toContain("Allocation incomplete — 1 of 2 estimated packages have no reconciled allocation, $250.00 unallocated. 1 of 2 reconciled.");
      // The rows now show only wp_1's reconciled lines.
      const laborRow = [...widget.querySelectorAll("a")].find((a) => a.getAttribute("aria-label").startsWith("Labor"));
      expect(laborRow.getAttribute("aria-label")).toContain("$600.00");
      const materialRow = [...widget.querySelectorAll("a")].find((a) => a.getAttribute("aria-label").startsWith("Material"));
      expect(materialRow.getAttribute("aria-label")).toContain("$400.00");
      // The strip still shows the control-estimate total — it is a sum
      // of estimates, not of allocations — so it stays $1,750.00.
      expect(container.querySelector('a[aria-label^="Total control estimate"]').textContent).toContain("$1,750.00");
      const link = [...widget.querySelectorAll("a")].find((a) => a.textContent === "Show unallocated packages");
      expect(link.getAttribute("href")).toBe(`${BASE_HREF}&allocation=unallocated`);
    });

    it("drills a category row down to exactly its packages, and claims the filter only when it is the only one", () => {
      renderShell({ costSummary: COST_SUMMARY });
      const widget = container.querySelector('[data-testid="planner-cost-split"]');
      const labor = [...widget.querySelectorAll("a")].find((a) => a.getAttribute("aria-label").startsWith("Labor"));
      expect(labor.getAttribute("href")).toBe(`${BASE_HREF}&costCategory=labor`);
      expect(labor.getAttribute("aria-pressed")).toBe("false");
      // Pure active: the row claims the filter and links back to clear it.
      renderShell({ costSummary: COST_SUMMARY, activeCostCategory: "labor" });
      const laborActive = [...container.querySelector('[data-testid="planner-cost-split"]').querySelectorAll("a")].find((a) => a.getAttribute("aria-label").startsWith("Labor"));
      expect(laborActive.getAttribute("aria-pressed")).toBe("true");
      expect(laborActive.getAttribute("href")).toBe(BASE_HREF);
      // Combined filter: the category is set but a status filter is
      // also active, so the row must NOT claim to be the filter —
      // the grid holds the intersection, not the category alone.
      renderShell({ costSummary: COST_SUMMARY, activeCostCategory: "labor", activeStatus: "draft", costWidgetCanClaimActive: false });
      const laborCombined = [...container.querySelector('[data-testid="planner-cost-split"]').querySelectorAll("a")].find((a) => a.getAttribute("aria-label").startsWith("Labor"));
      expect(laborCombined.getAttribute("aria-pressed")).toBe("false");
      expect(laborCombined.getAttribute("href")).toBe(`${BASE_HREF}&costCategory=labor`);
    });

    it("claims the unallocated filter only when it is the only one", () => {
      renderShell({ costSummary: COST_SUMMARY_SHORTED, activeAllocationFilter: "unallocated" });
      const link = [...container.querySelector('[data-testid="planner-cost-split"]').querySelectorAll("a")].find((a) => a.textContent === "Show unallocated packages");
      expect(link.getAttribute("aria-pressed")).toBe("true");
      expect(link.getAttribute("href")).toBe(BASE_HREF);
      renderShell({ costSummary: COST_SUMMARY_SHORTED, activeAllocationFilter: "unallocated", activeCostCategory: "labor", costWidgetCanClaimActive: false });
      const linkCombined = [...container.querySelector('[data-testid="planner-cost-split"]').querySelectorAll("a")].find((a) => a.textContent === "Show unallocated packages");
      expect(linkCombined.getAttribute("aria-pressed")).toBe("false");
      expect(linkCombined.getAttribute("href")).toBe(`${BASE_HREF}&allocation=unallocated`);
    });

    it("switches the cost pivot from donut to bars and back", () => {
      renderShell({ costSummary: COST_SUMMARY });
      const widget = container.querySelector('[data-testid="planner-cost-split"]');
      expect(widget.querySelector('span[style*="width: 40%"]')).toBeNull();
      const barsButton = [...widget.querySelectorAll('[aria-label="Cost view"] button')].find((b) => b.textContent === "Bars");
      act(() => { barsButton.click(); });
      expect(barsButton.getAttribute("aria-pressed")).toBe("true");
      expect(widget.querySelector('span[style*="width: 40%"]')).not.toBeNull();
      expect(widget.querySelector('[data-testid="planner-cost-donut"]')).toBeNull();
    });

    it("says so honestly when the cost split is unavailable or no estimate exists", () => {
      renderShell();
      expect(container.querySelector('[data-testid="planner-cost-split"]').textContent).toContain("Cost split isn't available yet");
      renderShell({ costSummary: summarizeCostSplit({ packages: PACKAGES, costByPackage: {} }) });
      expect(container.querySelector('[data-testid="planner-cost-split"]').textContent).toContain("No control estimates yet");
    });

    it("does not render the cost widget for an empty project", () => {
      renderShell({ packages: [] });
      expect(container.querySelector('[data-testid="planner-cost-split"]')).toBeNull();
    });
  });

  // D3 fix round 1 — live-evidence finding (f): the scope-by-status
  // donut legend truncated "Draft" to "D..." even at desktop width. The
  // status label must render in full and wrap, never truncate.
  it("scope-by-status legend labels render in full, never truncated with an ellipsis", () => {
    renderShell({ costSummary: COST_SUMMARY });
    const labels = [...container.querySelectorAll('[data-testid="planner-status-legend"] a > span > span:nth-child(2)')];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.className).not.toContain("truncate");
      expect(label.className).toContain("break-words");
    }
    expect(container.querySelector('[data-testid="planner-status-legend"]').textContent).toContain("draft");
    expect(container.querySelector('[data-testid="planner-status-legend"]').textContent).toContain("in progress");
    // Structural half of the fix: donut sits above the legend until xl,
    // so just above the lg breakpoint the legend gets the full card
    // width instead of the ~100px beside the donut.
    const legendRow = container.querySelector('[data-testid="planner-status-legend"]').parentElement;
    expect(legendRow.className).toContain("xl:flex-row");
    expect(legendRow.className).not.toContain("sm:flex-row");
  });
});
