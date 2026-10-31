// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import ReservationInventoryPanel from "./ReservationInventoryPanel";

async function mount() {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (options?.method === "POST") {
      return { ok: true, json: async () => ({ success: true }) };
    }
    return { ok: true, json: async () => ({ units: [{ id: "unit-1", label: "Site 1" }], inventory: [] }) };
  }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ReservationInventoryPanel />); });
  return { container, root };
}

function inputForLabel(form, prefix) {
  const label = [...form.querySelectorAll("label")].find((item) => item.textContent.startsWith(prefix));
  expect(label).toBeTruthy();
  return label.querySelector("input");
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  act(() => { setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("ReservationInventoryPanel save confirmation", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); mounted = null; }
    vi.unstubAllGlobals();
    clearSWRCache();
  });

  it("saving reservation inventory confirms with the space's public name", async () => {
    mounted = await mount();
    const form = mounted.container.querySelector("form");
    expect(form).toBeTruthy();
    const unitSelect = form.querySelector("select");
    setSelectValue(unitSelect, "unit-1");
    setInputValue(inputForLabel(form, "Public name"), "Lake Site 1");
    setInputValue(inputForLabel(form, "Nightly rate"), "85");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const banner = mounted.container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Reservation inventory saved for Lake Site 1.");
  });
});
