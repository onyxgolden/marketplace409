import { describe, expect, it } from "vitest";
import { normalizeStripeConnectEvent } from "./normalizeStripeConnectEvent.js";

describe("normalizeStripeConnectEvent", () => {
  it("uses the signed event account as the landlord payment boundary", () => {
    expect(normalizeStripeConnectEvent({ id: "evt_1", type: "payment_intent.processing", account: "acct_kent",
      livemode: false, data: { object: { id: "pi_1", metadata: { forge_payment_id: "payment_1" } } } })).toEqual({
      providerEventId: "evt_1", connectedAccountId: "acct_kent", eventType: "payment_intent.processing",
      objectId: "pi_1", paymentId: "payment_1", refundStatus: null, refundedAmountCents: null, paymentIntentId:null,balanceTransactionId:null,paymentMethodId:null,mandateId:null,failureCode: null, failureMessage: null,
      occurredAt: expect.any(String), supported: true, livemode: false,
    });
  });
  it("carries mapped refund amounts and the refund's own status into reconciliation",()=>{expect(normalizeStripeConnectEvent({id:"evt_refund",type:"refund.updated",account:"acct_kent",data:{object:{id:"re_1",amount:5000,status:"succeeded",metadata:{forge_payment_id:"payment_1"}}}})).toMatchObject({paymentId:"payment_1",refundStatus:"succeeded",refundedAmountCents:5000,supported:true});});

  it("carries a pending or failed refund's status too — callers, not this function, decide whether to act on it", () => {
    expect(normalizeStripeConnectEvent({
      id: "evt_refund_pending", type: "refund.updated", account: "acct_kent",
      data: { object: { id: "re_2", amount: 5000, status: "pending" } },
    })).toMatchObject({ refundStatus: "pending", refundedAmountCents: 5000 });
    expect(normalizeStripeConnectEvent({
      id: "evt_refund_failed", type: "refund.updated", account: "acct_kent",
      data: { object: { id: "re_3", amount: 5000, status: "failed" } },
    })).toMatchObject({ refundStatus: "failed", refundedAmountCents: 5000 });
  });

  it("refundStatus is null for a non-refund event even if the object happens to have a status field", () => {
    expect(normalizeStripeConnectEvent({
      id: "evt_pi", type: "payment_intent.succeeded", account: "acct_kent",
      data: { object: { id: "pi_9", status: "succeeded" } },
    })).toMatchObject({ refundStatus: null });
  });

  it("rejects platform events that do not identify a connected account", () => {
    expect(() => normalizeStripeConnectEvent({ id: "evt_1", type: "payment_intent.succeeded", data: { object: {} } }))
      .toThrow("connected account id");
  });

  it("resolves the connected account from transfer_data.destination on a platform PaymentIntent event", () => {
    expect(normalizeStripeConnectEvent({
      id: "evt_platform_1", type: "payment_intent.succeeded", livemode: false,
      data: { object: { id: "pi_1", transfer_data: { destination: "acct_landlord" }, metadata: { forge_payment_id: "payment_1" } } },
    })).toMatchObject({ connectedAccountId: "acct_landlord", eventType: "payment_intent.succeeded", paymentId: "payment_1", supported: true });
  });

  it("prefers event.account over transfer_data.destination when both are present", () => {
    expect(normalizeStripeConnectEvent({
      id: "evt_both", type: "payment_intent.processing", account: "acct_signed",
      data: { object: { id: "pi_2", transfer_data: { destination: "acct_other" } } },
    })).toMatchObject({ connectedAccountId: "acct_signed" });
  });

  it("rejects a platform event whose type is not a supported PaymentIntent event even if transfer_data.destination is present", () => {
    expect(() => normalizeStripeConnectEvent({
      id: "evt_untrusted", type: "account.updated",
      data: { object: { id: "acct_1", transfer_data: { destination: "acct_landlord" } } },
    })).toThrow("connected account id");
  });

  it("rejects a platform PaymentIntent event with neither event.account nor transfer_data.destination", () => {
    expect(() => normalizeStripeConnectEvent({
      id: "evt_bare", type: "payment_intent.succeeded", data: { object: { id: "pi_3" } },
    })).toThrow("connected account id");
  });
});
