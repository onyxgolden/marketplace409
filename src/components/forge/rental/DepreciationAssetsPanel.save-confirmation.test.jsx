// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import DepreciationAssetsPanel from "./DepreciationAssetsPanel";

const assets = [{
  id: "asset_1", description: "HVAC unit", category: "equipment",
  placedInService: "2026-01-15", costBasisCents: 1200000, method: "straight_line",
  usefulLifeMonths: 60, salvageValueCents: 0, notes: "",
}];

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/depreciation-assets/schedule")) {
      return { ok: true, json: async () => ({ report: null }) };
    }
    if (String(url).includes("/api/rental/depreciation-assets") && options?.method === "POST") {
      return { ok: true, json: async () => ({ success: true, asset: { id: "asset_2" } }) };
    }
    if (String(url).includes("/api/rental/depreciation-assets") && options?.method === "DELETE") {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (String(url).includes("/api/rental/depreciation-assets")) {
      return { ok: true, json: async () => ({ assets }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("DepreciationAssetsPanel save confirmations", () => {
  it("adding an asset confirms with its description", async () => {
    stubFetch();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<DepreciationAssetsPanel propertyId="308-paula" />); });
    await flush();
    const addButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "+ Add asset");
    expect(addButton).toBeTruthy();
    act(() => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const inputs = form.querySelectorAll("input");
    setInputValue(inputs[0], "Roof replacement");
    setInputValue(inputs[1], "2026-02-01");
    setInputValue(inputs[2], "18000");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Asset added: Roof replacement.");
  });

  it("deleting an asset confirms with its description", async () => {
    stubFetch();
    vi.stubGlobal("confirm", () => true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<DepreciationAssetsPanel propertyId="308-paula" />); });
    await flush();
    const deleteButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Delete");
    expect(deleteButton).toBeTruthy();
    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Asset deleted: HVAC unit.");
  });
});
