// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalSetupPanel from "./RentalSetupPanel";
import { clearSWRCache } from "../../../hooks/swrCache";

const unit = { id: "unit_1", property_id: "prop_1", label: "1218 Wagner", status: "active" };

function stubFetch(postHandler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/rental" && options?.method === "POST") {
      const body = JSON.parse(options.body);
      if (postHandler) return postHandler(body);
      return { ok: true, json: async () => ({ unit: { id: "unit_1", label: "1218 Wagner" } }) };
    }
    if (url === "/api/rental") {
      return { ok: true, json: async () => ({ units: [unit], leases: [], leaseMemberships: [], tenants: [], schedules: [], openCharges: [] }) };
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
  // StructuredAddressFields renders the state as a <select>, the rest as inputs.
  const prototype = input instanceof window.HTMLSelectElement
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<RentalSetupPanel />); });
  return { container, root };
}

// RentalRecordActions renders a <details>/<summary> disclosure, not a
// button: the action buttons are in the DOM regardless of open state, so the
// menu item can be clicked directly.
function openPropertyActions() {}

function clickMenuItem(container, text) {
  const item = [...container.querySelectorAll("button, [role='menuitem']")].find((el) => el.textContent.trim() === text);
  expect(item).toBeTruthy();
  act(() => { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearSWRCache();
  document.body.innerHTML = "";
});

describe("RentalSetupPanel save confirmations", () => {
  it("editing a unit confirms on the detail view with the label, never the raw id", async () => {
    stubFetch();
    vi.stubGlobal("confirm", () => true);
    const { container } = mount();
    await flush();
    openPropertyActions(container);
    clickMenuItem(container, "Edit property details");
    const form = container.querySelector('form[aria-label="Edit 1218 Wagner"]');
    expect(form).toBeTruthy();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const detail = container.querySelector("[data-rental-unit-detail]");
    expect(detail).toBeTruthy();
    const banner = detail.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Unit saved: 1218 Wagner.");
    expect(banner.textContent).not.toContain("unit_1");
  });

  it("creating a unit confirms without any raw database id", async () => {
    stubFetch((body) => ({ ok: true, json: async () => ({ unit: { id: "unit_9", label: "4225 Barnhill" } }) }));
    vi.stubGlobal("confirm", () => true);
    const { container } = mount();
    await flush();
    const addButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "+ Add a new property / unit");
    expect(addButton).toBeTruthy();
    act(() => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const form = [...container.querySelectorAll("form")].find((item) => item.textContent.includes("Create a new property / unit"));
    expect(form).toBeTruthy();
    const byName = (name) => form.querySelector(`input[name="${name}"], select[name="${name}"]`);
    setInputValue(byName("propertyId"), "prop_9");
    setInputValue(byName("label"), "4225 Barnhill");
    setInputValue(byName("addressStreet"), "4225 Barnhill Dr");
    setInputValue(byName("addressCity"), "Orange");
    setInputValue(byName("addressState"), "TX");
    setInputValue(byName("addressZip"), "77630");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Unit saved: 4225 Barnhill.");
    expect(banner.textContent).not.toContain("unit_9");
    expect(banner.textContent).not.toContain("ID:");
  });

  it("archiving a unit confirms on the detail view", async () => {
    stubFetch();
    const { container } = mount();
    await flush();
    openPropertyActions(container);
    clickMenuItem(container, "Archive duplicate / inactive property");
    const confirmButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Confirm archive");
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const detail = container.querySelector("[data-rental-unit-detail]");
    expect(detail).toBeTruthy();
    const banner = detail.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("1218 Wagner archived.");
  });
});
