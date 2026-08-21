import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseAccountWebhookNotification: vi.fn(),
  retrieveAccountStatus: vi.fn(),
  eventsSelectEqProvider: vi.fn(),
  eventsSelectEqMode: vi.fn(),
  eventsSelectEqEventId: vi.fn(),
  eventsMaybeSingle: vi.fn(),
  eventsUpsert: vi.fn(async () => ({ error: null })),
  eventsUpdateEq: vi.fn(async () => ({ error: null })),
  landlordSelect: vi.fn(),
  landlordEqProvider: vi.fn(),
  landlordEqMode: vi.fn(),
  landlordEqAccount: vi.fn(),
  landlordMaybeSingle: vi.fn(),
  landlordUpdateEqOwner: vi.fn(),
  landlordUpdateEqProvider: vi.fn(),
  landlordUpdateEqMode: vi.fn(async () => ({ error: null })),
  rpc: vi.fn(),
}));

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: () => ({
    mode: "test",
    parseAccountWebhookNotification: mocks.parseAccountWebhookNotification,
    retrieveAccountStatus: mocks.retrieveAccountStatus,
  }),
}));

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: () => ({
    from: (table) => {
      if (table === "payment_webhook_events") {
        return {
          select: () => ({ eq: mocks.eventsSelectEqProvider }),
          upsert: mocks.eventsUpsert,
          update: () => ({ eq: mocks.eventsUpdateEq }),
        };
      }
      if (table === "landlord_payment_accounts") {
        mocks.landlordSelect();
        return {
          select: () => ({ eq: mocks.landlordEqProvider }),
          update: () => ({ eq: mocks.landlordUpdateEqOwner }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: mocks.rpc,
  }),
}));

import { POST } from "./route.js";

function request(headers = {}, body = "raw-thin-event-body") {
  return new Request("https://forge.test/api/rental/stripe-account-webhook", { method: "POST", headers, body });
}
function notification(overrides = {}) {
  return { id: "evt_thin_1", type: "v2.core.account[requirements].updated", livemode: false, related_object: { id: "acct_kent" }, ...overrides };
}
function accountStatus(overrides = {}) {
  return {
    mode: "test", accountClosed: false, chargesEnabled: false, payoutsEnabled: false, achDebitEnabled: false,
    cardPaymentsEnabled: false, onboardingStarted: true, requirementsDue: [], ...overrides,
  };
}
function wireNoExistingLedgerRow() {
  mocks.eventsSelectEqProvider.mockReturnValue({ eq: mocks.eventsSelectEqMode });
  mocks.eventsSelectEqMode.mockReturnValue({ eq: mocks.eventsSelectEqEventId });
  mocks.eventsSelectEqEventId.mockReturnValue({ maybeSingle: mocks.eventsMaybeSingle });
  mocks.eventsMaybeSingle.mockResolvedValue({ data: null, error: null });
}
function wireExistingLedgerRow(status) {
  mocks.eventsSelectEqProvider.mockReturnValue({ eq: mocks.eventsSelectEqMode });
  mocks.eventsSelectEqMode.mockReturnValue({ eq: mocks.eventsSelectEqEventId });
  mocks.eventsSelectEqEventId.mockReturnValue({ maybeSingle: mocks.eventsMaybeSingle });
  mocks.eventsMaybeSingle.mockResolvedValue({ data: { status }, error: null });
}
function wireLandlordLookup(result) {
  mocks.landlordEqProvider.mockReturnValue({ eq: mocks.landlordEqMode });
  mocks.landlordEqMode.mockReturnValue({ eq: mocks.landlordEqAccount });
  mocks.landlordEqAccount.mockReturnValue({ maybeSingle: mocks.landlordMaybeSingle });
  mocks.landlordMaybeSingle.mockResolvedValue(result);
}

describe("stripe account thin-event webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET = "whsec_account";
    mocks.landlordUpdateEqOwner.mockReturnValue({ eq: mocks.landlordUpdateEqProvider });
    mocks.landlordUpdateEqProvider.mockReturnValue({ eq: mocks.landlordUpdateEqMode });
    wireNoExistingLedgerRow();
  });

  it("rejects a request with no Stripe signature header", async () => {
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.parseAccountWebhookNotification).not.toHaveBeenCalled();
  });

  it("refuses to process when the dedicated account webhook secret is not configured, even with a signature present", async () => {
    delete process.env.STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET;
    const response = await POST(request({ "stripe-signature": "t=1,v1=abc" }));
    expect(response.status).toBe(500);
    expect(mocks.parseAccountWebhookNotification).not.toHaveBeenCalled();
  });

  it("rejects an invalid/unverifiable signature", async () => {
    mocks.parseAccountWebhookNotification.mockRejectedValue(new Error("No signatures found matching the expected signature for payload"));
    const response = await POST(request({ "stripe-signature": "t=1,v1=bad" }));
    expect(response.status).toBe(400);
  });

  it("retrieves the full V2 event before applying any account state, then syncs the matching owner's account", async () => {
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification());
    mocks.retrieveAccountStatus.mockResolvedValue(accountStatus());
    wireLandlordLookup({ data: { owner_id: "owner_1" }, error: null });

    const response = await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    expect(response.status).toBe(200);
    expect(mocks.parseAccountWebhookNotification).toHaveBeenCalledWith("raw-thin-event-body", "t=1,v1=ok", "whsec_account");
    expect(mocks.retrieveAccountStatus).toHaveBeenCalledWith({ ownerId: "owner_1", connectedAccountId: "acct_kent" });
    expect(mocks.landlordUpdateEqOwner).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(mocks.landlordUpdateEqMode).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("scopes the duplicate-delivery lookup by the server's configured provider_mode, not just provider and provider_event_id", async () => {
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification());
    mocks.retrieveAccountStatus.mockResolvedValue(accountStatus());
    wireLandlordLookup({ data: { owner_id: "owner_1" }, error: null });
    await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    expect(mocks.eventsSelectEqProvider).toHaveBeenCalledWith("provider", "stripe");
    expect(mocks.eventsSelectEqMode).toHaveBeenCalledWith("provider_mode", "test");
    expect(mocks.eventsSelectEqEventId).toHaveBeenCalledWith("provider_event_id", "evt_thin_1");
  });

  it("upserts payment_webhook_events with the three-column post-migration conflict target", async () => {
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification());
    mocks.retrieveAccountStatus.mockResolvedValue(accountStatus());
    wireLandlordLookup({ data: { owner_id: "owner_1" }, error: null });
    await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    expect(mocks.eventsUpsert).toHaveBeenCalledWith(expect.anything(), { onConflict: "provider,provider_mode,provider_event_id" });
  });

  it("a livemode mismatch (live event on a test server) performs zero business mutations", async () => {
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification({ livemode: true })); // server mode is "test"
    const response = await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, ignored: true });
    expect(mocks.retrieveAccountStatus).not.toHaveBeenCalled();
    expect(mocks.landlordSelect).not.toHaveBeenCalled();
    expect(mocks.eventsUpsert).toHaveBeenCalledWith(expect.objectContaining({
      status: "ignored", failure_message: "Event livemode does not match the server's configured Stripe mode.",
    }), expect.anything());
  });

  it("a matching-mode event still ignores an unrelated/unsupported thin event type without touching landlord_payment_accounts", async () => {
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification({ type: "v2.core.account_link.returned" }));
    const response = await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, ignored: true });
    expect(mocks.retrieveAccountStatus).not.toHaveBeenCalled();
    expect(mocks.landlordSelect).not.toHaveBeenCalled();
  });

  it("ignores an event for an unknown connected account without throwing", async () => {
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification());
    wireLandlordLookup({ data: null, error: null });
    const response = await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, ignored: true });
    expect(mocks.retrieveAccountStatus).not.toHaveBeenCalled();
  });

  it("a duplicate delivery of an already-processed event short-circuits without re-querying Stripe", async () => {
    wireExistingLedgerRow("processed");
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification());
    const response = await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: true });
    expect(mocks.retrieveAccountStatus).not.toHaveBeenCalled();
    expect(mocks.eventsUpsert).not.toHaveBeenCalled();
  });

  it("a retry after a transient failure (row stuck at 'received') is allowed to run and can succeed", async () => {
    wireExistingLedgerRow("received"); // a prior attempt started but never reached 'processed'
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification());
    mocks.retrieveAccountStatus.mockResolvedValue(accountStatus());
    wireLandlordLookup({ data: { owner_id: "owner_1" }, error: null });

    const response = await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    expect(response.status).toBe(200);
    expect(mocks.retrieveAccountStatus).toHaveBeenCalledTimes(1);
    expect(mocks.eventsUpdateEq).toHaveBeenCalledWith("id", "stripe_account_webhook_evt_thin_1"); // final 'processed' write happened
  });

  it("processing the same thin event twice end-to-end (before either reaches 'processed') is harmless — same final state, not doubled", async () => {
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification());
    mocks.retrieveAccountStatus.mockResolvedValue(accountStatus());
    wireLandlordLookup({ data: { owner_id: "owner_1" }, error: null });

    await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    wireNoExistingLedgerRow(); // simulate the second delivery also finding no settled row yet (concurrent race)
    await POST(request({ "stripe-signature": "t=1,v1=ok" }));

    // The update is a plain field-setting UPDATE (idempotent by construction) — both calls must
    // have written the exact same target row/values, never an incrementing or divergent state.
    const updateCalls = mocks.landlordUpdateEqOwner.mock.calls;
    expect(updateCalls.length).toBe(2);
    expect(updateCalls[0]).toEqual(updateCalls[1]);
  });

  it("never mutates payments, charges, refunds, payouts, or settlements — only landlord_payment_accounts and its own event ledger", async () => {
    mocks.parseAccountWebhookNotification.mockResolvedValue(notification({ type: "v2.core.account[configuration.merchant].capability_status_updated" }));
    mocks.retrieveAccountStatus.mockResolvedValue(accountStatus());
    wireLandlordLookup({ data: { owner_id: "owner_1" }, error: null });

    await POST(request({ "stripe-signature": "t=1,v1=ok" }));
    // The mocked client throws on any table name other than payment_webhook_events /
    // landlord_payment_accounts — reaching this line without an unhandled rejection already
    // proves no other table was touched. rpc() must also never be called.
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sanitizes the failure response and never logs the raw error message, body, or headers", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.parseAccountWebhookNotification.mockRejectedValue(new Error("signature mismatch for account acct_secret123"));
    const response = await POST(request({ "stripe-signature": "t=1,v1=bad" }, "top-secret-raw-body-content"));
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("top-secret-raw-body-content");
    expect(body).toEqual({ error: "Invalid Stripe account webhook." });
    const loggedArgs = consoleSpy.mock.calls.flat();
    expect(JSON.stringify(loggedArgs)).not.toContain("acct_secret123");
    expect(JSON.stringify(loggedArgs)).not.toContain("signature mismatch");
    consoleSpy.mockRestore();
  });
});
