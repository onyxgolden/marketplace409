// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalVendorsPanel from "./RentalVendorsPanel";

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/vendors") && options?.method === "POST") {
      return { ok: true, json: async () => ({ vendor: { id: "v9", name: "Acme Plumbing" } }) };
    }
    if (String(url).includes("/api/rental/vendors/v9")) {
      return { ok: true, json: async () => ({ vendor: { id: "v9", name: "Acme Plumbing" }, bills: [], totals: { openCents: 0 } }) };
    }
    if (String(url).includes("/api/rental/vendors")) {
      return { ok: true, json: async () => ({ vendors: [] }) };
    }
    if (String(url).includes("/api/rental/vendor-bills")) {
      return { ok: true, json: async () => ({ bills: [] }) };
    }
    if (String(url).includes("/api/rental/chart-of-accounts")) {
      return { ok: true, json: async () => ({ accounts: [] }) };
    }
    if (String(url).includes("/api/rental")) {
      return { ok: true, json: async () => ({ units: [] }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

async function flush(times = 8) {
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

describe("RentalVendorsPanel save confirmations", () => {
  it("saving a vendor confirms with the vendor's name", async () => {
    stubFetch();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<RentalVendorsPanel />); });
    await flush();
    const addButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Add vendor");
    expect(addButton).toBeTruthy();
    act(() => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const nameInput = container.querySelector('input[placeholder="Acme Plumbing"]');
    expect(nameInput).toBeTruthy();
    setInputValue(nameInput, "Acme Plumbing");
    const form = nameInput.closest("form");
    expect(form).toBeTruthy();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Vendor saved: Acme Plumbing.");
  });
});
