// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingEvmDcmaModal from "./SchedulingEvmDcmaModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const REPORT = {
  success: true, baselineId: "baseline_1", asOfDate: "2026-01-10",
  evm: {
    bac: 1000, pv: 500, ev: 500, ac: 400, cv: 100, sv: 0, cpi: 1.25, spi: 1,
    eac: { atypical: 900, typical: 800, cpiSpi: 800 }, etc: 400, vac: 200,
  },
  dcma: {
    logic: { percentMissing: 10, pass: false },
    leadsAndLags: { leads: 1, leadsPass: false, lagPercent: 2, lagsPass: true },
    relationshipTypes: { fsPercent: 95, pass: true },
    hardConstraints: { percent: 0, pass: true },
    float: { highFloatPercent: 0, highFloatPass: true, negativeFloatCount: 0, negativeFloatPass: true },
    duration: { percent: 0, pass: true },
    invalidDates: { invalidCount: 0, pass: true },
    resources: { percent: 80 },
    missedTasks: { missedCount: 1, dueCount: 4 },
    baselineExecutionIndex: { bei: 0.75 },
    cpli: 0.9,
    criticalPathTest: { pass: true, shiftDays: 600, reason: null },
  },
};

describe("SchedulingEvmDcmaModal", () => {
  let mounted;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.restoreAllMocks();
  });

  it("loads baselines and the EVM/DCMA report, and displays key EVM figures and DCMA rows", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, baselines: [{ id: "baseline_1", name: "Approved plan", createdAt: "2026-01-01T00:00:00.000Z" }] }))
      .mockReturnValueOnce(jsonResponse(REPORT));
    mounted = mount(<SchedulingEvmDcmaModal projectId="p1" onClose={() => {}} />);
    await flush();

    expect(mounted.container.textContent).toContain("$1,000.00"); // BAC
    expect(mounted.container.textContent).toContain("$500.00"); // PV/EV
    expect(mounted.container.textContent).toContain("Logic");
    expect(mounted.container.textContent).toContain("Critical path test");
    expect(mounted.container.querySelectorAll("[data-scheduling-evm-baseline-select] option")).toHaveLength(1);
  });

  it("shows a fallback message when the report fails to load", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, baselines: [] }))
      .mockReturnValueOnce(jsonResponse({ error: "Unable to compute EVM/DCMA metrics for this project." }, false));
    mounted = mount(<SchedulingEvmDcmaModal projectId="p1" onClose={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("Unable to load EVM/DCMA data");
  });

  it("refetches the report when the as-of date changes", async () => {
    global.fetch.mockReturnValue(jsonResponse(REPORT));
    mounted = mount(<SchedulingEvmDcmaModal projectId="p1" onClose={() => {}} />);
    await flush();
    const callCountBefore = global.fetch.mock.calls.length;

    const dateInput = mounted.container.querySelector('input[type="date"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(dateInput, "2026-02-01");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    });

    expect(global.fetch.mock.calls.length).toBeGreaterThan(callCountBefore);
    const lastUrl = global.fetch.mock.calls.at(-1)[0];
    expect(lastUrl).toContain("asOfDate=2026-02-01");
  });
});
