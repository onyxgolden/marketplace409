// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import CorrectPaymentDialog from "./CorrectPaymentDialog";

// Edit payment: the correction dialog gains deposit-state and charge-move
// fields for offline payments, and the save must end in an emerald check
// banner naming the payment and what changed — rendered where the user is
// looking (the dialog stays open on its done summary; the parent only
// refreshes behind it).

const payment = {
  id: "pay_1",
  chargeId: "charge_1",
  leaseId: "lease_1",
  provider: "offline",
  status: "succeeded",
  amountCents: 160000,
  refundedAmountCents: 0,
  currencyCode: "USD",
  receivedAt: "2026-09-01",
  paymentMethod: "cash",
  depositState: "received",
  depositAmountCents: 0,
  receiptReference: null,
  notes: "September rent",
  correctable: true,
  correctableReason: null,
  moneyFieldsCorrectable: true,
};

const availableCharges = [
  { id: "charge_1", period: "2026-09", dueDate: "2026-09-01", amountCents: 160000, paidAmountCents: 160000, status: "paid", chargeType: "rent" },
  { id: "charge_2", period: "2026-10", dueDate: "2026-10-01", amountCents: 160000, paidAmountCents: 0, status: "due", chargeType: "rent" },
  { id: "charge_3", period: "2026-11", dueDate: "2026-11-01", amountCents: 160000, paidAmountCents: 160000, status: "paid", chargeType: "rent" },
  { id: "charge_4", period: "2026-12", dueDate: "2026-12-01", amountCents: 160000, paidAmountCents: 0, status: "void", chargeType: "rent" },
];

function setInputValue(element, value) {
  const proto = element.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}

function setChecked(element, checked) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked").set;
  setter.call(element, checked);
  element.dispatchEvent(new Event("click", { bubbles: true }));
}

async function mountDialog({ paymentRow = payment, charges = availableCharges, onPost } = {}) {
  const posts = [];
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (String(url).includes("/correct") && options.method === "POST") {
      const body = JSON.parse(options.body);
      posts.push(body);
      if (onPost) return onPost(body);
      return {
        ok: true,
        json: async () => ({
          correction: {
            paymentId: "pay_1",
            changes: [
              { field: "deposit_state", label: "Deposit state", from: "received", to: "deposited" },
              { field: "charge_id", label: "Applies to", from: "charge_1", to: "charge_2" },
            ],
            balanceDeltaCents: 0,
            reconciledWarning: false,
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ payment: paymentRow, corrections: [], availableCharges: charges }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onDone = vi.fn();
  const onClose = vi.fn();
  const root = createRoot(container);
  await act(async () => {
    root.render(<CorrectPaymentDialog paymentId="pay_1" onDone={onDone} onClose={onClose} />);
  });
  return { container, root, onDone, onClose, posts, fetchMock };
}

function selectInLabel(container, labelText) {
  const label = [...container.querySelectorAll("label")].find((el) =>
    el.textContent.startsWith(labelText)
  );
  return label?.querySelector("select");
}

function submitForm(container) {
  const reason = container.querySelector('input[placeholder="Why is this payment being corrected?"]');
  setInputValue(reason, "bank run + wrong month");
  const checkbox = container.querySelector('input[type="checkbox"]');
  setChecked(checkbox, true);
  const submit = container.querySelector('button[type="submit"]');
  return submit;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("CorrectPaymentDialog edit fields", () => {
  it("shows deposit-state and applies-to fields for an offline payment, limited to the current + payable charges", async () => {
    const { container, root } = await mountDialog();
    expect(container.textContent).toContain("Deposit state");
    expect(container.textContent).toContain("Applies to");
    const chargeSelect = selectInLabel(container, "Applies to");
    expect(chargeSelect).not.toBeNull();
    const options = [...chargeSelect.querySelectorAll("option")].map((o) => o.textContent);
    expect(options.some((o) => o.includes("Current:"))).toBe(true);
    expect(options.some((o) => o.includes("2026-10"))).toBe(true);
    expect(options.some((o) => o.includes("2026-11"))).toBe(false);
    expect(options.some((o) => o.includes("2026-12"))).toBe(false);
    await act(async () => { root.unmount(); });
  });

  it("hides money fields for a provider-settled payment", async () => {
    const { container, root } = await mountDialog({
      paymentRow: { ...payment, provider: "stripe", moneyFieldsCorrectable: false },
    });
    expect(container.textContent).toContain("only the receipt reference and notes can be corrected");
    expect(container.textContent).not.toContain("Deposit state");
    expect(container.textContent).not.toContain("Applies to");
    await act(async () => { root.unmount(); });
  });

  it("previews deposit + charge changes and sends them on submit", async () => {
    const { container, root, posts } = await mountDialog();
    await act(async () => {
      setInputValue(selectInLabel(container, "Deposit state"), "deposited");
      setInputValue(selectInLabel(container, "Applies to"), "charge_2");
    });
    expect(container.textContent).toContain("Deposit state: received → deposited");
    expect(container.textContent).toContain("Applies to:");
    expect(container.textContent).toContain("2026-09");
    expect(container.textContent).toContain("2026-10");
    const submit = submitForm(container);
    await act(async () => { submit.click(); });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ depositState: "deposited", chargeId: "charge_2" });
    expect(posts[0].reason).toBe("bank run + wrong month");
    await act(async () => { root.unmount(); });
  });

  it("shows an emerald check confirmation naming the payment and what changed after save", async () => {
    const { container, root, onDone } = await mountDialog();
    await act(async () => {
      setInputValue(selectInLabel(container, "Deposit state"), "deposited");
      setInputValue(selectInLabel(container, "Applies to"), "charge_2");
    });
    const submit = submitForm(container);
    await act(async () => { submit.click(); });
    // The confirmation renders where the user is looking: the dialog stays
    // open on its done summary (the parent only refreshes behind it).
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toContain("✓");
    expect(status.textContent).toContain("$1,600.00 payment corrected");
    expect(container.textContent).toContain("Deposit state: received → deposited");
    expect(container.textContent).toContain("Applies to:");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toMatchObject({ paymentId: "pay_1" });
    await act(async () => { root.unmount(); });
  });

  it("edits the deposit amount and confirms it by name after save", async () => {
    const { container, root, posts, onDone } = await mountDialog({
      onPost: () => ({
        ok: true,
        json: async () => ({
          correction: {
            paymentId: "pay_1",
            changes: [{ field: "deposit_amount_cents", label: "Deposit amount", from: 0, to: 50000 }],
            balanceDeltaCents: 0,
            reconciledWarning: false,
          },
        }),
      }),
    });
    expect(container.textContent).toContain("Deposit amount");
    const depositInput = [...container.querySelectorAll("label")]
      .find((el) => el.textContent.startsWith("Deposit amount"))?.querySelector("input");
    expect(depositInput).not.toBeNull();
    await act(async () => {
      setInputValue(depositInput, "500");
    });
    expect(container.textContent).toContain("Deposit amount: $0.00 → $500.00");
    const submit = submitForm(container);
    await act(async () => { submit.click(); });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ depositAmountCents: 50000 });
    // The emerald confirmation names the payment and the deposit change;
    // charge and credit balances are untouched by a deposit-amount change.
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toContain("✓");
    expect(status.textContent).toContain("$1,600.00 payment corrected");
    expect(container.textContent).toContain("Deposit amount: $0.00 → $500.00");
    expect(onDone).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });

  it("surfaces a guard refusal as a plain-words error with no confirmation", async () => {
    const { container, root } = await mountDialog({
      onPost: () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: "A payment with a refund cannot have its amount corrected." }),
      }),
    });
    await act(async () => {
      setInputValue(selectInLabel(container, "Deposit state"), "deposited");
    });
    const submit = submitForm(container);
    await act(async () => { submit.click(); });
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("A payment with a refund cannot have its amount corrected.");
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => { root.unmount(); });
  });
});
