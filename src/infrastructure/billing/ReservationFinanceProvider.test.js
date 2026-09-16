import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationFinanceProvider } from "./ReservationFinanceProvider";

const attempt = { paymentIntentId: "pi_test", amountCents: 1000, currencyCode: "USD" };
const refund = { id: "re_test", charge: "ch_test", payment_intent: "pi_test", currency: "usd", amount: 400, status: "succeeded" };
describe("read-only reservation Stripe finance adapter", () => {
  let stripe; let adapter; let charge; let balance;
  beforeEach(() => {
    charge = { id: "ch_test", payment_intent: "pi_test", livemode: false, paid: true, captured: true,
      amount: 1000, currency: "usd", amount_refunded: 400, balance_transaction: "txn_test" };
    balance = { id: "txn_test", source: "ch_test", type: "charge", amount: 1000, fee: 30, net: 970, currency: "usd", status: "pending" };
    stripe = {
      paymentIntents: { retrieve: vi.fn().mockResolvedValue({ id: "pi_test", livemode: false, status: "succeeded", latest_charge: "ch_test", amount_received: 1000, currency: "usd" }) },
      charges: { retrieve: vi.fn().mockImplementation(async () => charge) },
      balanceTransactions: { retrieve: vi.fn().mockImplementation(async () => balance), list: vi.fn() },
      refunds: { list: vi.fn().mockResolvedValue({ data: [refund], has_more: false }) },
      disputes: { retrieve: vi.fn() }, payouts: { retrieve: vi.fn() },
    };
    adapter = new ReservationFinanceProvider({ mode: "test", stripe }, "acct_test");
  });
  it("retains pending settlement with Stripe gross, fee and net independently of payment success", async () => {
    expect(await adapter.observations(attempt)).toEqual([{ paymentIntentId: "pi_test", currencyCode: "USD",
      objectId: "txn_test", kind: "settlement", amountCents: 1000, feeCents: 30, netCents: 970, status: "pending" }]);
    expect(stripe.balanceTransactions.retrieve).toHaveBeenCalledWith("txn_test", {}, { stripeAccount: "acct_test" });
  });
  it.each(["pending", "available"])("preserves settlement state %s", async status => {
    balance.status = status;
    expect((await adapter.observations(attempt))[0].status).toBe(status);
  });
  it("normalizes partial refunds by refund identity, never by cumulative event amount", async () => {
    expect((await adapter.observations(attempt, { refunds: true }))[0]).toMatchObject({ objectId: "re_test", amountCents: 400, kind: "refund" });
  });
  it("recognizes a full reversal using Stripe's explicit reversal evidence", async () => {
    charge.amount_refunded = 1000;
    stripe.refunds.list.mockResolvedValue({ data: [{ ...refund, amount: 1000, destination_details: { card: { type: "reversal" } } }], has_more: false });
    expect((await adapter.observations(attempt, { refunds: true }))[0]).toMatchObject({ amountCents: 1000, kind: "reversal" });
  });
  it.each(["pending", "failed", "canceled"])("keeps %s refunds distinct from succeeded refunds", async status => {
    charge.amount_refunded = 0;
    stripe.refunds.list.mockResolvedValue({ data: [{ ...refund, status }], has_more: false });
    expect((await adapter.observations(attempt, { refunds: true }))[0].status).toBe(status);
  });
  it.each(["needs_response", "under_review", "won", "lost"])("normalizes dispute %s without changing payment success", async status => {
    stripe.disputes.retrieve.mockResolvedValue({ id: "dp_test", charge: "ch_test", payment_intent: "pi_test", livemode: false, amount: 1000, currency: "usd", status });
    expect((await adapter.observations(attempt, { disputeId: "dp_test" }))[0]).toMatchObject({ kind: "dispute", status, amountCents: 1000 });
  });
  it.each([{ amount: 999 }, { fee: 31 }, { currency: "eur" }, { source: "ch_unknown" }, { id: "txn_unknown" }, { status: "unknown" }])("rejects mismatched balance evidence %j", async patch => {
    Object.assign(balance, patch);
    await expect(adapter.observations(attempt)).rejects.toThrow("Unknown");
  });
  it("rejects mismatched charge and mode", async () => {
    charge.livemode = true;
    await expect(adapter.observations(attempt)).rejects.toThrow();
    expect(() => new ReservationFinanceProvider({ mode: "live", stripe }, "acct_test")).toThrow();
  });
  it("rejects a signed charge reference that is not the stored PaymentIntent's charge", async () => {
    await expect(adapter.observations(attempt, { expectedChargeId: "ch_unknown" })).rejects.toThrow();
    expect(stripe.balanceTransactions.retrieve).not.toHaveBeenCalled();
  });
  it("paginates refunds and verifies cumulative refund arithmetic", async () => {
    charge.amount_refunded = 1000;
    stripe.refunds.list.mockResolvedValueOnce({ data: [refund], has_more: true })
      .mockResolvedValueOnce({ data: [{ ...refund, id: "re_second", amount: 600 }], has_more: false });
    expect(await adapter.observations(attempt, { refunds: true })).toHaveLength(2);
    expect(stripe.refunds.list).toHaveBeenLastCalledWith({ charge: "ch_test", limit: 100, starting_after: "re_test" }, { stripeAccount: "acct_test" });
  });
  it("verifies automatic payout membership, amount, currency and paid status", async () => {
    stripe.payouts.retrieve.mockResolvedValue({ id: "po_test", livemode: false, automatic: true, reconciliation_status: "completed", amount: 970, currency: "usd", status: "paid" });
    stripe.balanceTransactions.list.mockResolvedValue({ data: [balance], has_more: false });
    const payout = await adapter.payout("po_test");
    balance.status = "available";
    expect((await adapter.observations(attempt, { payout }))[0]).toMatchObject({ payoutId: "po_test", payoutStatus: "paid", netCents: 970 });
  });
  it.each([{ automatic: false }, { reconciliation_status: "in_progress" }, { amount: 999 }, { livemode: true }, { id: "po_unknown" }])("fails closed for unknown payout evidence %j", async patch => {
    stripe.payouts.retrieve.mockResolvedValue({ id: "po_test", livemode: false, automatic: true, reconciliation_status: "completed", amount: 970, currency: "usd", status: "paid", ...patch });
    stripe.balanceTransactions.list.mockResolvedValue({ data: [balance], has_more: false });
    await expect(adapter.payout("po_test")).rejects.toThrow();
  });
});
