import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  retrieveBalanceTransaction: vi.fn(),
  listPayoutBalanceTransactionIds: vi.fn(),
  upsert: vi.fn(),
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
    from: () => ({ upsert: mocks.upsert }),
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
    mocks.rpc.mockResolvedValue({ error: null, data: {} });
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

  it("accepts a platform event signed with the platform secret", async () => {
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
});
