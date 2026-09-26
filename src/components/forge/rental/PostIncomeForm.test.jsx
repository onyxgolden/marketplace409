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

  it("pauses on an overpayment and shows the exact applied-vs-credit split", async () => {
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
    // No longer a dead-end rejection — the form explains the split behind the human gate.
    const panel = container.querySelector("[data-overpayment-confirm]");
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Apply $1,275.00 to the charge");
    expect(panel.textContent).toContain("Record $725.00 as an open credit");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("records the overpayment with the credit flag only after checkbox + CONFIRM", async () => {
    ({ container, root } = renderForm());
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const amount = container.querySelector('input[type="number"]');
    await act(async () => {
      nativeSetter.call(amount, "2000");
      amount.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const posted = [];
    vi.stubGlobal("fetch", async (url, options) => {
      posted.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ payment: { id: "pay_1", amountCents: 200000, receivedAt: "2026-09-05T12:00:00.000Z", credit: { id: "credit_1", amountCents: 72500 } } }) };
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const panel = container.querySelector("[data-overpayment-confirm]");
    // Unconfirmed confirm submit: the gate holds, nothing is posted.
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(posted).toHaveLength(0);
    expect(container.querySelector('[role="alert"]').textContent).toContain("CONFIRM");

    // Confirm properly: checkbox + CONFIRM, then the POST carries the flag.
    const checkbox = panel.querySelector('input[type="checkbox"]');
    const confirmInput = panel.querySelector('input[placeholder="CONFIRM"]');
    const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked").set;
    await act(async () => {
      checkedSetter.call(checkbox, true);
      checkbox.dispatchEvent(new Event("click", { bubbles: true }));
      nativeSetter.call(confirmInput, "CONFIRM");
      confirmInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].payment.allowOverpaymentCredit).toBe(true);
    expect(posted[0].payment.amountCents).toBe(200000);
  });

  it("attributes the payment to the tenant and sends a stable idempotency key", async () => {
    const post = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, payment: { amountCents: 10000, receivedAt: "2026-09-05T12:00:00.000Z" } }) }));
    vi.stubGlobal("fetch", post);
    ({ container, root } = renderForm({ tenantId: "tenant_9" }));
    const amountInput = container.querySelector('input[type="number"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(amountInput, "100");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const firstKey = JSON.parse(post.mock.calls[0][1].body).payment.idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(JSON.parse(post.mock.calls[0][1].body).payment.tenantId).toBe("tenant_9");
    // The successful submit completes its intent; the next submit is a new intent, so the key regenerates.
    await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const secondKey = JSON.parse(post.mock.calls[1][1].body).payment.idempotencyKey;
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });

  it("regenerates the idempotency key when the submission intent changes", async () => {
    const post = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, payment: { amountCents: 10000 } }) }));
    vi.stubGlobal("fetch", post);
    ({ container, root } = renderForm({ tenantId: "tenant_9" }));
    const amountInput = container.querySelector('input[type="number"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(amountInput, "100");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // A failed submit keeps the same key so the retry replays; editing the amount
    // after the failure produces a new key because the intent changed.
    const failThenSucceed = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Payment exceeds the remaining rent balance." }) })
      .mockResolvedValue({ ok: true, json: async () => ({ success: true, payment: {} }) });
    vi.stubGlobal("fetch", failThenSucceed);
    await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const failedKey = JSON.parse(failThenSucceed.mock.calls[0][1].body).payment.idempotencyKey;
    // A retry of the same failed intent (no edits) reuses the key, so the backend replays.
    await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(JSON.parse(failThenSucceed.mock.calls[1][1].body).payment.idempotencyKey).toBe(failedKey);
    // Editing the amount after the failure changes the intent — the key regenerates.
    await act(async () => {
      nativeSetter.call(amountInput, "50");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const retryKey = JSON.parse(failThenSucceed.mock.calls[2][1].body).payment.idempotencyKey;
    expect(retryKey).not.toBe(failedKey);
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

  it("defaults the deposit state to received and sends deposited when the checkbox is checked", async () => {
    const post = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, payment: { amountCents: 127500 } }) }));
    vi.stubGlobal("fetch", post);
    ({ container, root } = renderForm());
    const amountInput = container.querySelector('input[type="number"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(amountInput, "1275");
      amountInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Default: unchecked — money in hand, not yet in the bank.
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(JSON.parse(post.mock.calls[0][1].body).payment.depositState).toBe("received");
    // Checked: the user confirms the money is already deposited.
    const depositCheckbox = [...container.querySelectorAll('input[type="checkbox"]')]
      .find((input) => input.closest("label")?.textContent.includes("Already deposited"));
    expect(depositCheckbox).toBeTruthy();
    await act(async () => {
      depositCheckbox.click();
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(JSON.parse(post.mock.calls[1][1].body).payment.depositState).toBe("deposited");
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
