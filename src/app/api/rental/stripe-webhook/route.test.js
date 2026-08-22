import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  retrieveCharge: vi.fn(),
  retrieveBalanceTransaction: vi.fn(),
  listPayoutBalanceTransactionIds: vi.fn(),
  eventsSelect: vi.fn(),
  eventsSelectEqProvider: vi.fn(),
  eventsSelectEqMode: vi.fn(),
  eventsSelectEqEventId: vi.fn(),
  eventsMaybeSingle: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  landlordSelect: vi.fn(),
  landlordEqProvider: vi.fn(),
  landlordEqMode: vi.fn(),
  landlordEqAccount: vi.fn(),
  landlordMaybeSingle: vi.fn(),
  rentalPaymentsSelect: vi.fn(),
  rentalPaymentsEqOwner: vi.fn(),
  rentalPaymentsEqProvider: vi.fn(),
  rentalPaymentsEqMode: vi.fn(),
  rentalPaymentsEqPaymentIntent: vi.fn(),
  rentalPaymentsMaybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: () => ({
    mode: "test",
    constructWebhookEvent: mocks.constructWebhookEvent,
    retrieveCharge: mocks.retrieveCharge,
    retrieveBalanceTransaction: mocks.retrieveBalanceTransaction,
    listPayoutBalanceTransactionIds: mocks.listPayoutBalanceTransactionIds,
  }),
}));

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: () => ({
    from: (table) => {
      if (table === "payment_webhook_events") return { select: mocks.eventsSelect, upsert: mocks.upsert, update: mocks.update };
      if (table === "landlord_payment_accounts") return { select: mocks.landlordSelect };
      if (table === "rental_payments") return { select: mocks.rentalPaymentsSelect };
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: mocks.rpc,
  }),
}));

import { POST } from "./route.js";

const CONNECT_SECRET = "whsec_connect_test";
const PLATFORM_SECRET = "whsec_platform_test";

const connectEvent = {
  id: "evt_connect_1", type: "payment_intent.processing", account: "acct_landlord", livemode: false,
  data: { object: { id: "pi_1", metadata: { forge_payment_id: "payment_1" } } },
};

const platformEvent = {
  id: "evt_platform_1", type: "payment_intent.succeeded", livemode: false,
  data: { object: { id: "pi_2", transfer_data: { destination: "acct_landlord" }, metadata: { forge_payment_id: "payment_1" }, payment_method: "pm_1" } },
};

const knownAccountBalanceAvailable = {
  id: "evt_balance_1", type: "balance.available", account: "acct_landlord", livemode: false,
  data: { object: { id: "bal_1" } },
};

const unknownAccountPersonUpdated = {
  id: "evt_unknown_person_1", type: "person.updated", account: "acct_unknown", livemode: false,
  data: { object: { id: "person_1" } },
};

const unknownAccountPaymentIntent = {
  id: "evt_unknown_pi_1", type: "payment_intent.processing", account: "acct_unknown", livemode: false,
  data: { object: { id: "pi_unknown", metadata: { forge_payment_id: "payment_x" } } },
};

const delayedChargeSucceeded = {
  id: "evt_charge_succeeded_delayed", type: "charge.succeeded", account: "acct_landlord", livemode: false,
  data: { object: { id: "ch_delayed", payment_intent: "pi_delayed", balance_transaction: null } },
};

const chargeUpdatedWithSettlement = {
  id: "evt_charge_updated_ready", type: "charge.updated", account: "acct_landlord", livemode: false,
  data: { object: { id: "ch_delayed", payment_intent: "pi_delayed", balance_transaction: "txn_delayed" } },
};

const unknownAccountChargeSucceeded = {
  id: "evt_unknown_charge_1", type: "charge.succeeded", account: "acct_unknown", livemode: false,
  data: { object: { id: "ch_1", payment_intent: "pi_9", balance_transaction: "txn_9" } },
};

function request(signature = "sig_test") {
  const headers = signature ? { "stripe-signature": signature } : {};
  return new Request("http://localhost/api/rental/stripe-webhook", { method: "POST", headers, body: "raw-body" });
}

function signsOnlyWith(secret, event) {
  mocks.constructWebhookEvent.mockImplementation((rawBody, signature, usedSecret) => {
    if (usedSecret === secret) return event;
    throw new Error("No signatures found matching the expected signature for payload");
  });
}

describe("Stripe rental webhook route", () => {
  let savedConnectSecret;
  let savedPlatformSecret;

  beforeEach(() => {
    vi.clearAllMocks();
    savedConnectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    savedPlatformSecret = process.env.STRIPE_WEBHOOK_SECRET_PLATFORM;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET_PLATFORM = PLATFORM_SECRET;

    mocks.eventsSelect.mockImplementation(() => ({ eq: mocks.eventsSelectEqProvider }));
    mocks.eventsSelectEqProvider.mockImplementation(() => ({ eq: mocks.eventsSelectEqMode }));
    mocks.eventsSelectEqMode.mockImplementation(() => ({ eq: mocks.eventsSelectEqEventId }));
    mocks.eventsSelectEqEventId.mockImplementation(() => ({ maybeSingle: mocks.eventsMaybeSingle }));
    mocks.eventsMaybeSingle.mockResolvedValue({ data: null, error: null }); // no prior delivery of this event

    mocks.upsert.mockResolvedValue({ error: null });
    mocks.update.mockImplementation(() => ({ eq: mocks.updateEq }));
    mocks.updateEq.mockResolvedValue({ error: null });

    mocks.landlordSelect.mockImplementation(() => ({ eq: mocks.landlordEqProvider }));
    mocks.landlordEqProvider.mockImplementation(() => ({ eq: mocks.landlordEqMode }));
    mocks.landlordEqMode.mockImplementation(() => ({ eq: mocks.landlordEqAccount }));
    mocks.landlordEqAccount.mockImplementation(() => ({ maybeSingle: mocks.landlordMaybeSingle }));
    mocks.landlordMaybeSingle.mockResolvedValue({ data: { owner_id: "owner_1" }, error: null });

    mocks.rentalPaymentsSelect.mockImplementation(() => ({ eq: mocks.rentalPaymentsEqOwner }));
    mocks.rentalPaymentsEqOwner.mockImplementation(() => ({ eq: mocks.rentalPaymentsEqProvider }));
    mocks.rentalPaymentsEqProvider.mockImplementation(() => ({ eq: mocks.rentalPaymentsEqMode }));
    mocks.rentalPaymentsEqMode.mockImplementation(() => ({ eq: mocks.rentalPaymentsEqPaymentIntent }));
    mocks.rentalPaymentsEqPaymentIntent.mockImplementation(() => ({ maybeSingle: mocks.rentalPaymentsMaybeSingle }));
    mocks.rentalPaymentsMaybeSingle.mockResolvedValue({ data: null, error: null });

    mocks.rpc.mockResolvedValue({ error: null, data: {} });
    mocks.retrieveCharge.mockResolvedValue({
      id: "ch_delayed", paymentIntentId: "pi_delayed", balanceTransactionId: "txn_delayed",
    });
    mocks.retrieveBalanceTransaction.mockResolvedValue({
      id: "txn_1", grossAmountCents: 1000, feeAmountCents: 30, netAmountCents: 970,
      currencyCode: "USD", status: "available", availableAt: null,
    });
  });

  afterEach(() => {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = savedConnectSecret;
    process.env.STRIPE_WEBHOOK_SECRET_PLATFORM = savedPlatformSecret;
  });

  it("accepts a Connect event signed with the Connect secret", async () => {
    signsOnlyWith(CONNECT_SECRET, connectEvent);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.constructWebhookEvent).toHaveBeenCalledWith("raw-body", "sig_test", CONNECT_SECRET);
  });

  it("accepts a platform destination-charge event signed with the platform secret", async () => {
    signsOnlyWith(PLATFORM_SECRET, platformEvent);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.constructWebhookEvent).toHaveBeenCalledWith("raw-body", "sig_test", PLATFORM_SECRET);
    expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_payment_event",
      expect.objectContaining({ p_connected_account_id: "acct_landlord" }));
  });

  it("rejects a webhook whose signature does not validate against either configured secret", async () => {
    mocks.constructWebhookEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("still verifies against the Connect secret alone when the platform secret is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET_PLATFORM;
    signsOnlyWith(CONNECT_SECRET, connectEvent);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.constructWebhookEvent).toHaveBeenCalledWith("raw-body", "sig_test", CONNECT_SECRET);
    expect(mocks.constructWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsigned request without attempting verification", async () => {
    const response = await POST(request(null));
    expect(response.status).toBe(400);
    expect(mocks.constructWebhookEvent).not.toHaveBeenCalled();
  });

  it("still returns 200 for a known-account non-payment event such as balance.available", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { status: "ignored" } });
    signsOnlyWith(CONNECT_SECRET, knownAccountBalanceAvailable);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_payment_event",
      expect.objectContaining({ p_connected_account_id: "acct_landlord" }));
  });

  it("recovers a balance transaction that was attached after charge.succeeded was emitted", async () => {
    signsOnlyWith(CONNECT_SECRET, delayedChargeSucceeded);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.retrieveCharge).toHaveBeenCalledWith(
      { connectedAccountId: "acct_landlord" }, "ch_delayed",
    );
    expect(mocks.retrieveBalanceTransaction).toHaveBeenCalledWith(
      { connectedAccountId: "acct_landlord" }, "txn_delayed",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("record_stripe_rental_settlement",
      expect.objectContaining({
        p_provider_event_id: "evt_charge_succeeded_delayed",
        p_payment_intent_id: "pi_delayed",
        p_balance_transaction_id: "txn_1",
      }));
  });

  it("records settlement from charge.updated instead of silently ignoring it", async () => {
    signsOnlyWith(CONNECT_SECRET, chargeUpdatedWithSettlement);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.retrieveCharge).toHaveBeenCalledWith(
      { connectedAccountId: "acct_landlord" }, "ch_delayed",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("record_stripe_rental_settlement",
      expect.objectContaining({
        p_provider_event_id: "evt_charge_updated_ready",
        p_payment_intent_id: "pi_delayed",
        p_balance_transaction_id: "txn_1",
      }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("process_stripe_rental_payment_event", expect.anything());
  });

  it("returns a retryable failure while Stripe has not attached settlement identifiers", async () => {
    mocks.retrieveCharge.mockResolvedValue({
      id: "ch_delayed", paymentIntentId: "pi_delayed", balanceTransactionId: null,
    });
    signsOnlyWith(CONNECT_SECRET, delayedChargeSucceeded);
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns 200 for a validly-signed event from an unknown/retired connected account", async () => {
    mocks.landlordMaybeSingle.mockResolvedValue({ data: null, error: null });
    signsOnlyWith(CONNECT_SECRET, unknownAccountPersonUpdated);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
  });

  it("checks landlord_payment_accounts for provider='stripe' and the normalized connected account id", async () => {
    mocks.landlordMaybeSingle.mockResolvedValue({ data: null, error: null });
    signsOnlyWith(CONNECT_SECRET, unknownAccountPersonUpdated);
    await POST(request());
    expect(mocks.landlordSelect).toHaveBeenCalled();
    expect(mocks.landlordEqProvider).toHaveBeenCalledWith("provider", "stripe");
    expect(mocks.landlordEqAccount).toHaveBeenCalledWith("provider_account_id", "acct_unknown");
  });

  it("records an unknown-account event as ignored in payment_webhook_events with audit evidence", async () => {
    mocks.landlordMaybeSingle.mockResolvedValue({ data: null, error: null });
    signsOnlyWith(CONNECT_SECRET, unknownAccountPersonUpdated);
    await POST(request());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "ignored",
      processed_at: expect.any(String),
      failure_message: expect.stringContaining("acct_unknown"),
    }));
    expect(mocks.updateEq).toHaveBeenCalledWith("id", "stripe_webhook_evt_unknown_person_1");
  });

  it("does not call process_stripe_rental_payment_event for an unknown connected account", async () => {
    mocks.landlordMaybeSingle.mockResolvedValue({ data: null, error: null });
    signsOnlyWith(CONNECT_SECRET, unknownAccountPaymentIntent);
    await POST(request());
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not call settlement, payout, refund, or autopay RPCs (or provider lookups) for an unknown connected account", async () => {
    mocks.landlordMaybeSingle.mockResolvedValue({ data: null, error: null });
    signsOnlyWith(CONNECT_SECRET, unknownAccountChargeSucceeded);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.retrieveCharge).not.toHaveBeenCalled();
    expect(mocks.retrieveBalanceTransaction).not.toHaveBeenCalled();
    expect(mocks.listPayoutBalanceTransactionIds).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not infer ownership from event metadata when the connected account is unknown", async () => {
    mocks.landlordMaybeSingle.mockResolvedValue({ data: null, error: null });
    signsOnlyWith(CONNECT_SECRET, {
      id: "evt_unknown_metadata_1", type: "payment_intent.succeeded", account: "acct_unknown", livemode: false,
      data: { object: { id: "pi_unknown_2", metadata: { forge_payment_id: "payment_x", forge_owner_id: "owner_1" }, payment_method: "pm_1" } },
    });
    await POST(request());
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("remains idempotent across repeated delivery of the same unknown-account event", async () => {
    mocks.landlordMaybeSingle.mockResolvedValue({ data: null, error: null });
    signsOnlyWith(CONNECT_SECRET, unknownAccountPersonUpdated);
    const first = await POST(request());
    const second = await POST(request());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("propagates a real database error from the ownership lookup as a 400 instead of silently ignoring it", async () => {
    mocks.landlordMaybeSingle.mockResolvedValue({ data: null, error: { message: "connection reset", code: "08006" } });
    signsOnlyWith(CONNECT_SECRET, unknownAccountPersonUpdated);
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("scopes the duplicate-delivery lookup by the server's configured provider_mode, not just provider and provider_event_id", async () => {
    signsOnlyWith(CONNECT_SECRET, connectEvent);
    await POST(request());
    expect(mocks.eventsSelectEqProvider).toHaveBeenCalledWith("provider", "stripe");
    expect(mocks.eventsSelectEqMode).toHaveBeenCalledWith("provider_mode", "test");
    expect(mocks.eventsSelectEqEventId).toHaveBeenCalledWith("provider_event_id", connectEvent.id);
  });

  it("upserts payment_webhook_events with the three-column post-migration conflict target", async () => {
    signsOnlyWith(CONNECT_SECRET, connectEvent);
    await POST(request());
    expect(mocks.upsert).toHaveBeenCalledWith(expect.anything(), { onConflict: "provider,provider_mode,provider_event_id" });
  });

  it("scopes the landlord lookup by the server's configured provider_mode", async () => {
    signsOnlyWith(CONNECT_SECRET, connectEvent);
    await POST(request());
    expect(mocks.landlordEqMode).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("threads the server's provider_mode into record_stripe_rental_settlement and activate_rental_autopay_from_payment", async () => {
    signsOnlyWith(CONNECT_SECRET, delayedChargeSucceeded);
    await POST(request());
    expect(mocks.rpc).toHaveBeenCalledWith("record_stripe_rental_settlement", expect.objectContaining({ p_provider_mode: "test" }));

    mocks.rpc.mockClear();
    signsOnlyWith(PLATFORM_SECRET, platformEvent);
    await POST(request());
    expect(mocks.rpc).toHaveBeenCalledWith("activate_rental_autopay_from_payment", expect.objectContaining({ p_provider_mode: "test" }));
  });

  it("threads the server's provider_mode into process_stripe_rental_payment_event, process_stripe_rental_refund_event, and mark_stripe_rental_settlements_paid_out", async () => {
    signsOnlyWith(CONNECT_SECRET, knownAccountBalanceAvailable);
    await POST(request());
    expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_payment_event", expect.objectContaining({ p_provider_mode: "test" }));

    mocks.rpc.mockClear();
    signsOnlyWith(CONNECT_SECRET, {
      id: "evt_refund_1", type: "refund.updated", account: "acct_landlord", livemode: false,
      data: { object: { id: "re_1", amount: 5000, status: "succeeded", metadata: { forge_payment_id: "payment_1" } } },
    });
    await POST(request());
    expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_refund_event", expect.objectContaining({ p_provider_mode: "test", p_payment_id: "payment_1" }));

    mocks.rpc.mockClear();
    signsOnlyWith(CONNECT_SECRET, {
      id: "evt_payout_1", type: "payout.paid", account: "acct_landlord", livemode: false,
      data: { object: { id: "po_1" } },
    });
    await POST(request());
    expect(mocks.rpc).toHaveBeenCalledWith("mark_stripe_rental_settlements_paid_out", expect.objectContaining({ p_provider_mode: "test" }));
  });

  // Regression guards for the live incident: a Dashboard-created refund never carries
  // forge_payment_id metadata, and refund.updated fires on every status transition — not just
  // completion. Both defects let a pending/failed refund attempt to reverse rent, or a real
  // succeeded refund fail outright with "Mapped Stripe refund evidence is required."
  describe("refund.updated handling", () => {
    function refundEvent(overrides = {}) {
      return {
        id: "evt_refund_status", type: "refund.updated", account: "acct_landlord", livemode: false,
        data: { object: { id: "re_status", amount: 100, status: "succeeded", ...overrides } },
      };
    }

    it("ignores a pending refund without calling the refund RPC — a refund in progress must never reverse rent", async () => {
      signsOnlyWith(CONNECT_SECRET, refundEvent({ status: "pending", metadata: { forge_payment_id: "payment_1" } }));
      const response = await POST(request());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true, ignored: true });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("ignores a failed refund without calling the refund RPC", async () => {
      signsOnlyWith(CONNECT_SECRET, refundEvent({ status: "failed", metadata: { forge_payment_id: "payment_1" } }));
      await POST(request());
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("resolves the payment via provider_payment_id when the refund carries no forge_payment_id metadata (a Dashboard-created refund)", async () => {
      mocks.rentalPaymentsMaybeSingle.mockResolvedValue({ data: { id: "payment_resolved" }, error: null });
      signsOnlyWith(CONNECT_SECRET, refundEvent({ payment_intent: "pi_resolved" }));
      await POST(request());
      expect(mocks.rentalPaymentsEqOwner).toHaveBeenCalledWith("owner_id", "owner_1");
      expect(mocks.rentalPaymentsEqProvider).toHaveBeenCalledWith("provider", "stripe");
      expect(mocks.rentalPaymentsEqMode).toHaveBeenCalledWith("provider_mode", "test");
      expect(mocks.rentalPaymentsEqPaymentIntent).toHaveBeenCalledWith("provider_payment_id", "pi_resolved");
      expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_refund_event", expect.objectContaining({ p_payment_id: "payment_resolved" }));
    });

    it("prefers forge_payment_id metadata over the provider_payment_id lookup when both are available", async () => {
      signsOnlyWith(CONNECT_SECRET, refundEvent({ payment_intent: "pi_1", metadata: { forge_payment_id: "payment_direct" } }));
      await POST(request());
      expect(mocks.rentalPaymentsSelect).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_refund_event", expect.objectContaining({ p_payment_id: "payment_direct" }));
    });

    it("a partial refund amount still resolves the payment via provider_payment_id and threads the exact amount through", async () => {
      mocks.rentalPaymentsMaybeSingle.mockResolvedValue({ data: { id: "payment_resolved" }, error: null });
      signsOnlyWith(CONNECT_SECRET, refundEvent({ amount: 40, payment_intent: "pi_resolved" }));
      await POST(request());
      expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_refund_event", expect.objectContaining({ p_payment_id: "payment_resolved", p_refunded_amount_cents: 40 }));
    });

    it("passes p_payment_id null to the RPC when no match is found by either metadata or provider_payment_id — never guesses", async () => {
      mocks.rentalPaymentsMaybeSingle.mockResolvedValue({ data: null, error: null });
      signsOnlyWith(CONNECT_SECRET, refundEvent({ payment_intent: "pi_unmatched" }));
      await POST(request());
      expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_refund_event", expect.objectContaining({ p_payment_id: null }));
    });

    it("a duplicate delivery of an already-processed succeeded refund short-circuits without calling the RPC again", async () => {
      mocks.eventsMaybeSingle.mockResolvedValue({ data: { status: "processed" }, error: null });
      signsOnlyWith(CONNECT_SECRET, refundEvent({ metadata: { forge_payment_id: "payment_1" } }));
      const response = await POST(request());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true, duplicate: true });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  });

  it("a livemode mismatch (a live event delivered to a test-configured server) performs zero business mutations", async () => {
    signsOnlyWith(CONNECT_SECRET, { ...connectEvent, livemode: true }); // server mode is "test"
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(mocks.landlordSelect).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: "ignored", failure_message: "Event livemode does not match the server's configured Stripe mode.",
    }), expect.anything());
  });

  it("a duplicate delivery of an already-processed event short-circuits without re-touching business tables", async () => {
    mocks.eventsMaybeSingle.mockResolvedValue({ data: { status: "processed" }, error: null });
    signsOnlyWith(CONNECT_SECRET, connectEvent);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: true });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("a retry after a transient failure (row stuck at 'received') is allowed to run and can succeed", async () => {
    mocks.eventsMaybeSingle.mockResolvedValue({ data: { status: "received" }, error: null });
    signsOnlyWith(CONNECT_SECRET, connectEvent);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("process_stripe_rental_payment_event", expect.anything());
  });

  it("never logs the raw error message, only a coarse classification", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.constructWebhookEvent.mockImplementation(() => { throw new Error("signature mismatch for acct_secret123"); });
    await POST(request());
    const logged = JSON.stringify(consoleSpy.mock.calls.flat());
    expect(logged).not.toContain("acct_secret123");
    expect(logged).not.toContain("signature mismatch");
    consoleSpy.mockRestore();
  });
});
