// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearSWRCache } from "@/hooks/swrCache";

import WorkPackageChangeOrders from "./WorkPackageChangeOrders.jsx";

const SUMMARY = {
  hasEstimate: true,
  originalControlEstimateCents: 250000,
  currentEstimateCents: 250000,
  contingencyCents: 50000,
  runningContractPriceCents: 262000,
  countedNonDeviationCents: 12000,
  countedDeviationCents: 0,
  laborCostCents: 356000,
  totalJobCostCents: 618000,
  contingencyRemainingCents: 50000,
  countsByStatus: { estimated: 0, approved: 1, material_ordered: 0, requisition_filed: 0, po_requested: 0, po_approved: 0, denied: 0 },
  laborByCraft: [{
    craftKey: "pipefitter", craftLabel: "Pipefitter", plannedHours: 40, stepCount: 2,
    rateCentsPerHour: 8900, rateId: null, rateVersion: null, isDefaultRate: true, laborCostCents: 356000,
  }],
  stepsWithoutCraftHours: 0,
  warnings: [],
  notApplied: false,
};

const ORDER = {
  id: "forge_wco_1", workPackageId: "pkg_1", changeOrderNumber: 1,
  type: "bust", description: "Rework spool 7", costCode: null, afeNo: null,
  referenceContractNo: null, referencePoNumber: null, initiatorName: null,
  estimatedCostCents: 12000, approvedCostCents: 12000, actualCostCents: null,
  scheduleImpactDays: null, scheduleImpactNote: null, status: "approved",
  poNumber: null, denialReason: null,
  linkedStepId: null, linkedDrawingId: null, linkedTakeoffLineId: null,
  version: 2, retiredAt: null, retiredBy: null,
  createdBy: "user_9", updatedBy: "user_9", createdAt: "t0", updatedAt: "t0",
};

function stubFetch({ summary = SUMMARY, changeOrders = [ORDER], packageStatus = "in_progress", allocation = null } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    if (url === "/api/work-packages/pkg_1/budget-allocation" && allocation) {
      return { ok: true, json: async () => ({ ...allocation, packageStatus }) };
    }
    if (url === "/api/work-packages/pkg_1/change-orders" && options.method === "POST") {
      const created = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          changeOrder: { ...ORDER, id: "forge_wco_new", changeOrderNumber: 2, version: 1, ...created },
          packageStatus,
        }),
      };
    }
    if (url === "/api/work-packages/pkg_1/change-orders") {
      return { ok: true, json: async () => ({ summary, changeOrders, packageStatus }) };
    }
    if (url === "/api/work-packages/pkg_1/change-orders/forge_wco_1" && options.method === "PATCH") {
      const patch = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          changeOrder: { ...ORDER, version: ORDER.version + 1, estimatedCostCents: patch.estimatedCostCents ?? ORDER.estimatedCostCents },
          packageStatus,
        }),
      };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls };
}

function renderPanel(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkPackageChangeOrders packageId="pkg_1" {...props} />);
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WorkPackageChangeOrders", () => {
  it("renders the five summary figures and the status counts", async () => {
    stubFetch();
    const { container } = renderPanel();
    await settle();
    const text = container.textContent;
    expect(text).toContain("Change Orders Log");
    expect(text).toContain("$2,500.00"); // original control estimate
    expect(text).toContain("$2,620.00"); // running contract price (250,000 + 12,000 approved bust)
    expect(text).toContain("$3,560.00"); // planned labor: 40 pipefitter hours at $89
    expect(text).toContain("$6,180.00"); // current total job estimate
    expect(text).toContain("$500.00"); // contingency remaining
    expect(text).toContain("Approved: 1");
    expect(text).toContain("$89.00/hr"); // the default rate, shown in the labor table
    expect(text).toContain("Rework spool 7");
  });

  it("fills the page with blank rows so the next order is typed in place", async () => {
    stubFetch();
    const { container } = renderPanel();
    await settle();
    // Header row + 1 live order + 10 blank drafts.
    expect(container.querySelectorAll('[role="row"]').length).toBe(12);
  });

  it("shows the not-applied message when the migration is not live", async () => {
    stubFetch({ summary: { ...SUMMARY, notApplied: true }, changeOrders: [] });
    // A fresh refreshKey so the panel does not reuse the earlier
    // test's cached snapshot (the SWR key includes refreshKey).
    const { container } = renderPanel({ refreshKey: 1 });
    await settle();
    expect(container.textContent).toContain("The Change Orders Log isn't available yet");
    expect(container.textContent).not.toContain("$2,620.00");
  });

  it("is read-only on a closed package: notice, no blank rows, no estimate button", async () => {
    stubFetch({ packageStatus: "cancelled" });
    const { container } = renderPanel({ refreshKey: 2 });
    await settle();
    expect(container.textContent).toContain("This package is closed — the Change Orders Log is read-only.");
    expect(container.textContent).not.toContain("Set control estimate");
    expect(container.textContent).not.toContain("Edit control estimate");
    // Header row + 1 live order, no blank drafts.
    expect(container.querySelectorAll('[role="row"]').length).toBe(2);
  });

  it("commits a grid cell through PATCH with the panel reason and confirms in plain words", async () => {
    const { calls } = stubFetch();
    const { container } = renderPanel();
    await settle();

    setInputValue(container.querySelector("#co-panel-reason"), "Revised quote");
    const cell = container.querySelector('[aria-label="Estimated cost for change order 1"]');
    expect(cell).not.toBe(null);
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const input = container.querySelector('[aria-label="Estimated cost for change order 1"] input')
      || container.querySelector("input");
    // The editor input sits inside the grid cell.
    const editor = cell.querySelector("input");
    expect(editor).not.toBe(null);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(editor, "150.00");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch.url).toBe("/api/work-packages/pkg_1/change-orders/forge_wco_1");
    expect(patch.body).toEqual(expect.objectContaining({
      expectedVersion: 2, estimatedCostCents: 15000, reason: "Revised quote",
    }));
    expect(container.textContent).toContain("Change order #1 saved — Rework spool 7.");
    expect(input).toBeDefined();
  });

  it("D17: blocks creating a change order from a blank row until a reason is given", async () => {
    const { calls } = stubFetch();
    const { container } = renderPanel();
    await settle();

    // Reason box left empty on purpose.
    const cell = container.querySelector('[aria-label="Description for new change order 1"]');
    expect(cell).not.toBe(null);
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const editor = cell.querySelector("input");
    expect(editor).not.toBe(null);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(editor, "New scope item");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(container.textContent).toContain("Enter a reason for changes above first");
  });

  it("D17: creates the change order from a blank row once a reason is given", async () => {
    const { calls } = stubFetch();
    const { container } = renderPanel();
    await settle();

    setInputValue(container.querySelector("#co-panel-reason"), "Owner-requested scope addition");
    const cell = container.querySelector('[aria-label="Description for new change order 1"]');
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const editor = cell.querySelector("input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(editor, "New scope item");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    const post = calls.find((c) => c.method === "POST");
    expect(post).toBeDefined();
    // D17 fix round: the panel's reason box was required and validated
    // before this point, but the POST body never included it — the real
    // backend RPC already persists reason correctly (see the migration
    // test); this was purely never sent.
    expect(post.body).toEqual(expect.objectContaining({
      description: "New scope item",
      reason: "Owner-requested scope addition",
    }));
    expect(container.textContent).toContain("Change order #2 added — New scope item.");
  });
});

describe("WorkPackageChangeOrders D4 drill", () => {
  // The allocation the nested BudgetAllocation panel fetches when a
  // highlight is passed through: labor $1,500.00 / material $1,000.00.
  const ALLOCATION = {
    packageCode: "WP-0001",
    packageTitle: "Turnover",
    packageStatus: "in_progress",
    notApplied: false,
    estimate: {
      id: "est_1", workPackageId: "pkg_1",
      originalControlEstimateCents: 250000, currentControlEstimateCents: 250000,
      contingencyCents: 50000, version: 1,
    },
    allocation: {
      id: "forge_wba_1", workPackageId: "pkg_1", controlEstimateId: "est_1",
      controlEstimateVersion: 1, allocatedTotalCents: 250000, version: 1,
      lines: [
        { id: "forge_wbl_1", category: "labor", description: "Crew", amountCents: 150000, sortOrder: 0 },
        { id: "forge_wbl_2", category: "material", description: "Pipe", amountCents: 100000, sortOrder: 1 },
      ],
    },
    plannedLaborForecastCents: 90000,
  };

  it("narrows the rows to open change orders and clears back to all", async () => {
    const denied = { ...ORDER, id: "forge_wco_2", changeOrderNumber: 2, description: "Denied extra", status: "denied" };
    const estimated = { ...ORDER, id: "forge_wco_3", changeOrderNumber: 3, description: "Priced extra", status: "estimated" };
    clearSWRCache();
    stubFetch({ changeOrders: [ORDER, denied, estimated] });
    const onClear = vi.fn();
    const { container } = renderPanel({ focus: "open", onClearFocus: onClear, onBackToDashboard: () => {} });
    await settle();
    expect(container.querySelector('[data-testid="change-orders-focus-banner"]').textContent)
      .toContain("Showing only open change orders — 2 of 3.");
    expect(container.textContent).toContain("Rework spool 7");
    expect(container.textContent).toContain("Priced extra");
    expect(container.textContent).not.toContain("Denied extra");
    act(() => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Show all change orders")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("narrows the rows to counted Deviations only", async () => {
    const deviation = { ...ORDER, id: "forge_wco_2", changeOrderNumber: 2, type: "deviation", description: "Field deviation", status: "approved", estimatedCostCents: 5000, approvedCostCents: 5000 };
    const uncountedDeviation = { ...deviation, id: "forge_wco_3", changeOrderNumber: 3, description: "Priced deviation", status: "estimated" };
    clearSWRCache();
    stubFetch({ changeOrders: [ORDER, deviation, uncountedDeviation] });
    const { container } = renderPanel({ focus: "deviation", onClearFocus: () => {} });
    await settle();
    expect(container.querySelector('[data-testid="change-orders-focus-banner"]').textContent)
      .toContain("Showing only counted Deviation change orders — 1 of 3.");
    expect(container.textContent).toContain("Field deviation");
    expect(container.textContent).not.toContain("Priced deviation");
    expect(container.textContent).not.toContain("Rework spool 7");
  });

  it("highlights the control-estimate block for the estimate focus", async () => {
    clearSWRCache();
    stubFetch();
    const { container } = renderPanel({ focus: "estimate", onClearFocus: () => {} });
    await settle();
    const estimate = container.querySelector('[data-testid="change-orders-estimate"]');
    expect(estimate).not.toBeNull();
    expect(estimate.className).toContain("ring-2");
    expect(container.querySelector('[data-testid="change-orders-focus-banner"]').textContent)
      .toContain("Control estimate — the estimate the cost split reconciles against.");
  });

  it("passes a budget-category highlight through to the allocation", async () => {
    clearSWRCache();
    stubFetch({ allocation: ALLOCATION });
    const { container } = renderPanel({ highlightCategory: "labor", onClearHighlight: () => {} });
    await settle();
    await settle(); // the nested allocation panel fetches after the parent mounts
    const banner = container.querySelector('[data-testid="budget-allocation-highlight-banner"]');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain("Highlighting Labor — 1 of 2 lines.");
  });
});
