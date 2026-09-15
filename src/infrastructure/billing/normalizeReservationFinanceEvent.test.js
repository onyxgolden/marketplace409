import { describe, expect, it } from "vitest";
import { normalizeReservationFinanceEvent } from "./normalizeReservationFinanceEvent";

const event = { id: "evt_test", account: "acct_test", livemode: false, created: 1789358400,
  type: "refund.updated", data: { object: { object: "refund", id: "re_test", payment_intent: "pi_stored", metadata: { forge_owner_id: "attacker" } } } };
describe("reservation finance normalization", () => {
  it("uses signed account and provider references without metadata", () => {
    const value = normalizeReservationFinanceEvent(event);
    expect(value).toMatchObject({ connectedAccountId: "acct_test", paymentIntentId: "pi_stored", mode: "test" });
    expect(JSON.stringify(value)).not.toContain("attacker");
    expect(Object.isFrozen(value)).toBe(true);
  });
  it.each(["refund.created", "refund.failed", "charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.updated", "payout.paid", "payout.failed", "balance.available"])("accepts %s for strict downstream validation", type => {
    const family = type.startsWith("charge.dispute.") ? "dispute" : type.split(".")[0];
    const prefix = { charge: "ch", dispute: "dp", refund: "re", payout: "po", balance: "bal" }[family];
    expect(normalizeReservationFinanceEvent({ ...event, type, data: { object: { ...event.data.object, object: family, id: `${prefix}_test` } } }).eventType).toBe(type);
  });
  it.each([{ livemode: true }, { livemode: undefined }, { account: null }, { created: null }, { type: "unknown.event" }, { data: { object: { id: "re_test", livemode: true } } }])("fails closed for invalid envelopes: %j", patch => {
    expect(() => normalizeReservationFinanceEvent({ ...event, ...patch })).toThrow();
  });
});
