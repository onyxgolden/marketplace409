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
});
