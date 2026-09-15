import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), observations: vi.fn(), payout: vi.fn(), paymentIntentForCharge: vi.fn() }));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: () => ({ mode: "test", constructWebhookEvent: (...args) => Stripe.webhooks.constructEvent(...args) }) }));
vi.mock("@/infrastructure/billing/ReservationFinanceProvider", () => ({ ReservationFinanceProvider: class {
  observations = mocks.observations; payout = mocks.payout; paymentIntentForCharge = mocks.paymentIntentForCharge;
} }));
import { POST } from "./route";
const secret = "whsec_rv_e2d_offline_only";
const attempt = { ownerId: "owner", reservationId: "reservation", paymentAttemptId: "reservation_payment_test",
  paymentIntentId: "pi_stored", amountCents: 1000, currencyCode: "USD", paymentStatus: "succeeded" };
function event(type = "refund.updated", object = {}) {
  const family = type.startsWith("charge.dispute.") ? "dispute" : type.split(".")[0];
  const prefix = { charge: "ch", dispute: "dp", refund: "re", payout: "po", balance: "bal" }[family];
  return { id: "evt_test", type, account: "acct_known", livemode: false, created: 1789358400,
    data: { object: { object: family, id: `${prefix}_test`, payment_intent: "pi_stored", metadata: { forge_owner_id: "attacker", forge_payment_id: "rental_other" }, ...object } } };
}
function request(value, signature) {
  const payload = JSON.stringify(value);
  return new Request("http://localhost/api/rental/reservation-finance-webhook", { method: "POST", body: payload,
    headers: { "stripe-signature": signature || Stripe.webhooks.generateTestHeaderString({ payload, secret }) } });
}
describe("authenticated reservation finance webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_RESERVATION_FINANCE_WEBHOOK_SECRET = secret;
    mocks.rpc.mockImplementation(async name => ({ error: null, data: name === "resolve_reservation_finance_attempts" ? [attempt] : { outcome: "accepted" } }));
    mocks.observations.mockResolvedValue([{ paymentIntentId: "pi_stored", objectId: "re_test", kind: "refund", amountCents: 400, currencyCode: "USD", status: "succeeded" }]);
    mocks.paymentIntentForCharge.mockResolvedValue("pi_stored");
  });
  it("validates a real offline Stripe signature and authorizes only stored identity", async () => {
    const response = await POST(request(event()));
    expect(response.status).toBe(200);
    expect(mocks.observations).toHaveBeenCalledWith(attempt, { refunds: true, disputeId: null });
    const args = mocks.rpc.mock.calls.find(([name]) => name === "record_reservation_finance_event")[1];
    expect(args.p_payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toMatch(/attacker|rental_other/);
    expect(args.p_observations[0]).toMatchObject({ amountCents: 400, paymentIntentId: "pi_stored" });
  });
  it("rejects forged signatures before any database call", async () => {
    expect((await POST(request(event(), "t=1,v1=invalid"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["refund.created", "refund.failed", "charge.refunded", "charge.updated", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"])("routes authenticated %s through reservation finance only", async type => {
    expect((await POST(request(event(type)))).status).toBe(200);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["resolve_reservation_finance_attempts", "record_reservation_finance_event"]);
  });
  it.each([{ livemode: true }, { type: "unknown.event" }, { account: "acct_unknown" }])("retains safe audit evidence for unknown envelope %j", async patch => {
    if (patch.account) mocks.rpc.mockImplementation(async name => ({ error: null, data: name === "resolve_reservation_finance_attempts" ? [] : { outcome: "unknown" } }));
    await POST(request({ ...event(), ...patch }));
    expect(mocks.observations).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("record_reservation_finance_event", expect.objectContaining({ p_observations: [], p_unknown_reason: "unverified_provider_evidence" }));
  });
  it("rejects unknown PaymentIntents despite matching metadata", async () => {
    await POST(request(event("refund.updated", { payment_intent: "pi_unknown" })));
    expect(mocks.observations).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith("record_reservation_finance_event", expect.objectContaining({ p_unknown_reason: "unverified_provider_evidence" }));
  });
  it("retains unknown evidence on provider lookup failure without partial application", async () => {
    mocks.observations.mockRejectedValue(new Error("Provider response contains secret or guest data"));
    await POST(request(event()));
    expect(mocks.rpc).toHaveBeenLastCalledWith("record_reservation_finance_event", expect.objectContaining({ p_observations: [], p_unknown_reason: "unverified_provider_evidence" }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("guest data");
  });
  it("refreshes successful stored attempts on balance.available", async () => {
    await POST(request(event("balance.available")));
    expect(mocks.observations).toHaveBeenCalledWith(attempt);
  });
  it("associates a verified paid payout using its balance-transaction membership", async () => {
    const payout = { id: "po_test", status: "paid", chargeIds: ["ch_test"], balanceTransactionIds: ["txn_test"] };
    mocks.payout.mockResolvedValue(payout);
    await POST(request(event("payout.paid", { id: "po_test" })));
    expect(mocks.observations).toHaveBeenCalledWith(attempt, { payout, expectedChargeId: "ch_test" });
  });
  it("returns the persistence RPC's duplicate outcome without reapplying in the route", async () => {
    mocks.rpc.mockImplementation(async name => ({ error: null, data: name === "resolve_reservation_finance_attempts" ? [attempt] : { duplicate: true, outcome: "accepted" } }));
    expect(await (await POST(request(event()))).json()).toMatchObject({ duplicate: true });
  });
  it("returns a retryable error if immutable evidence cannot be retained", async () => {
    mocks.rpc.mockImplementation(async name => name === "resolve_reservation_finance_attempts" ? { data: [attempt] } : { error: { message: "offline" } });
    expect((await POST(request(event()))).status).toBe(500);
  });
});
