// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantPaymentReview from "./TenantPaymentReview.jsx";

const charge = { id: "charge_1", amountCents: 160000, paidAmountCents: 0, chargeType: "rent" };

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}
function radioByLabel(container, labelText) {
  const label = Array.from(container.querySelectorAll("label"))
    .find((candidate) => candidate.textContent.includes(labelText));
  return label.querySelector("input");
}
function click(node) {
  act(() => { node.click(); });
}

describe("TenantPaymentReview (R12)", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
  });

  it("shows rent, fee, and total when card is chosen with the fee enabled", () => {
    mounted = mount(<TenantPaymentReview charge={charge} feeBps={295} onConfirm={() => {}} onCancel={() => {}} />);
    const { container } = mounted;
    expect(container.textContent).toContain("$1,600.00");
    click(radioByLabel(container, "Card"));
    // 2.95% of $1,600 = $47.20, agreed copy names the rate.
    expect(container.textContent).toContain("$47.20");
    expect(container.textContent).toContain("$1,647.20");
    expect(container.textContent).toContain("2.95%");
  });

  it("blocks continue on card until the tenant agrees to the fee", () => {
    const onConfirm = vi.fn();
    mounted = mount(<TenantPaymentReview charge={charge} feeBps={295} onConfirm={onConfirm} onCancel={() => {}} />);
    const { container } = mounted;
    click(radioByLabel(container, "Card"));
    const continueButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.startsWith("Continue to payment"));
    expect(continueButton.disabled).toBe(true);
    const checkbox = container.querySelector('input[type="checkbox"]');
    click(checkbox);
    expect(continueButton.disabled).toBe(false);
    click(continueButton);
    expect(onConfirm).toHaveBeenCalledWith({ paymentMethod: "card", feeAgreed: true, expectedFeeCents: 4720 });
  });

  it("charges no fee and needs no agreement for bank payments", () => {
    const onConfirm = vi.fn();
    mounted = mount(<TenantPaymentReview charge={charge} feeBps={295} onConfirm={onConfirm} onCancel={() => {}} />);
    const { container } = mounted;
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    const continueButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.startsWith("Continue to payment"));
    expect(continueButton.disabled).toBe(false);
    click(continueButton);
    expect(onConfirm).toHaveBeenCalledWith({ paymentMethod: "us_bank_account", feeAgreed: false, expectedFeeCents: 0 });
  });

  it("shows no fee line at all when the fee is disabled", () => {
    mounted = mount(<TenantPaymentReview charge={charge} feeBps={0} onConfirm={() => {}} onCancel={() => {}} />);
    const { container } = mounted;
    click(radioByLabel(container, "Card"));
    expect(container.textContent).not.toContain("convenience fee (");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("returns to the balance view on Back without posting anything", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    mounted = mount(<TenantPaymentReview charge={charge} feeBps={295} onConfirm={onConfirm} onCancel={onCancel} />);
    const { container } = mounted;
    const back = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Back");
    click(back);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
