// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkPackageTakeoffScreen from "./WorkPackageTakeoffScreen";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function buttonWithText(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === text);
}

function emptySummary(pIdDrawingId) {
  return {
    summary: {
      pIdDrawingId, packageId: "pkg_1",
      totals: { lineCount: 0, totalQuantityByUnit: {}, byCategory: {} },
      shopFieldSplit: {
        shop: { lineCount: 0, totalQuantityByUnit: {}, byCategory: {} },
        field: { lineCount: 0, totalQuantityByUnit: {}, byCategory: {} },
      },
      fwFfw: { suggestedFieldWelds: 0, suggestedFfwCount: 0, ffwLines: [] },
    },
  };
}

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: async () => body });
}

describe("WorkPackageTakeoffScreen", () => {
  let mounted;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
  });

  it("shows the empty state when the package has no drawings yet", async () => {
    global.fetch = vi.fn(() => jsonResponse({ drawings: [] }));
    mounted = mount(<WorkPackageTakeoffScreen packageId="pkg_1" />);
    await flush();
    expect(mounted.container.textContent).toContain("No drawings yet");
  });

  it("adding a P&ID shows a plain-words success confirmation and lists it", async () => {
    let listedDrawings = [];
    global.fetch = vi.fn((url, options) => {
      if (url.endsWith("/drawings") && (!options || options.method === undefined)) {
        return jsonResponse({ drawings: listedDrawings });
      }
      if (url.endsWith("/drawings") && options?.method === "POST") {
        const created = { id: "dwg_pid1", drawingNumber: "P-101", drawingType: "p_id", title: null, pIdDrawingId: null };
        listedDrawings = [created];
        return jsonResponse({ drawing: created });
      }
      if (url.includes("/takeoff-lines") && !options?.method) {
        return jsonResponse({ lines: [] });
      }
      if (url.includes("/summary")) {
        return jsonResponse({
          summary: {
            pIdDrawingId: "dwg_pid1", packageId: "pkg_1",
            totals: { lineCount: 0, totalQuantityByUnit: {}, byCategory: {} },
            shopFieldSplit: {
              shop: { lineCount: 0, totalQuantityByUnit: {}, byCategory: {} },
              field: { lineCount: 0, totalQuantityByUnit: {}, byCategory: {} },
            },
            fwFfw: { suggestedFieldWelds: 0, suggestedFfwCount: 0, ffwLines: [] },
          },
        });
      }
      return jsonResponse({}, false);
    });

    mounted = mount(<WorkPackageTakeoffScreen packageId="pkg_1" />);
    await flush();

    const numberInput = [...mounted.container.querySelectorAll("input")].find((i) => i.placeholder === "P-101");
    const form = numberInput.closest("form");
    const submit = form.querySelector('button[type="submit"]');

    act(() => {
      numberInput.dispatchEvent(new Event("focus", { bubbles: true }));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(numberInput, "P-101");
      numberInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    act(() => { submit.click(); });
    for (let i = 0; i < 8; i += 1) await flush();

    expect(mounted.container.textContent).toContain('Saved — P&ID "P-101" was added.');
  });

  it("deleting a guarded drawing surfaces the 409 guard message instead of removing it", async () => {
    const listedDrawings = [{ id: "dwg_pid1", drawingNumber: "P-101", drawingType: "p_id", title: null, pIdDrawingId: null }];
    global.fetch = vi.fn((url, options) => {
      if (url.endsWith("/drawings") && (!options || options.method === undefined)) {
        return jsonResponse({ drawings: listedDrawings });
      }
      if (url.endsWith("/drawings/dwg_pid1") && options?.method === "DELETE") {
        return jsonResponse({ error: "This drawing still has takeoff lines — remove those first." }, false);
      }
      if (url.includes("/takeoff-lines") && !options?.method) {
        return jsonResponse({ lines: [] });
      }
      if (url.includes("/summary")) {
        return jsonResponse(emptySummary("dwg_pid1"));
      }
      return jsonResponse({}, false);
    });

    mounted = mount(<WorkPackageTakeoffScreen packageId="pkg_del" />);
    await flush();

    act(() => { buttonWithText(mounted.container, "Delete").click(); });
    for (let i = 0; i < 8; i += 1) await flush();

    expect(mounted.container.textContent).toContain("This drawing still has takeoff lines — remove those first.");
    expect(mounted.container.textContent).toContain("P-101");
  });

  function progressSummary() {
    return {
      summary: {
        packageId: "pkg_1",
        lines: [{
          lineId: "line_1", description: "6in CS pipe", baselineQuantity: 40, baselineUnit: "ft",
          installed: 30, remaining: 10, percentComplete: 75, overrun: false,
        }],
        package: {
          aggregatePercent: 75, cappedAggregateCompletion: 75,
          unitGroups: [{ unit: "ft", baseline: 40, installed: 30, lineCount: 1 }],
          overrunLineCount: 0,
        },
      },
    };
  }

  function progressFetch(getEntries, onVoid) {
    return vi.fn((url, options) => {
      if (url.endsWith("/drawings") && !options?.method) return jsonResponse({ drawings: [] });
      if (url.includes("/progress/summary") && !options?.method) return jsonResponse(progressSummary());
      if (url.endsWith("/progress") && !options?.method) return jsonResponse({ entries: getEntries() });
      if (url.endsWith("/progress") && options?.method === "POST") {
        const created = { id: "forge_wprg_9", takeoffLineId: "line_1", workDate: "2026-11-05", installedQuantity: 10, version: 1, voidedAt: null };
        return jsonResponse({ entry: created });
      }
      if (url.endsWith("/void") && options?.method === "POST") {
        const voided = { id: "forge_wprg_1", takeoffLineId: "line_1", workDate: "2026-11-01", installedQuantity: 10, version: 2, voidedAt: "2026-11-05T00:00:00Z" };
        if (onVoid) onVoid(voided);
        return jsonResponse({ entry: voided });
      }
      if (url.includes("/revisions")) return jsonResponse({ revisions: [] });
      return jsonResponse({}, false);
    });
  }

  it("slice 2: progress section stays collapsed until opened, then shows the summary", async () => {
    global.fetch = progressFetch(() => []);
    mounted = mount(<WorkPackageTakeoffScreen packageId="pkg_1" />);
    await flush();
    expect(global.fetch.mock.calls.some(([url]) => url.includes("/progress"))).toBe(false);
    act(() => { buttonWithText(mounted.container, "Daily progress").click(); });
    for (let i = 0; i < 8; i += 1) await flush();
    expect(mounted.container.textContent).toContain("6in CS pipe");
    expect(mounted.container.textContent).toContain("75%");
    expect(mounted.container.textContent).toContain("No progress entries yet.");
  });

  it("slice 2: recording a daily entry shows a plain-words confirmation", async () => {
    global.fetch = progressFetch(() => []);
    mounted = mount(<WorkPackageTakeoffScreen packageId="pkg_2" />);
    await flush();
    act(() => { buttonWithText(mounted.container, "Daily progress").click(); });
    for (let i = 0; i < 8; i += 1) await flush();

    const submit = buttonWithText(mounted.container, "Record progress");
    const form = submit.closest("form");
    const quantityInput = form.querySelector('input[type="number"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(quantityInput, "10");
      quantityInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    act(() => { submit.click(); });
    for (let i = 0; i < 8; i += 1) await flush();

    expect(mounted.container.textContent).toContain('Saved — 10 ft installed on 2026-11-05 for "6in CS pipe".');
  });

  it("slice 2: voiding an entry marks it voided and keeps it in history", async () => {
    let listedEntries = [{ id: "forge_wprg_1", takeoffLineId: "line_1", workDate: "2026-11-01", installedQuantity: 10, version: 1, voidedAt: null }];
    global.fetch = progressFetch(() => listedEntries, (voided) => { listedEntries = [voided]; });
    mounted = mount(<WorkPackageTakeoffScreen packageId="pkg_3" />);
    await flush();
    act(() => { buttonWithText(mounted.container, "Daily progress").click(); });
    for (let i = 0; i < 8; i += 1) await flush();

    act(() => { buttonWithText(mounted.container, "Void").click(); });
    await flush();
    act(() => { buttonWithText(mounted.container, "Confirm void").click(); });
    for (let i = 0; i < 8; i += 1) await flush();

    expect(mounted.container.textContent).toContain('Voided — the 2026-11-01 entry for "6in CS pipe" no longer counts toward totals');
    expect(mounted.container.textContent).toContain("Voided");
  });

  it("slice 7: entries on IFA-linked lines carry a PRE-IFC flag; IFC-linked entries do not", async () => {
    const listedEntries = [
      { id: "forge_wprg_1", takeoffLineId: "line_ifa", workDate: "2026-11-01", installedQuantity: 10, version: 1, voidedAt: null },
      { id: "forge_wprg_2", takeoffLineId: "line_ifc", workDate: "2026-11-02", installedQuantity: 5, version: 1, voidedAt: null },
    ];
    global.fetch = vi.fn((url, options) => {
      if (url.includes("/drawings/readiness") && !options?.method) {
        return jsonResponse({
          drawings: [
            { drawingId: "dwg_ifa", badge: "IFA — In review", constructionUsable: false, preliminary: true },
            { drawingId: "dwg_ifc", badge: "IFC — Issued for construction", constructionUsable: true, preliminary: false },
          ],
        });
      }
      if (url.endsWith("/drawings") && !options?.method) return jsonResponse({ drawings: [] });
      if (url.includes("/progress/summary") && !options?.method) {
        return jsonResponse({
          summary: {
            packageId: "pkg_4",
            lines: [
              { lineId: "line_ifa", drawingId: "dwg_ifa", description: "IFA pipe", baselineQuantity: 40, baselineUnit: "ft", installed: 10, remaining: 30, percentComplete: 25, overrun: false },
              { lineId: "line_ifc", drawingId: "dwg_ifc", description: "IFC pipe", baselineQuantity: 20, baselineUnit: "ft", installed: 5, remaining: 15, percentComplete: 25, overrun: false },
            ],
            package: {
              aggregatePercent: 25, cappedAggregateCompletion: 25,
              unitGroups: [{ unit: "ft", baseline: 60, installed: 15, lineCount: 2 }],
              overrunLineCount: 0,
            },
          },
        });
      }
      if (url.endsWith("/progress") && !options?.method) return jsonResponse({ entries: listedEntries });
      if (url.includes("/takeoff-lines") && !options?.method) return jsonResponse({ lines: [] });
      if (url.includes("/revisions")) return jsonResponse({ revisions: [] });
      return jsonResponse({}, false);
    });
    mounted = mount(<WorkPackageTakeoffScreen packageId="pkg_4" />);
    await flush();
    act(() => { buttonWithText(mounted.container, "Daily progress").click(); });
    for (let i = 0; i < 8; i += 1) await flush();

    // Exactly one PRE-IFC tag: the IFA entry. The IFC entry has
    // none, and the totals are untouched (10 + 5 installed).
    expect(mounted.container.textContent.match(/PRE-IFC/g)).toHaveLength(1);
    expect(mounted.container.textContent).toContain("IFA pipe");
    expect(mounted.container.textContent).toContain("IFC pipe");
    expect(mounted.container.textContent).toContain("15 of 60 ft");
  });

  // D15: adding a takeoff line never told the independently-cached Daily
  // progress panel (its own useStaleWhileRevalidate instance, keyed by
  // progress-summary/progress-entries) that the lines it summarizes had
  // changed. An already-open panel kept showing "No takeoff lines yet"
  // after a line was added elsewhere on the same screen.
  it("D15: the Daily progress panel picks up a newly added takeoff line without a reload", async () => {
    const drawing = { id: "dwg_pid1", drawingNumber: "P-101", drawingType: "p_id", title: null, pIdDrawingId: null };
    let lines = [];
    let summaryHasLine = false;
    global.fetch = vi.fn((url, options) => {
      if (url.endsWith("/drawings") && !options?.method) return jsonResponse({ drawings: [drawing] });
      if (url.includes("/takeoff-lines") && !options?.method) return jsonResponse({ lines });
      if (url.includes("/takeoff-lines") && options?.method === "POST") {
        const created = {
          id: "line_1", lineNo: 1, description: "6in CS pipe", materialSpec: null, sizeLabel: null,
          quantity: 10, unit: "ft", category: "pipe", fabLocation: "shop", fieldWeldCount: 0, requiresFieldFit: false,
        };
        lines = [created];
        summaryHasLine = true;
        return jsonResponse({ line: created });
      }
      if (url.includes("/drawings/readiness")) return jsonResponse({ drawings: [] });
      if (url.includes("/progress/summary") && !options?.method) {
        if (summaryHasLine) return jsonResponse(progressSummary());
        return jsonResponse({
          summary: { packageId: "pkg_1", lines: [], package: { aggregatePercent: null, cappedAggregateCompletion: null, unitGroups: [], overrunLineCount: 0 } },
        });
      }
      if (url.endsWith("/progress") && !options?.method) return jsonResponse({ entries: [] });
      return jsonResponse({}, false);
    });

    // A packageId unused by any other test in this file: useStaleWhileRevalidate
    // caches by key in a module-level store that outlives a single test.
    mounted = mount(<WorkPackageTakeoffScreen packageId="pkg_d15_takeoff" />);
    await flush();

    // Open the Daily progress panel first, while there are no lines yet.
    act(() => { buttonWithText(mounted.container, "Daily progress").click(); });
    for (let i = 0; i < 8; i += 1) await flush();
    expect(mounted.container.textContent).toContain("No takeoff lines yet.");

    // Open the drawing and add a line through the sibling takeoff-lines form.
    act(() => { buttonWithText(mounted.container, "P&ID — P-101").click(); });
    for (let i = 0; i < 4; i += 1) await flush();

    const descriptionInput = [...mounted.container.querySelectorAll("input")].find((i) => i.placeholder === "Description");
    const quantityInput = [...mounted.container.querySelectorAll("input")].find((i) => i.placeholder === "Qty");
    const unitInput = [...mounted.container.querySelectorAll("input")].find((i) => i.placeholder === "Unit (ft, ea…)");
    function setValue(el, value) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    act(() => {
      setValue(descriptionInput, "6in CS pipe");
      setValue(quantityInput, "10");
      setValue(unitInput, "ft");
    });
    await flush();
    const addLineForm = descriptionInput.closest("form");
    act(() => { addLineForm.querySelector('button[type="submit"]').click(); });
    for (let i = 0; i < 10; i += 1) await flush();

    // No further click on "Daily progress" -- it was already open. It must
    // now reflect the new line on its own.
    expect(mounted.container.textContent).toContain("6in CS pipe");
    expect(mounted.container.textContent).not.toContain("No takeoff lines yet.");
  });
});
