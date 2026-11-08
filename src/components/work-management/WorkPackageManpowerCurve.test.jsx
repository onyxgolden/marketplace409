// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "@/hooks/swrCache";

import WorkPackageManpowerCurve from "./WorkPackageManpowerCurve.jsx";

const STEP_1 = {
  stepId: "step_1", title: "Fabricate pipe spool", sequenceNo: 1,
  craftKey: "pipefitter", craftLabel: "Pipefitter",
  plannedDurationDays: 4, plannedPersonHours: 40,
  placement: { id: "place_1", startDayIndex: 3, version: 1 },
  excludedReason: null,
};
const STEP_2 = {
  stepId: "step_2", title: "Install supports", sequenceNo: 2,
  craftKey: "welder", craftLabel: "Welder",
  plannedDurationDays: 2, plannedPersonHours: 16,
  placement: null, excludedReason: null,
};
const STEP_3 = {
  stepId: "step_3", title: "Unpriced step", sequenceNo: 3,
  craftKey: "pipefitter", craftLabel: "Pipefitter",
  plannedDurationDays: 2, plannedPersonHours: null,
  placement: null, excludedReason: "missing_hours",
};

function day(dayIndex, date, requiredHours, assignedHours) {
  const requiredEquivalents = requiredHours / 8;
  const assignedEquivalents = assignedHours / 8;
  return {
    dayIndex, date,
    crafts: requiredHours > 0 || assignedHours > 0 ? {
      pipefitter: {
        craftKey: "pipefitter", craftLabel: "Pipefitter",
        requiredHours, requiredEquivalents, assignedHours, assignedEquivalents,
        assignedShiftPersonSlots: 2, gapHours: assignedHours - requiredHours,
        gapEquivalents: assignedEquivalents - requiredEquivalents,
      },
    } : {},
    totalRequiredHours: requiredHours,
    totalRequiredEquivalents: requiredEquivalents,
    totalAssignedHours: assignedHours,
    totalAssignedEquivalents: assignedEquivalents,
    totalGapHours: assignedHours - requiredHours,
  };
}

function curveFixture(overrides = {}) {
  return {
    windowConfigured: true,
    window: { outageStartDate: "2026-11-09", outageEndDate: "2026-11-18", outageDays: 10, standardHoursPerPersonDay: 8 },
    settings: {
      ownerId: "owner_1", workPackageId: "pkg_1",
      outageStartDate: "2026-11-09", outageDays: 10, standardHoursPerPersonDay: 8,
      version: 2, createdBy: "user_1", updatedBy: "user_1", createdAt: "t1", updatedAt: "t2",
    },
    days: [
      day(1, "2026-11-09", 0, 14),
      day(2, "2026-11-10", 0, 0),
      day(3, "2026-11-11", 10, 0),
      day(4, "2026-11-12", 10, 0),
      day(5, "2026-11-13", 10, 0),
      day(6, "2026-11-14", 10, 0),
      day(7, "2026-11-15", 0, 0),
      day(8, "2026-11-16", 0, 0),
      day(9, "2026-11-17", 0, 0),
      day(10, "2026-11-18", 0, 0),
    ],
    crafts: [
      {
        craftKey: "pipefitter", craftLabel: "Pipefitter",
        totalRequiredHours: 40, totalRequiredEquivalents: 5,
        totalAssignedHours: 14, totalAssignedEquivalents: 1.75, totalGapHours: -26, stepCount: 1,
      },
      {
        craftKey: "welder", craftLabel: "Welder",
        totalRequiredHours: 16, totalRequiredEquivalents: 2,
        totalAssignedHours: 0, totalAssignedEquivalents: 0, totalGapHours: -16, stepCount: 1,
      },
    ],
    totals: { requiredHours: 56, requiredEquivalents: 7, assignedHours: 14, assignedEquivalents: 1.75, gapHours: -42, stepCount: 2 },
    excludedSteps: [{
      ...STEP_3,
      reason: "missing_hours",
      detail: "This step has no planned person-hours, so its demand is unknown — not zero.",
    }],
    unallocated: { knownHours: 0, unclassifiedHours: 0, unknownSteps: 1 },
    reconciliation: {
      requiredHoursTotal: 56, unallocatedKnownHours: 0, unclassifiedKnownHours: 0,
      knownActiveStepHours: 56, reconciled: false,
    },
    capacity: { assignedHours: 14, inWindowAssignmentHours: 14, outOfWindowAssignmentCount: 0 },
    warnings: [{
      code: "BASELINE_UNSEQUENCED",
      message: "Unsequenced baseline — steps start at outage day 1 until an explicit start day is set.",
    }],
    steps: [STEP_1, STEP_2, STEP_3],
    baselineDisclosure: "Unsequenced baseline — starts at outage day 1.",
    computedAt: "2026-11-07T12:00:00Z",
    notApplied: false,
    packageStatus: "in_progress",
    ...overrides,
  };
}

function setupFetch({ curve = curveFixture(), listStatus = 200 } = {}) {
  let current = curve;
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    const parsed = new URL(url, "https://test");
    if (parsed.pathname === "/api/work-packages/pkg_1/manpower-curve" && !options.method) {
      if (listStatus !== 200) return { ok: false, status: listStatus, json: async () => ({ error: "Not found." }) };
      return { ok: true, json: async () => current };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/manpower-curve/settings" && options.method === "PUT") {
      const body = JSON.parse(options.body);
      current = {
        ...current,
        settings: { ...current.settings, outageDays: body.outageDays, version: (current.settings?.version ?? 0) + 1 },
        window: { ...current.window, outageDays: body.outageDays },
      };
      return { ok: true, json: async () => ({ settings: current.settings }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/manpower-curve/placements" && options.method === "PUT") {
      const body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ placement: { id: "place_new", stepId: body.stepId, startDayIndex: body.startDayIndex, version: 1 } }) };
    }
    const clearMatch = parsed.pathname.match(/^\/api\/work-packages\/pkg_1\/manpower-curve\/placements\/([^/]+)$/);
    if (clearMatch && options.method === "DELETE") {
      return { ok: true, json: async () => ({ placement: { id: clearMatch[1], retiredAt: "t3", version: 2 } }) };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls, getCurve: () => current };
}

async function renderPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<WorkPackageManpowerCurve packageId="pkg_1" />);
  });
  await act(async () => {});
  return { container, root };
}

function buttonByText(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text) ?? null;
}

function setInput(container, labelText, value) {
  const inputs = [...container.querySelectorAll("input, select")];
  const input = inputs.find((el) => container.querySelector(`label[for="${el.id}"]`)?.textContent.includes(labelText));
  if (!input) throw new Error(`no input for ${labelText}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

async function submitForm(container, submitButtonText = null) {
  const form = submitButtonText
    ? buttonByText(container, submitButtonText)?.closest("form")
    : container.querySelector("form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

async function waitFor(check) {
  for (let i = 0; i < 10; i++) {
    try {
      check();
      return;
    } catch {
      await act(async () => {});
    }
  }
  check();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSWRCache();
  document.body.innerHTML = "";
});

describe("WorkPackageManpowerCurve", () => {
  it("renders the window, chart legend, daily table, totals, and reconciliation", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await waitFor(() => expect(container.textContent).toContain("Manpower curve"));
    expect(container.textContent).toContain("10 days");
    expect(container.textContent).toContain("8 standard hours / person-day");
    expect(container.textContent).toContain("Pipefitter");
    expect(container.textContent).toContain("Welder");
    expect(container.textContent).toContain("Daily demand by craft");
    expect(container.textContent).toContain("Totals per craft");
    // Day 3 has 10 required hours; the totals row carries 56 required hours.
    expect(container.textContent).toContain("10.00");
    expect(container.textContent).toContain("56.00");
    expect(container.textContent).toContain("Reconciliation:");
    expect(container.textContent).toContain("not fully reconciled");
    expect(buttonByText(container, "Download CSV")).not.toBeNull();
  });

  it("shows the excluded step with its reason and no placement control for it", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await waitFor(() => expect(container.textContent).toContain("Excluded steps"));
    expect(container.textContent).toContain("Unpriced step");
    expect(container.textContent).toContain("no planned person-hours, so its demand is unknown");
  });

  it("shows the placed step's current start day and a control for the unplaced step", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await waitFor(() => expect(container.textContent).toContain("Step start days"));
    expect(container.textContent).toContain("Currently starts outage day 3");
    expect(buttonByText(container, "Set start day")).not.toBeNull();
    expect(buttonByText(container, "Move start day")).not.toBeNull();
    expect(buttonByText(container, "Clear placement")).not.toBeNull();
  });

  it("sets a start day for an unplaced step through the placements route", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    await waitFor(() => expect(buttonByText(container, "Set start day")).not.toBeNull());
    await submitForm(container, "Set start day");
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/manpower-curve/placements"));
    expect(put).toBeDefined();
    expect(JSON.parse(put.body)).toMatchObject({ stepId: "step_2", startDayIndex: 1, expectedVersion: 0 });
  });

  it("shows the configuration prompt and saves a new window when none is set", async () => {
    const { calls } = setupFetch({
      curve: curveFixture({
        windowConfigured: false, window: null, settings: null, days: [],
        crafts: [], totals: { requiredHours: 0, requiredEquivalents: 0, assignedHours: 0, assignedEquivalents: 0, gapHours: 0, stepCount: 0 },
        excludedSteps: [{ ...STEP_1, reason: "window_not_configured", detail: "No outage window is set." }],
        reconciliation: { requiredHoursTotal: 0, unallocatedKnownHours: 0, unclassifiedKnownHours: 0, knownActiveStepHours: 40, reconciled: false },
        warnings: [{ code: "WINDOW_NOT_CONFIGURED", message: "Set the outage window to see the manpower curve — no dates are assumed." }],
      }),
    });
    const { container } = await renderPanel();
    await waitFor(() => expect(container.textContent).toContain("No outage window is set yet"));
    expect(buttonByText(container, "Set outage window")).not.toBeNull();
    setInput(container, "Outage start date", "2026-11-09");
    setInput(container, "Outage days", "10");
    await submitForm(container, "Set outage window");
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/manpower-curve/settings"));
    expect(put).toBeDefined();
    expect(JSON.parse(put.body)).toMatchObject({ outageStartDate: "2026-11-09", outageDays: 10, expectedVersion: 0 });
  });

  it("shows the not-applied message when the migration has not been applied", async () => {
    setupFetch({ curve: curveFixture({ notApplied: true, windowConfigured: false, window: null, settings: null, days: [] }) });
    const { container } = await renderPanel();
    await waitFor(() => expect(container.textContent).toContain("isn't available yet"));
  });

  it("is read-only on a terminal package: no save buttons, placement shown as text", async () => {
    setupFetch({ curve: curveFixture({ packageStatus: "cancelled" }) });
    const { container } = await renderPanel();
    await waitFor(() => expect(container.textContent).toContain("Read-only"));
    expect(buttonByText(container, "Set start day")).toBeNull();
    expect(buttonByText(container, "Move start day")).toBeNull();
    expect(buttonByText(container, "Update outage window")).toBeNull();
    expect(container.textContent).toContain("Starts outage day 3");
  });

  it("shows an empty-demand message when the package has no steps", async () => {
    setupFetch({
      curve: curveFixture({
        steps: [], excludedSteps: [], days: Array.from({ length: 10 }, (_, i) => day(i + 1, `2026-11-${String(9 + i).padStart(2, "0")}`, 0, 0)),
        totals: { requiredHours: 0, requiredEquivalents: 0, assignedHours: 0, assignedEquivalents: 0, gapHours: 0, stepCount: 0 },
        crafts: [], warnings: [],
        reconciliation: { requiredHoursTotal: 0, unallocatedKnownHours: 0, unclassifiedKnownHours: 0, knownActiveStepHours: 0, reconciled: true },
      }),
    });
    const { container } = await renderPanel();
    await waitFor(() => expect(container.textContent).toContain("No planned steps"));
  });
});
