// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import OwnerStatementsPanel from "./OwnerStatementsPanel";

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/owner-movements") && options?.method === "POST") {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (String(url).includes("/api/rental/owner-movements")) {
      return { ok: true, json: async () => ({ movements: [], balance: { balanceCents: 50000, incomeCents: 100000, expenseCents: 50000, disbursementCents: 0, contributionCents: 0 } }) };
    }
    if (String(url).includes("/api/rental/owner-statement")) {
      return { ok: true, json: async () => ({ periodStart: "2026-10-01", periodEnd: "2026-10-31" }) };
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

describe("OwnerStatementsPanel save confirmations", () => {
  it("recording an owner contribution confirms the movement", async () => {
    stubFetch();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<OwnerStatementsPanel />); });
    await flush();
    const tab = [...container.querySelectorAll("button")].find((item) => item.textContent === "Contributions");
    expect(tab).toBeTruthy();
    act(() => { tab.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const recordButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Record contribution");
    expect(recordButton).toBeTruthy();
    act(() => { recordButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const amountInput = form.querySelector('input[type="number"]');
    expect(amountInput).toBeTruthy();
    setInputValue(amountInput, "250");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Owner contribution recorded.");
  });
});
