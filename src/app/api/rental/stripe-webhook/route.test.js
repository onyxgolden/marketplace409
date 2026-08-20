import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  retrieveBalanceTransaction: vi.fn(),
  listPayoutBalanceTransactionIds: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  landlordSelect: vi.fn(),
  landlordEqProvider: vi.fn(),
  landlordEqAccount: vi.fn(),
  landlordMaybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: () => ({
    constructWebhookEvent: mocks.constructWebhookEvent,
    retrieveBalanceTransaction: mocks.retrieveBalanceTransaction,
    listPayoutBalanceTransactionIds: mocks.listPayoutBalanceTransactionIds,
  }),
}));

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: () => ({
    from: (table) => {
      if (table === "payment_webhook_events") return { upsert: mocks.upsert, update: mocks.update };
      if (table === "landlord_payment_accounts") return { select: mocks.landlordSelect };
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

    mocks.upsert.mockResolvedValue({ error: null });
    mocks.update.mockImplementation(() => ({ eq: mocks.updateEq }));
    mocks.updateEq.mockResolvedValue({ error: null });

    mocks.landlordSelect.mockImplementation(() => ({ eq: mocks.landlordEqProvider }));
    mocks.landlordEqProvider.mockImplementation(() => ({ eq: mocks.landlordEqAccount }));
    mocks.landlordEqAccount.mockImplementation(() => ({ maybeSingle: mocks.landlordMaybeSingle }));
    mocks.landlordMaybeSingle.mockResolvedValue({ data: { owner_id: "owner_1" }, error: null });

    mocks.rpc.mockResolvedValue({ error: null, data: {} });
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
});
