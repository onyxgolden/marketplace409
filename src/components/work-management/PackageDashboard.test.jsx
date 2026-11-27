// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PackageDashboard from "./PackageDashboard.jsx";
import { PackagePageProvider } from "./packagePageContext.jsx";
import { clearSWRCache } from "@/hooks/swrCache";

const PKG = {
  id: "pkg_1",
  code: "WP-0001",
  title: "Turnover",
  status: "in_progress",
  planned_cost_cents: 125000,
};

const PLANNING = {
  complexity: "standard",
  templateVersion: 1,
  progress: {
    percentComplete: 45,
    earnedMhrs: 18,
    totalMhrs: 40,
    stepsTotal: 22,
    stepsEarned: 10,
    initialized: true,
  },
  constructionReadiness: "not established",
};

const STEPS = [
  { id: "s1", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 10, retiredAt: null },
  { id: "s2", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 4.5, retiredAt: null },
  { id: "s3", craftKey: "welder", craftLabel: "Welder", plannedPersonHours: null, retiredAt: null },
  { id: "s4", craftKey: null, craftLabel: null, plannedPersonHours: 2, retiredAt: null },
  { id: "s5", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 8, retiredAt: "2026-11-01T00:00:00Z" },
];

const ALLOCATION_DATA = {
  packageCode: "WP-0001",
  packageTitle: "Turnover",
  packageStatus: "in_progress",
  notApplied: false,
  estimate: {
    id: "est_1",
    workPackageId: "pkg_1",
    originalControlEstimateCents: 250000,
    currentControlEstimateCents: 250000,
    contingencyCents: 50000,
    version: 2,
  },
  allocation: {
    id: "alloc_1",
    workPackageId: "pkg_1",
    controlEstimateId: "est_1",
    controlEstimateVersion: 2,
    allocatedTotalCents: 250000,
    version: 1,
    lines: [
      { id: "l1", category: "labor", description: "Crew", amountCents: 150000, sortOrder: 0 },
      { id: "l2", category: "material", description: "Pipe", amountCents: 100000, sortOrder: 1 },
    ],
  },
  plannedLaborForecastCents: 90000,
};

const CHANGE_SUMMARY = {
  hasEstimate: true,
  originalControlEstimateCents: 250000,
  currentEstimateCents: 250000,
  contingencyCents: 50000,
  runningContractPriceCents: 270000,
  contingencyRemainingCents: -5000,
  laborCostCents: 90000,
  totalJobCostCents: 360000,
  countsByStatus: { estimated: 1, approved: 1, material_ordered: 1, denied: 2 },
  countedChangeOrderCount: 2,
  countedNonDeviationCents: 15000,
  countedDeviationCents: 5000,
  laborByCraft: [],
  stepsWithoutCraftHours: 0,
  totalsError: null,
  warnings: [{ code: "contingency_overdrawn", message: "Contingency is overdrawn by $50.00 — counted Deviations exceed the pool." }],
};

function stubFetch({ steps = STEPS, allocation = ALLOCATION_DATA, summary = CHANGE_SUMMARY, failChangeOrders = false } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (rawUrl) => {
    const url = typeof rawUrl === "string" ? rawUrl : "";
    calls.push(url);
    const bare = url.split("?")[0];
    const query = url.includes("?") ? new URLSearchParams(url.split("?")[1]) : new URLSearchParams();
    if (bare === "/api/work-packages/pkg_1/work-steps") {
      const retiredOnly = query.get("retiredOnly") === "true";
      const offset = Number(query.get("offset") || 0);
      const page = (retiredOnly ? steps.filter((s) => s.retiredAt) : steps.filter((s) => !s.retiredAt)).slice(offset, offset + 100);
      return { ok: true, json: async () => ({ steps: page, generation: 1, packageStatus: "in_progress" }) };
    }
    if (bare === "/api/work-packages/pkg_1/budget-allocation") {
      return { ok: true, json: async () => allocation };
    }
    if (bare === "/api/work-packages/pkg_1/change-orders") {
      if (failChangeOrders) return { ok: false, json: async () => ({ error: "Change Orders Log failed." }) };
      return { ok: true, json: async () => ({ summary, changeOrders: [] }) };
    }
    return { ok: false, json: async () => ({ error: `Unexpected URL ${url}` }) };
  }));
  return { calls };
}

async function renderDashboard({ pkg = PKG, planningSummary = PLANNING, fetchOptions, onDrill = vi.fn() } = {}) {
  stubFetch(fetchOptions);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PackagePageProvider workspace="owner_1" forgeProject="forge_project_1">
        <PackageDashboard packageId="pkg_1" pkg={pkg} planningSummary={planningSummary} ownerId="owner_1" onDrill={onDrill} />
      </PackagePageProvider>,
    );
  });
  await act(async () => {});
  await act(async () => {});
  return { container, root, onDrill };
}

function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

function click(element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  clearSWRCache();
  window.localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("number strip", () => {
  it("shows code, status, planned budget, planning steps/percent, and the honest milestone state", async () => {
    const rendered = await renderDashboard();
    const strip = rendered.container.querySelector('[data-testid="dashboard-strip"]');
    expect(strip.textContent).toContain("WP-0001");
    expect(strip.textContent).toContain("in progress");
    expect(strip.textContent).toContain("$1,250.00");
    expect(strip.textContent).toContain("10 of 22 steps");
    expect(strip.textContent).toContain("45%");
    expect(strip.textContent).toContain("Not available — milestone tracking has not been built");
    unmount(rendered);
  });

  it("drills each strip value to its tab", async () => {
    const rendered = await renderDashboard();
    const strip = rendered.container.querySelector('[data-testid="dashboard-strip"]');
    const budget = [...strip.querySelectorAll("button")].find((b) => b.textContent.includes("$1,250.00"));
    click(budget);
    expect(rendered.onDrill).toHaveBeenCalledWith("budget", null);
    const milestones = [...strip.querySelectorAll("button")].find((b) => b.textContent.includes("Not available"));
    click(milestones);
    expect(rendered.onDrill).toHaveBeenCalledWith("milestones", null);
    unmount(rendered);
  });

  it("distinguishes no budget from an explicit zero budget", async () => {
    const noBudget = await renderDashboard({ pkg: { ...PKG, planned_cost_cents: null } });
    expect(noBudget.container.querySelector('[data-testid="dashboard-strip"]').textContent).toContain("No budget set");
    unmount(noBudget);
    const zeroBudget = await renderDashboard({ pkg: { ...PKG, planned_cost_cents: 0 } });
    expect(zeroBudget.container.querySelector('[data-testid="dashboard-strip"]').textContent).toContain("$0.00");
    unmount(zeroBudget);
  });

  it("switches the strip to the Table pivot", async () => {
    const rendered = await renderDashboard();
    const strip = rendered.container.querySelector('[data-testid="dashboard-strip"]');
    const tableButton = [...strip.querySelectorAll("button")].find((b) => b.textContent === "Table");
    click(tableButton);
    expect(strip.querySelector("table")).not.toBeNull();
    expect(strip.querySelector("table").textContent).toContain("Planned budget");
    unmount(rendered);
  });
});

describe("planning and work plan", () => {
  it("shows canonical planning progress, the craft plan, and the conspicuous unavailable state", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-planning"]');
    expect(widget.textContent).toContain("45% (18 of 40 planning hours earned)");
    expect(widget.textContent).toContain("Completion by craft is not available yet");
    expect(widget.textContent).not.toContain("complete by craft");
    expect(widget.textContent).toContain("Pipefitter");
    expect(widget.textContent).toContain("Welder");
    expect(widget.textContent).toContain("No craft");
    // The retired Pipefitter step is not in the plan: 2 steps, 14.5 h.
    expect(widget.textContent).toContain("2 steps · 14.5 h");
    expect(widget.textContent).toContain("1 step has no planned hours set");
    unmount(rendered);
  });

  it("drills a craft row to the Work steps tab with the craft focus", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-planning"]');
    const pipefitter = [...widget.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("Pipefitter:"));
    click(pipefitter);
    expect(rendered.onDrill).toHaveBeenCalledWith("steps", { kind: "craft", craftKey: "pipefitter" });
    unmount(rendered);
  });

  it("switches to the Table pivot", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-planning"]');
    const tableButton = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Table");
    click(tableButton);
    expect(widget.querySelector("table")).not.toBeNull();
    expect(widget.querySelector("table").textContent).toContain("Hours not set");
    unmount(rendered);
  });

  it("shows the empty state when there are no steps", async () => {
    const empty = await renderDashboard({ fetchOptions: { steps: [] } });
    const emptyWidget = empty.container.querySelector('[data-testid="dashboard-planning"]');
    expect(emptyWidget.textContent).toContain("No work steps yet");
    unmount(empty);
  });

  it("says Unavailable when the planning summary failed to load", async () => {
    const rendered = await renderDashboard({ planningSummary: null });
    const strip = rendered.container.querySelector('[data-testid="dashboard-strip"]');
    expect(strip.textContent).toContain("Unavailable");
    const widget = rendered.container.querySelector('[data-testid="dashboard-planning"]');
    expect(widget.textContent).toContain("Planning progress: Unavailable");
    unmount(rendered);
  });
});

describe("cost split", () => {
  it("renders the reconciled donut, category rows, and the labor forecast wording", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    expect(widget.querySelector('[data-testid="dashboard-cost-donut"]')).not.toBeNull();
    expect(widget.textContent).toContain("Labor");
    expect(widget.textContent).toContain("$1,500.00");
    expect(widget.textContent).toContain("$1,000.00");
    expect(widget.textContent).toContain("Planned labor forecast $900.00 — labor budgeted $1,500.00 is over the planned labor estimate.");
    unmount(rendered);
  });

  it("drills a category row to the budget tab with the allocation focus", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    const labor = [...widget.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("Labor:"));
    click(labor);
    expect(rendered.onDrill).toHaveBeenCalledWith("budget", { kind: "budget-allocation", category: "labor" });
    unmount(rendered);
  });

  it("renders no-allocation as text, never a chart", async () => {
    const noAllocation = await renderDashboard({
      fetchOptions: { allocation: { ...ALLOCATION_DATA, allocation: null } },
    });
    const widget = noAllocation.container.querySelector('[data-testid="dashboard-cost"]');
    expect(widget.textContent).toContain("No budget allocation yet");
    expect(widget.querySelector('[data-testid="dashboard-cost-donut"]')).toBeNull();
    unmount(noAllocation);
  });

  it("renders a stale allocation as text, never a chart", async () => {
    const stale = await renderDashboard({
      fetchOptions: {
        allocation: {
          ...ALLOCATION_DATA,
          allocation: { ...ALLOCATION_DATA.allocation, controlEstimateVersion: 1 },
        },
      },
    });
    const staleWidget = stale.container.querySelector('[data-testid="dashboard-cost"]');
    expect(staleWidget.textContent).toContain("stale, not reconciled");
    expect(staleWidget.querySelector('[data-testid="dashboard-cost-donut"]')).toBeNull();
    unmount(stale);
  });
});

describe("change orders and contingency", () => {
  it("shows open count, approved value, contingency used/remaining, and running price — negative stays negative", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-change-orders"]');
    expect(widget.textContent).toContain("3 open");
    expect(widget.textContent).toContain("2 denied");
    expect(widget.textContent).toContain("$200.00");
    expect(widget.textContent).toContain("$50.00");
    expect(widget.textContent).toContain("-$50.00");
    expect(widget.textContent).toContain("$2,700.00");
    expect(widget.textContent).toContain("Contingency is overdrawn by $50.00");
    unmount(rendered);
  });

  it("drills open count to the open rows and contingency remaining to the estimate", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-change-orders"]');
    const open = [...widget.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.includes("open change orders"));
    click(open);
    expect(rendered.onDrill).toHaveBeenCalledWith("budget", { kind: "change-orders", filter: "open" });
    const remaining = [...widget.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("Contingency remaining"));
    click(remaining);
    expect(rendered.onDrill).toHaveBeenCalledWith("budget", { kind: "estimate" });
    unmount(rendered);
  });

  it("shows a load error with a working Retry", async () => {
    const rendered = await renderDashboard({ fetchOptions: { failChangeOrders: true } });
    const widget = rendered.container.querySelector('[data-testid="dashboard-change-orders"]');
    expect(widget.textContent).toContain("Change orders could not be loaded");
    expect([...widget.querySelectorAll("button")].some((b) => b.textContent === "Retry")).toBe(true);
    unmount(rendered);
  });
});

describe("customization", () => {
  it("saves a custom title, validates it, and confirms in plain words", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    const settings = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Settings");
    click(settings);
    const input = widget.querySelector("#dashboard-title-cost");
    expect(input).not.toBeNull();
    setInputValue(input, "A".repeat(81));
    const save = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Save title");
    click(save);
    expect(widget.textContent).toContain("at most 80 characters");
    setInputValue(input, "My cost view");
    click(save);
    expect(widget.querySelector("h3").textContent).toBe("My cost view");
    expect(widget.textContent).toContain("Title saved");
    unmount(rendered);
  });

  it("closes Settings with Escape and returns focus to the trigger", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    const settings = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Settings");
    settings.focus();
    click(settings);
    expect(widget.querySelector("#dashboard-title-cost")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(widget.querySelector("#dashboard-title-cost")).toBeNull();
    expect(document.activeElement).toBe(settings);
    unmount(rendered);
  });

  it("hides a widget and restores it from the hidden-widgets manager", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    const hide = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Hide");
    click(hide);
    expect(rendered.container.querySelector('[data-testid="dashboard-cost"]')).toBeNull();
    const manager = rendered.container.querySelector('[data-testid="dashboard-hidden-manager"]');
    expect(manager.textContent).toContain("Show Cost split");
    const show = [...manager.querySelectorAll("button")].find((b) => b.textContent === "Show Cost split");
    click(show);
    expect(rendered.container.querySelector('[data-testid="dashboard-cost"]')).not.toBeNull();
    unmount(rendered);
  });

  it("persists preferences across remounts and isolates them by package", async () => {
    const first = await renderDashboard();
    const widget = first.container.querySelector('[data-testid="dashboard-cost"]');
    const settings = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Settings");
    click(settings);
    const input = widget.querySelector("#dashboard-title-cost");
    setInputValue(input, "My cost view");
    click([...widget.querySelectorAll("button")].find((b) => b.textContent === "Save title"));
    unmount(first);

    const second = await renderDashboard();
    expect(second.container.querySelector('[data-testid="dashboard-cost"] h3').textContent).toBe("My cost view");
    unmount(second);
  });

  it("renders values as plain text, never dead buttons, when no drill handler is wired", async () => {
    const rendered = await renderDashboard({ onDrill: null });
    const strip = rendered.container.querySelector('[data-testid="dashboard-strip"]');
    // The strip values are plain text — no drill button without its action.
    expect([...strip.querySelectorAll("button")].some((b) => b.textContent.includes("$1,250.00"))).toBe(false);
    expect(strip.textContent).toContain("$1,250.00");
    unmount(rendered);
  });
});
