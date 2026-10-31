// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantCreditSection from "./TenantCreditSection";

const credits = [{
  id: "credit_1", tenant_id: "t1", lease_id: "lease_1", amount_cents: 3200, remaining_cents: 1200,
  source: "overpayment", source_payment_id: "pay_1", status: "open", notes: null,
  voided_at: null, voided_by: null, void_reason: null, created_at: "2026-09-05T12:00:00Z",
}];
const openCharges = [{ id: "charge_nov", period: "2026-11", remainingCents: 150000 }];

function renderSection(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<TenantCreditSection credits={credits} creditApplications={[]} openCharges={openCharges} onChanged={vi.fn()} {...props} />));
  return { container, root };
}

function clickButton(container, text) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button).toBeTruthy();
  button.dispatchEvent(new Event("click", { bubbles: true }));
  return button;
}

async function passGate(container) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked").set;
  const checkbox = container.querySelector('input[type="checkbox"]');
  const confirm = container.querySelector('input[placeholder="CONFIRM"]');
  await act(async () => {
    checkedSetter.call(checkbox, true);
    checkbox.dispatchEvent(new Event("click", { bubbles: true }));
    nativeSetter.call(confirm, "CONFIRM");
    confirm.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("TenantCreditSection save confirmations", () => {
  it("applying a credit confirms the applied amount", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ application: { id: "app_2" } }) })));
    const { container } = renderSection();
    act(() => { clickButton(container, "Apply to a charge…"); });
    const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    const select = container.querySelector("select");
    await act(async () => {
      selectSetter.call(select, "charge_nov");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await passGate(container);
    await act(async () => {
      clickButton(container, "Apply credit");
    });
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Credit of $12.00 applied to the charge.");
  });

  it("voiding a credit confirms the void", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
    const { container } = renderSection();
    act(() => { clickButton(container, "Void remaining…"); });
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const reason = container.querySelector('input[placeholder="e.g. refunded to tenant in cash"]');
    await act(async () => {
      nativeSetter.call(reason, "Recorded in error");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await passGate(container);
    await act(async () => {
      clickButton(container, "Void credit");
    });
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Credit voided.");
  });
});
