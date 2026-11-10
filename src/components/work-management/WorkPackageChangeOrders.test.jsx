// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function stubFetch({ summary = SUMMARY, changeOrders = [ORDER], packageStatus = "in_progress" } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
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
});
