import { describe, expect, it } from "vitest";
import { reservationFinanceReadModel } from "./financeReadModel";
describe("reservation finance read model", () => {
  it.each(["none", "pending", "partially_refunded", "refunded", "failed"])("keeps %s refund state separate from payment", refund => {
    const result = reservationFinanceReadModel({ booking_payment_status: "paid", refund_status: refund,
      finance_settlement_status: "pending", payout_status: "not_paid_out", owner_id: "private", payment_intent_id: "pi_private" });
    expect(result).toMatchObject({ bookingPaymentStatus: "paid", refundStatus: refund, settlementStatus: "pending", payoutStatus: "not_paid_out" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each(["disputed", "won", "lost"])("keeps dispute %s independent of refunded and paid out amounts", status => {
    expect(reservationFinanceReadModel({ dispute_status: status, historical_paid_out_cents: 970, finance_refunded_cents: 1000 })).toMatchObject({ disputeStatus: status, paidOutAmountCents: 970, bookingRefundedCents: 1000 });
  });
  it("does not fabricate unknown settlement amounts", () => {
    expect(reservationFinanceReadModel({ gross_cents: null, fee_cents: null, net_cents: null, reconciliation_status: "unknown" })).toMatchObject({ grossCents: null, feeCents: null, netCents: null, reconciliationStatus: "unknown" });
    expect(reservationFinanceReadModel(null)).toBeNull();
  });
});
