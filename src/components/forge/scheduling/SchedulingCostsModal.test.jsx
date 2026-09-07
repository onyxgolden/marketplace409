// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingCostsModal from "./SchedulingCostsModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BLOCKS = [{ id: "b1", taskCode: "A1010", label: "Framing" }];

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}
function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount({ container, root }) {
  act(() => root.unmount());
  container.remove();
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("SchedulingCostsModal", () => {
  let mounted;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.restoreAllMocks();
  });

  it("shows project-level budgeted/actual/remaining totals", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({
      success: true, byBlock: [], overallocations: [],
      project: { budgeted_cost: 2500, actual_cost: 1100, remaining_cost: 1400 },
    }));
    mounted = mount(<SchedulingCostsModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/p1/cost-rollup");
    expect(mounted.container.textContent).toContain("$2,500.00");
    expect(mounted.container.textContent).toContain("$1,100.00");
    expect(mounted.container.textContent).toContain("$1,400.00");
  });

  it("shows an over-allocation warning when one is reported", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({
      success: true, byBlock: [], project: { budgeted_cost: 0, actual_cost: 0, remaining_cost: 0 },
      overallocations: [{ resource_id: "resource_1", date: "2026-01-05", allocated_units: 16, max_units_per_day: 8, over_by: 8 }],
    }));
    mounted = mount(<SchedulingCostsModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("Over-allocated resources");
    expect(mounted.container.textContent).toContain("resource_1 on 2026-01-05");
  });

  it("labels each row's task using the board's block labels", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({
      success: true, overallocations: [], project: { budgeted_cost: 500, actual_cost: 0, remaining_cost: 500 },
      byBlock: [{ block_id: "b1", task_code: "A1010", budgeted_cost: 500, actual_cost: 0, remaining_cost: 500 }],
    }));
    mounted = mount(<SchedulingCostsModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("A1010 Framing");
  });

  it("shows a fallback message when the cost rollup fails to load", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ error: "Unable to compute cost rollup for this project." }, false));
    mounted = mount(<SchedulingCostsModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("Unable to load cost data");
  });

  it("shows Cost by code, and clicking a code refetches the rollup filtered to it", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse({
        success: true, overallocations: [], project: { budgeted_cost: 2500, actual_cost: 0, remaining_cost: 2500 },
        byBlock: [{ block_id: "b1", task_code: "A1010", budgeted_cost: 2500, actual_cost: 0, remaining_cost: 2500 }],
        byCostAccount: [
          { cost_account_id: "acct_po", code: "PO-4521", name: "Steel supplier", budgeted_cost: 2000, actual_cost: 0, remaining_cost: 2000 },
          { cost_account_id: null, code: null, name: "Uncoded", budgeted_cost: 500, actual_cost: 0, remaining_cost: 500 },
        ],
      }))
      .mockReturnValueOnce(jsonResponse({
        success: true, overallocations: [], project: { budgeted_cost: 2000, actual_cost: 0, remaining_cost: 2000 },
        byBlock: [{ block_id: "b1", task_code: "A1010", budgeted_cost: 2000, actual_cost: 0, remaining_cost: 2000 }],
      }))
      .mockReturnValueOnce(jsonResponse({
        success: true, overallocations: [], project: { budgeted_cost: 2500, actual_cost: 0, remaining_cost: 2500 },
        byBlock: [{ block_id: "b1", task_code: "A1010", budgeted_cost: 2500, actual_cost: 0, remaining_cost: 2500 }],
        byCostAccount: [{ cost_account_id: "acct_po", code: "PO-4521", name: "Steel supplier", budgeted_cost: 2000, actual_cost: 0, remaining_cost: 2000 }],
      }));
    mounted = mount(<SchedulingCostsModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();

    expect(mounted.container.textContent).toContain("Cost by code");
    expect(mounted.container.textContent).toContain("PO-4521");
    expect(mounted.container.textContent).toContain("Uncoded");

    const codeButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent.includes("PO-4521"));
    await act(async () => { codeButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(global.fetch).toHaveBeenLastCalledWith("/api/forge/scheduling/p1/cost-rollup?costAccountId=acct_po");
    expect(mounted.container.textContent).toContain("Filtered to cost code PO-4521");
    expect(mounted.container.textContent).toContain("$2,000.00");

    const clearButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Clear filter");
    await act(async () => { clearButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(mounted.container.textContent).not.toContain("Filtered to cost code");
  });
});
