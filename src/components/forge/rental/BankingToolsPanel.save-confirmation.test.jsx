// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import BankingToolsPanel from "./BankingToolsPanel";

const deposits = [{
  id: "dep_1", totalAmountCents: 150000, depositDate: "2026-10-05", status: "active",
}];

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/bank-accounts")) {
      return { ok: true, json: async () => ({ accounts: [{ id: "bank_1", name: "Business Checking", official_name: "Chase" }] }) };
    }
    if (String(url).includes("/api/rental/bank-deposits?undeposited=true")) {
      return { ok: true, json: async () => ({ receipts: [] }) };
    }
    if (String(url).includes("/api/rental/bank-deposits") && options?.method === "PATCH") {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (String(url).includes("/api/rental/bank-deposits")) {
      return { ok: true, json: async () => ({ deposits }) };
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

describe("BankingToolsPanel void confirmation", () => {
  it("voiding a bank deposit confirms the void", async () => {
    stubFetch();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<BankingToolsPanel />); });
    await flush();
    const depositsTab = [...container.querySelectorAll("button")].find((item) => item.textContent === "Bank deposits");
    expect(depositsTab).toBeTruthy();
    act(() => { depositsTab.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const voidButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Void");
    expect(voidButton).toBeTruthy();
    act(() => { voidButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const reasonInput = container.querySelector('input[placeholder="Why is this deposit being voided?"]');
    expect(reasonInput).toBeTruthy();
    setInputValue(reasonInput, "Wrong account");
    const confirmButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Void deposit");
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Bank deposit voided.");
  });
});
