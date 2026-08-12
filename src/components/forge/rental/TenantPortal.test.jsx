import { describe, expect, it } from "vitest";
import { buildTenantPaymentSummary, paymentPendingForCharge } from "./TenantPortal.jsx";
describe("tenant payment summary", () => {
  it("shows only unpaid rent in the current balance", () => {
    expect(buildTenantPaymentSummary([{ charges: [
      { amountCents: 125000, paidAmountCents: 25000, status: "partially_paid" },
      { amountCents: 125000, paidAmountCents: 125000, status: "paid" },
      { amountCents: 5000, paidAmountCents: 0, status: "void" },
    ] }])).toEqual({ dueCents: 100000, openCharges: 1 });
  });
  it("blocks a duplicate attempt while ACH is processing", () => {
    expect(paymentPendingForCharge([{ chargeId: "charge_1", status: "processing" }], "charge_1")).toBe(true);
    expect(paymentPendingForCharge([{ chargeId: "charge_1", status: "failed" }], "charge_1")).toBe(false);
  });
});
