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
});
