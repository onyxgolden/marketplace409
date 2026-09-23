// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PostIncomeForm, { incomeCategoryForChargeType } from "./PostIncomeForm";

const openCharges = [
  { id: "c1", period: "2026-09", dueDate: "2026-09-01", chargeType: "rent", amountCents: 127500, paidCents: 0, remainingCents: 127500, status: "open" },
  { id: "c2", period: "2026-09", dueDate: "2026-09-05", chargeType: "late_fee", amountCents: 7500, paidCents: 0, remainingCents: 7500, status: "open" },
];

function renderForm(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<PostIncomeForm tenantName="Paula" openCharges={openCharges} {...props} />));
  return { container, root };
}

describe("incomeCategoryForChargeType", () => {
  it("defaults to Rental Income for rent charges", () => {
    expect(incomeCategoryForChargeType("rent")).toBe("Rental Income");
    expect(incomeCategoryForChargeType(undefined)).toBe("Other Income");
  });
  it("labels late fees and prorations honestly", () => {
    expect(incomeCategoryForChargeType("late_fee")).toBe("Late Fee Income");
    expect(incomeCategoryForChargeType("proration")).toBe("Prorated Rent Income");
  });
});

describe("PostIncomeForm", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("shows Rental Income as the default category for the oldest open rent charge", () => {
    ({ container, root } = renderForm());
    expect(container.querySelector("[data-income-category]").textContent).toContain("Rental Income");
  });

  it("explains itself when the tenant has no open charges", () => {
    ({ container, root } = renderForm({ openCharges: [] }));
    expect(container.textContent).toContain("no open charges");
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it("rejects an amount larger than the selected charge's remaining balance", async () => {
    ({ container, root } = renderForm());
    const amount = container.querySelector('input[type="number"]');
    // React 18 controlled input: set value via native setter so onChange fires.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(amount, "2000");
      amount.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain("exceeds the remaining balance");
  });

  it("rejects a future payment date", async () => {
    ({ container, root } = renderForm());
    const dateInput = container.querySelector('input[type="date"]');
    const amountInput = container.querySelector('input[type="number"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(dateInput, "2099-01-01");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      nativeSetter.call(amountInput, "100");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain("cannot be in the future");
  });

  it("posts through the existing record-offline-payment operation and reloads the ledger", async () => {
    const post = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, payment: { amountCents: 127500, receivedAt: "2026-09-05T12:00:00.000Z" } }) }));
    vi.stubGlobal("fetch", post);
    const onSaved = vi.fn();
    ({ container, root } = renderForm({ onSaved }));
    const amountInput = container.querySelector('input[type="number"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(amountInput, "1275");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(post).toHaveBeenCalledTimes(1);
    const [, options] = post.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.operation).toBe("record-offline-payment");
    expect(body.payment.chargeId).toBe("c1");
    expect(body.payment.paymentMethod).toBe("cash");
    expect(body.payment.amountCents).toBe(127500);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("surfaces the API's own error when the RPC refuses the payment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Payment exceeds the remaining rent balance." }) })));
    ({ container, root } = renderForm());
    const amountInput = container.querySelector('input[type="number"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(amountInput, "100");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain("exceeds the remaining rent balance");
  });

  it("refreshes the authoritative charge list when the backend rejects a stale remaining balance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Payment exceeds the remaining rent balance." }) })));
    const onStaleBalance = vi.fn();
    ({ container, root } = renderForm({ onStaleBalance }));
    const amountInput = container.querySelector('input[type="number"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(amountInput, "100");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onStaleBalance).toHaveBeenCalledTimes(1);
    const alert = container.querySelector('[role="alert"]').textContent;
    expect(alert).toContain("exceeds the remaining rent balance");
    expect(alert).toContain("refreshed with the latest balances");
  });

  it("does not refresh the charge list for unrelated API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Charge not found." }) })));
    const onStaleBalance = vi.fn();
    ({ container, root } = renderForm({ onStaleBalance }));
    const amountInput = container.querySelector('input[type="number"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(amountInput, "100");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onStaleBalance).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain("Charge not found.");
  });

  it("falls back to the first open charge when a refresh removes the selected one", async () => {
    ({ container, root } = renderForm());
    const refreshed = [
      { id: "c2", period: "2026-09", dueDate: "2026-09-05", chargeType: "late_fee", amountCents: 7500, paidCents: 0, remainingCents: 7500, status: "open" },
    ];
    await act(async () => {
      root.render(<PostIncomeForm tenantName="Paula" openCharges={refreshed} />);
    });
    const applyTo = container.querySelectorAll("select")[1];
    expect(applyTo.value).toBe("c2");
    expect(container.querySelector("[data-income-category]").textContent).toContain("Late Fee Income");
  });
});
