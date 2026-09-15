// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import ReservationFinanceDetails from "./ReservationFinanceDetails";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe("shared guest and owner finance details", () => {
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; });
  it.each(["pending", "failed", "partially_refunded", "refunded", "disputed", "won", "lost", "available", "paid_out", "unknown"])("shows %s honestly without inferring available funds", state => {
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<ReservationFinanceDetails financial={{ refundStatus: state, disputeStatus: state,
      payoutStatus: state, reconciliationStatus: state, grossCents: 1000, feeCents: 30, netCents: 970,
      bookingRefundedCents: 400, reversedCents: 0, paidOutAmountCents: 970, currencyCode: "USD" }} />));
    expect(container.textContent).toContain(state.replaceAll("_", " "));
    expect(container.textContent).toContain("$10.00");
    expect(container.textContent).toContain("$0.30");
    expect(container.textContent).toContain("$9.70");
    expect(container.textContent).toContain("not the current spendable balance");
    if (state === "unknown") expect(container.querySelector('[role="status"]').textContent).toContain("needs review");
  });
});
