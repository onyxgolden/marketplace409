// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalReceiptsPanel from "./RentalReceiptsPanel";

function stubFetch({ receipts = [], matches = [] } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/receipts") && options?.method === "POST" && !String(url).includes("/apply") && !String(url).includes("/extract")) {
      return { ok: true, json: async () => ({ receipt: { id: "r2", vendorNameHint: "Acme Plumbing", status: "inbox", receiptDate: "2026-10-04", amountCents: 4550 } }) };
    }
    if (String(url).includes("/matches")) {
      return { ok: true, json: async () => ({ matches }) };
    }
    if (String(url).includes("/apply")) {
      return { ok: true, json: async () => ({ billId: "b1", paymentId: "p1" }) };
    }
    if (String(url).includes("/api/rental/vendors") && options?.method === "POST") {
      return { ok: true, json: async () => ({ vendor: { id: "v1", name: "Acme Plumbing" } }) };
    }
    if (String(url).includes("/api/rental/receipts/") && options?.method === "PATCH") {
      return { ok: true, json: async () => ({ receipt: { id: "r3", vendorName: "Acme Plumbing", vendorId: "v1", status: "inbox", receiptDate: "2026-10-04", amountCents: 4500 } }) };
    }
    if (String(url).includes("/api/rental/receipts")) {
      return { ok: true, json: async () => ({ receipts }) };
    }
    if (String(url).includes("/api/rental/vendors")) {
      return { ok: true, json: async () => ({ vendors: [{ id: "v1", name: "Acme Plumbing" }] }) };
    }
    if (String(url).includes("/api/rental/bank-accounts")) {
      return { ok: true, json: async () => ({ accounts: [{ id: "bank_1", name: "Business Checking" }] }) };
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

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<RentalReceiptsPanel />); });
  return { container, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalReceiptsPanel save confirmations", () => {
  it("saving a receipt confirms the save", async () => {
    stubFetch();
    const { container } = mount();
    await flush();
    const newButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "New receipt");
    expect(newButton).toBeTruthy();
    act(() => { newButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const totalInput = container.querySelector('input[placeholder="0.00"]');
    expect(totalInput).toBeTruthy();
    setInputValue(totalInput, "45.50");
    const hintInput = container.querySelector('input[placeholder="e.g. Acme Plumbing"]');
    if (hintInput) setInputValue(hintInput, "Acme Plumbing");
    const saveButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Save receipt");
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Receipt saved.");
  });

  it("applying a receipt to a bill confirms on the panel after the detail closes", async () => {
    stubFetch({
      receipts: [{ id: "r1", vendorName: "Acme Plumbing", vendorId: "v1", status: "inbox", receiptDate: "2026-10-04", amountCents: 4500 }],
      matches: [{ billId: "b1", suggested: true, confidence: "high", reasons: ["Amount matches"], bill: { vendorName: "Acme Plumbing", balanceCents: 4500 } }],
    });
    const { container } = mount();
    await flush();
    const row = [...container.querySelectorAll("button")].find((item) => item.textContent.includes("Acme Plumbing"));
    expect(row).toBeTruthy();
    act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const payButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Pay this bill with this receipt");
    expect(payButton).toBeTruthy();
    act(() => { payButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirmButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Confirm pay");
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Receipt applied to the bill.");
  });

  it("creating a vendor from a receipt confirms in the detail view", async () => {
    stubFetch({
      receipts: [{ id: "r3", vendorNameHint: "Acme Plumbing", vendorId: null, status: "inbox", receiptDate: "2026-10-04", amountCents: 4500 }],
      matches: [],
    });
    const { container } = mount();
    await flush();
    const row = [...container.querySelectorAll("button")].find((item) => item.textContent.includes("Acme Plumbing"));
    expect(row).toBeTruthy();
    act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const createButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Create vendor from this name");
    expect(createButton).toBeTruthy();
    await act(async () => {
      createButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Vendor created from the receipt.");
  });
});
