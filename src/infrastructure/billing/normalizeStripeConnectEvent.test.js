import { describe, expect, it } from "vitest";
import { normalizeStripeConnectEvent } from "./normalizeStripeConnectEvent.js";

describe("normalizeStripeConnectEvent", () => {
  it("uses the signed event account as the landlord payment boundary", () => {
    expect(normalizeStripeConnectEvent({ id: "evt_1", type: "payment_intent.processing", account: "acct_kent",
      livemode: false, data: { object: { id: "pi_1", metadata: { forge_payment_id: "payment_1" } } } })).toEqual({
      providerEventId: "evt_1", connectedAccountId: "acct_kent", eventType: "payment_intent.processing",
      objectId: "pi_1", paymentId: "payment_1", failureCode: null, failureMessage: null,
      occurredAt: expect.any(String), supported: true, livemode: false,
    });
  });

  it("rejects platform events that do not identify a connected account", () => {
    expect(() => normalizeStripeConnectEvent({ id: "evt_1", type: "payment_intent.succeeded", data: { object: {} } }))
      .toThrow("connected account id");
  });
});
