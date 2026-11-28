// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PackageDashboard from "./PackageDashboard.jsx";
import { PackagePageProvider } from "./packagePageContext.jsx";
import { clearSWRCache } from "@/hooks/swrCache";
import { markSWRHydrated, resetSWRHydration } from "@/hooks/swrHydration";
import { preferenceKey, serializePreferences } from "@/application/work-management/packageDashboardPreferences.js";

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
  runningContractPriceCents: 265000,
  contingencyRemainingCents: -5000,
  laborCostCents: 90000,
  totalJobCostCents: 360000,
  countsByStatus: { estimated: 1, approved: 1, material_ordered: 1, denied: 2 },
  countedChangeOrderCount: 2,
  countedNonDeviationCents: 15000,
  countedDeviationCents: 55000,
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

async function renderDashboard({ pkg = PKG, planningSummary = PLANNING, fetchOptions, onDrill = vi.fn(), projectLabel = null } = {}) {
  stubFetch(fetchOptions);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PackagePageProvider workspace="owner_1" forgeProject="forge_project_1">
        <PackageDashboard packageId="pkg_1" pkg={pkg} planningSummary={planningSummary} ownerId="owner_1" onDrill={onDrill} projectLabel={projectLabel} />
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
    expect(widget.textContent).toContain("$700.00");
    expect(widget.textContent).toContain("$550.00");
    expect(widget.textContent).toContain("-$50.00");
    expect(widget.textContent).toContain("$2,650.00");
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

  it("Cancel and Reset are enabled controls in every state — never disabled", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    const settings = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Settings");
    click(settings);
    const input = widget.querySelector("#dashboard-title-cost");
    setInputValue(input, "A changed draft");
    let cancel = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    let reset = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Reset to defaults");
    expect(cancel.disabled).toBe(false);
    expect(reset.disabled).toBe(false);
    expect(cancel.getAttribute("aria-disabled")).toBeNull();
    expect(reset.getAttribute("aria-disabled")).toBeNull();
    // Save a nondefault title, reopen, and check again: Reset must be
    // enabled exactly when there is something nondefault to restore.
    click([...widget.querySelectorAll("button")].find((b) => b.textContent === "Save title"));
    click(settings);
    cancel = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    reset = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Reset to defaults");
    expect(cancel.disabled).toBe(false);
    expect(reset.disabled).toBe(false);
    unmount(rendered);
  });

  it("Cancel and Reset stay legible in dark mode — they carry dark variants, never light-only grey text", async () => {
    // Regression pin for the D4.1 evidence finding: in dark mode the
    // light-only slate-700 text on the slate-800 panel measured 1.48:1
    // contrast, so Cancel / Reset looked permanently disabled. jsdom
    // cannot compute contrast, so this test pins the dark-variant
    // classes; the real contrast numbers (light and dark) are proven
    // by the Chromium harness (see /tmp/d4-harness result files).
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    const settings = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Settings");
    click(settings);
    const cancel = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    const reset = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Reset to defaults");
    for (const button of [cancel, reset]) {
      expect(button.className).toContain("dark:text-slate-200");
      expect(button.className).toContain("dark:border-slate-600");
      expect(button.className).toContain("dark:hover:bg-slate-700");
    }
    const input = widget.querySelector("#dashboard-title-cost");
    expect(input.className).toContain("dark:bg-slate-800");
    expect(input.className).toContain("dark:text-slate-100");
    const label = widget.querySelector('label[for="dashboard-title-cost"]');
    expect(label.className).toContain("dark:text-slate-400");
    unmount(rendered);
  });

  it("Cancel discards an unsaved draft, closes Settings, and returns focus to the trigger", async () => {
    const rendered = await renderDashboard();
    const widget = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    const settings = [...widget.querySelectorAll("button")].find((b) => b.textContent === "Settings");
    settings.focus();
    click(settings);
    const input = widget.querySelector("#dashboard-title-cost");
    setInputValue(input, "Discarded draft title");
    click([...widget.querySelectorAll("button")].find((b) => b.textContent === "Cancel"));
    expect(widget.querySelector("#dashboard-title-cost")).toBeNull();
    expect(widget.querySelector("h3").textContent).toBe("Cost split");
    expect(document.activeElement).toBe(settings);
    // Nothing persisted: reopening shows the default title again.
    click(settings);
    expect(widget.querySelector("#dashboard-title-cost").value).toBe("Cost split");
    unmount(rendered);
  });

  it("Reset restores the actual default from a saved nondefault title, scoped to this widget", async () => {
    const rendered = await renderDashboard();
    const cost = rendered.container.querySelector('[data-testid="dashboard-cost"]');
    const strip = rendered.container.querySelector('[data-testid="dashboard-strip"]');
    // Give the strip widget its own custom title so Reset can prove
    // it only touches the widget it was opened for.
    const stripSettings = [...strip.querySelectorAll("button")].find((b) => b.textContent === "Settings");
    click(stripSettings);
    setInputValue(strip.querySelector("#dashboard-title-strip"), "My package strip");
    click([...strip.querySelectorAll("button")].find((b) => b.textContent === "Save title"));
    expect(strip.querySelector("h3").textContent).toBe("My package strip");

    const costSettings = [...cost.querySelectorAll("button")].find((b) => b.textContent === "Settings");
    click(costSettings);
    setInputValue(cost.querySelector("#dashboard-title-cost"), "My cost view");
    click([...cost.querySelectorAll("button")].find((b) => b.textContent === "Save title"));
    expect(cost.querySelector("h3").textContent).toBe("My cost view");

    // Reopen and reset: the cost title returns to the real default,
    // the strip's custom title survives, and the panel closes.
    click(costSettings);
    expect(cost.querySelector("#dashboard-title-cost").value).toBe("My cost view");
    click([...cost.querySelectorAll("button")].find((b) => b.textContent === "Reset to defaults"));
    expect(cost.querySelector("#dashboard-title-cost")).toBeNull();
    expect(cost.querySelector("h3").textContent).toBe("Cost split");
    expect(cost.textContent).toContain("reset to defaults");
    expect(strip.querySelector("h3").textContent).toBe("My package strip");
    const stored = JSON.parse(window.localStorage.getItem(
      preferenceKey({ ownerId: "owner_1", forgeProjectId: "forge_project_1", packageId: "pkg_1" }),
    ));
    expect(stored.widgets.cost.title).toBeNull();
    expect(stored.widgets.strip.title).toBe("My package strip");
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

describe("hydration-safe preferences", () => {
  function seedPrefs(keyParts, widgets) {
    window.localStorage.setItem(
      preferenceKey(keyParts),
      serializePreferences({ version: 1, widgets }),
    );
  }

  const SAVED_WIDGETS = {
    strip: { hidden: false, title: "My strip", pivot: "cards" },
    planning: { hidden: false, title: null, pivot: "table" },
    cost: { hidden: true, title: null, pivot: "donut" },
    changeOrders: { hidden: false, title: null, pivot: "strip" },
  };

  it("renders server markup from defaults despite saved preferences, hydrates without error, then applies them", async () => {
    try {
      resetSWRHydration();
      seedPrefs({ ownerId: "owner_1", forgeProjectId: "forge_project_1", packageId: "pkg_1" }, SAVED_WIDGETS);
      stubFetch();
      const element = (
        <PackagePageProvider workspace="owner_1" forgeProject="forge_project_1">
          <PackageDashboard packageId="pkg_1" pkg={PKG} planningSummary={PLANNING} ownerId="owner_1" onDrill={vi.fn()} />
        </PackagePageProvider>
      );
      const html = renderToString(element);
      // Server markup is defaults, never the stored prefs: the default
      // strip title renders, the saved cost-hidden state does not hide
      // the widget, and no Table pivot renders.
      expect(html).toContain(">Package</h3>");
      expect(html).not.toContain("My strip");
      expect(html).toContain('data-testid="dashboard-cost"');
      expect(html).not.toContain("<table");

      const container = document.createElement("div");
      document.body.appendChild(container);
      container.innerHTML = html;
      const errors = [];
      let root;
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
      });
      await act(async () => {});
      await act(async () => {});
      expect(errors).toEqual([]);
      // Saved prefs apply only after the hydration commit.
      expect(container.querySelector('[data-testid="dashboard-strip"] h3').textContent).toBe("My strip");
      expect(container.querySelector('[data-testid="dashboard-cost"]')).toBeNull();
      // Planning data loads only after the hydration boundary is marked.
      await act(async () => { markSWRHydrated(); });
      await act(async () => {});
      await act(async () => {});
      const planning = container.querySelector('[data-testid="dashboard-planning"]');
      expect(planning.querySelector("table")).not.toBeNull();
      expect(planning.querySelector("table").textContent).toContain("Hours not set");
      act(() => { root.unmount(); });
      container.remove();
    } finally {
      // The file's other tests rely on the setup-marked boundary.
      markSWRHydrated();
    }
  });

  it("isolates preferences by package, owner, and project when the key changes", async () => {
    seedPrefs(
      { ownerId: "owner_1", forgeProjectId: "forge_project_1", packageId: "pkg_1" },
      {
        strip: { hidden: false, title: "Alpha title", pivot: "cards" },
        planning: { hidden: false, title: null, pivot: "bars" },
        cost: { hidden: false, title: null, pivot: "donut" },
        changeOrders: { hidden: false, title: null, pivot: "strip" },
      },
    );
    seedPrefs(
      { ownerId: "owner_1", forgeProjectId: "forge_project_1", packageId: "pkg_2" },
      {
        strip: { hidden: false, title: "Beta title", pivot: "cards" },
        planning: { hidden: false, title: null, pivot: "bars" },
        cost: { hidden: true, title: null, pivot: "donut" },
        changeOrders: { hidden: false, title: null, pivot: "strip" },
      },
    );
    // Serve the same fixtures for either package id; the assertions
    // below are about preferences, not data.
    vi.stubGlobal("fetch", vi.fn(async (rawUrl) => {
      const url = typeof rawUrl === "string" ? rawUrl : "";
      const bare = url.split("?")[0];
      const query = url.includes("?") ? new URLSearchParams(url.split("?")[1]) : new URLSearchParams();
      if (bare.endsWith("/work-steps")) {
        const retiredOnly = query.get("retiredOnly") === "true";
        const offset = Number(query.get("offset") || 0);
        const page = (retiredOnly ? STEPS.filter((s) => s.retiredAt) : STEPS.filter((s) => !s.retiredAt)).slice(offset, offset + 100);
        return { ok: true, json: async () => ({ steps: page, generation: 1, packageStatus: "in_progress" }) };
      }
      if (bare.endsWith("/budget-allocation")) {
        return { ok: true, json: async () => ALLOCATION_DATA };
      }
      if (bare.endsWith("/change-orders")) {
        return { ok: true, json: async () => ({ summary: CHANGE_SUMMARY, changeOrders: [] }) };
      }
      return { ok: false, json: async () => ({ error: `Unexpected URL ${url}` }) };
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderFor = async ({ ownerId, forgeProject, packageId, code }) => {
      await act(async () => {
        root.render(
          <PackagePageProvider workspace={ownerId} forgeProject={forgeProject}>
            <PackageDashboard packageId={packageId} pkg={{ ...PKG, id: packageId, code }} planningSummary={PLANNING} ownerId={ownerId} onDrill={vi.fn()} />
          </PackagePageProvider>,
        );
      });
      await act(async () => {});
      await act(async () => {});
    };
    await renderFor({ ownerId: "owner_1", forgeProject: "forge_project_1", packageId: "pkg_1", code: "WP-0001" });
    expect(container.querySelector('[data-testid="dashboard-strip"] h3').textContent).toBe("Alpha title");
    // Package switch: the new package's saved prefs replace the old ones.
    await renderFor({ ownerId: "owner_1", forgeProject: "forge_project_1", packageId: "pkg_2", code: "WP-0002" });
    expect(container.querySelector('[data-testid="dashboard-strip"] h3').textContent).toBe("Beta title");
    expect(container.querySelector('[data-testid="dashboard-cost"]')).toBeNull();
    // Owner switch: no prefs saved for owner_2 — defaults return.
    await renderFor({ ownerId: "owner_2", forgeProject: "forge_project_1", packageId: "pkg_1", code: "WP-0001" });
    expect(container.querySelector('[data-testid="dashboard-strip"] h3').textContent).toBe("Package");
    expect(container.querySelector('[data-testid="dashboard-cost"]')).not.toBeNull();
    // Project switch: no prefs saved for forge_project_2 — defaults return.
    await renderFor({ ownerId: "owner_1", forgeProject: "forge_project_2", packageId: "pkg_1", code: "WP-0001" });
    expect(container.querySelector('[data-testid="dashboard-strip"] h3').textContent).toBe("Package");
    act(() => { root.unmount(); });
    container.remove();
  });
});

describe("D5 export CSV", () => {
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 1; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
    if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  let download = null;
  afterEach(() => {
    download?.restore();
    download = null;
  });

  function setupDownload() {
    const captured = { blob: null, anchors: [] };
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob) => { captured.blob = blob; return "blob:fake"; });
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      captured.anchors.push({ href: this.href, download: this.download });
    });
    download = {
      captured,
      restore() {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        clickSpy.mockRestore();
      },
    };
    return download;
  }

  function exportButton(container, label) {
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );
    expect(button).toBeDefined();
    return button;
  }

  async function clickExport(container, label) {
    const dl = setupDownload();
    await act(async () => {
      exportButton(container, label).click();
    });
    expect(dl.captured.anchors).toHaveLength(1);
    return { download: dl.captured.anchors[0].download, csvText: await dl.captured.blob.text() };
  }

  it("every detail widget has a labelled Export CSV control", async () => {
    const { container } = await renderDashboard({ projectLabel: "Fictional FCCU Sample Project" });
    for (const label of [
      "Export Package as CSV",
      "Export Planning and work plan as CSV",
      "Export Cost split as CSV",
      "Export Change orders and contingency as CSV",
    ]) {
      const button = exportButton(container, label);
      expect(button.disabled).toBe(false);
      expect(button.textContent).toContain("Export CSV");
    }
  });

  it("strip export downloads the six visible fields with the rendered values", async () => {
    const { container } = await renderDashboard({ projectLabel: "Fictional FCCU Sample Project" });
    const { download, csvText } = await clickExport(container, "Export Package as CSV");
    expect(download).toMatch(/^forge-planner-fictional-fccu-sample-project-0001-package-number-strip-\d{8}-\d{6}Z\.csv$/);
    const rows = parseCsv(csvText);
    const header = rows[0];
    const data = rows.slice(1);
    expect(data).toHaveLength(6);
    expect(data[0][header.indexOf("display_value")]).toBe("WP-0001");
    const budget = data.find((r) => r[header.indexOf("field_id")] === "budget");
    expect(budget[header.indexOf("value_cents")]).toBe("125000");
    expect(budget[header.indexOf("display_value")]).toBe("$1,250.00");
    const milestones = data.find((r) => r[header.indexOf("field_id")] === "milestones");
    expect(milestones[11]).toBe("unavailable");
  });

  it("planning export downloads the summary, craft rows, and the unavailable-completion state", async () => {
    const { container } = await renderDashboard({ projectLabel: "Fictional FCCU Sample Project" });
    const { csvText } = await clickExport(container, "Export Planning and work plan as CSV");
    const rows = parseCsv(csvText);
    const header = rows[0];
    const body = rows.slice(1);
    expect(body[0][0]).toBe("total");
    expect(body[0][header.indexOf("value_percent")]).toBe("45");
    expect(body[0][header.indexOf("display_value")]).toContain("45% (18 of 40 planning hours earned)");
    const crafts = body.filter((r) => r[0] === "data");
    expect(crafts).toHaveLength(3);
    const pipefitter = crafts.find((r) => r[header.indexOf("craft_key")] === "pipefitter");
    expect(pipefitter[header.indexOf("step_count")]).toBe("2");
    expect(pipefitter[header.indexOf("planned_hours")]).toBe("14.5");
    const state = body.find((r) => r[header.indexOf("craft_completion_state")] === "unavailable_no_crosswalk");
    expect(state[0]).toBe("state");
    expect(state[header.indexOf("craft_completion_state")]).toBe("unavailable_no_crosswalk");
    const hoursWarning = body.find((r) => r[0] === "state"
      && r[header.indexOf("display_value")].includes("no planned hours set"));
    expect(hoursWarning).toBeDefined();
    expect(hoursWarning[11]).toBe("partial");
  });

  it("cost export downloads five categories, the total, and the separately-labelled labor forecast", async () => {
    const { container } = await renderDashboard({ projectLabel: "Fictional FCCU Sample Project" });
    const { csvText } = await clickExport(container, "Export Cost split as CSV");
    const rows = parseCsv(csvText);
    const header = rows[0];
    const data = rows.slice(1).filter((r) => r[0] === "data");
    expect(data).toHaveLength(6);
    const labor = data.find((r) => r[header.indexOf("category_key")] === "labor");
    expect(labor[header.indexOf("value_cents")]).toBe("150000");
    const forecast = data.find((r) => r[header.indexOf("category_key")] === "labor_forecast_comparison");
    expect(forecast[header.indexOf("value_cents")]).toBe("90000");
    expect(forecast[header.indexOf("display_value")]).toContain("Comparison only");
    const total = rows.slice(1).find((r) => r[0] === "total");
    expect(total[header.indexOf("value_cents")]).toBe("250000");
  });

  it("cost export emits only a state row for a stale allocation, never five fabricated lines", async () => {
    const stale = {
      ...ALLOCATION_DATA,
      estimate: { ...ALLOCATION_DATA.estimate, version: 3 },
    };
    const { container } = await renderDashboard({
      projectLabel: "Fictional FCCU Sample Project",
      fetchOptions: { allocation: stale },
    });
    const { csvText } = await clickExport(container, "Export Cost split as CSV");
    const rows = parseCsv(csvText);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("state");
    expect(rows[1][11]).toBe("stale");
  });

  it("change orders export preserves negative contingency and includes warnings, with no status rows in strip pivot", async () => {
    const { container } = await renderDashboard({ projectLabel: "Fictional FCCU Sample Project" });
    const { csvText } = await clickExport(container, "Export Change orders and contingency as CSV");
    const rows = parseCsv(csvText);
    const header = rows[0];
    const body = rows.slice(1);
    const remaining = body.find((r) => r[header.indexOf("metric_id")] === "contingency_remaining");
    expect(remaining[header.indexOf("value_cents")]).toBe("-5000");
    // The strip pivot shows no status paragraph on the screen, so it
    // exports no status subgroup rows either.
    expect(body.filter((r) => r[header.indexOf("status_key")] !== "")).toHaveLength(0);
    const warning = body.find((r) => r[0] === "state");
    expect(warning[header.indexOf("warning_code")]).toBe("contingency_overdrawn");
  });

  it("change orders export includes status subgroups in lifecycle order in table pivot", async () => {
    window.localStorage.setItem(
      preferenceKey({ ownerId: "owner_1", forgeProjectId: "forge_project_1", packageId: "pkg_1" }),
      serializePreferences({
        version: 1,
        widgets: {
          strip: { hidden: false, title: null, pivot: "cards" },
          planning: { hidden: false, title: null, pivot: "bars" },
          cost: { hidden: false, title: null, pivot: "donut" },
          changeOrders: { hidden: false, title: null, pivot: "table" },
        },
      }),
    );
    const { container } = await renderDashboard({ projectLabel: "Fictional FCCU Sample Project" });
    const { csvText } = await clickExport(container, "Export Change orders and contingency as CSV");
    const rows = parseCsv(csvText);
    const header = rows[0];
    const body = rows.slice(1);
    const statusRows = body.filter((r) => r[header.indexOf("status_key")] !== "");
    expect(statusRows.map((r) => r[header.indexOf("status_key")])).toEqual(
      ["estimated", "approved", "material_ordered", "denied"],
    );
    const denied = statusRows.find((r) => r[header.indexOf("status_key")] === "denied");
    expect(denied[header.indexOf("value_count")]).toBe("2");
  });

  it("hidden widgets export from the hidden-widgets manager", async () => {
    const { container } = await renderDashboard({ projectLabel: "Fictional FCCU Sample Project" });
    click([...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Hide Cost split"));
    await act(async () => {});
    expect(container.querySelector('[data-testid="dashboard-hidden-manager"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dashboard-cost"]')).toBeNull();
    const { csvText } = await clickExport(container, "Export Cost split as CSV");
    const rows = parseCsv(csvText);
    const header = rows[0];
    const total = rows.slice(1).find((r) => r[0] === "total");
    expect(total[header.indexOf("value_cents")]).toBe("250000");
  });

  it("planning export stays disabled with a reason while the work steps load", async () => {
    vi.stubGlobal("fetch", vi.fn(async (rawUrl) => {
      const url = typeof rawUrl === "string" ? rawUrl : "";
      if (url.startsWith("/api/work-packages/pkg_1/work-steps")) return new Promise(() => {});
      if (url.startsWith("/api/work-packages/pkg_1/budget-allocation")) return { ok: true, json: async () => ALLOCATION_DATA };
      if (url.startsWith("/api/work-packages/pkg_1/change-orders")) return { ok: true, json: async () => ({ summary: CHANGE_SUMMARY, changeOrders: [] }) };
      return { ok: false, json: async () => ({ error: "Unexpected" }) };
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PackagePageProvider workspace="owner_1" forgeProject="forge_project_1">
          <PackageDashboard packageId="pkg_1" pkg={PKG} planningSummary={PLANNING} ownerId="owner_1" projectLabel="Fictional FCCU Sample Project" />
        </PackagePageProvider>,
      );
    });
    const button = exportButton(container, "Export Planning and work plan as CSV");
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("Export unavailable until the work steps load.");
    act(() => { root.unmount(); });
    container.remove();
  });

  it("change orders export stays disabled with a reason when the read fails", async () => {
    const { container } = await renderDashboard({
      projectLabel: "Fictional FCCU Sample Project",
      fetchOptions: { failChangeOrders: true },
    });
    const button = exportButton(container, "Export Change orders and contingency as CSV");
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("Export unavailable — the change orders could not be loaded.");
  });
});
