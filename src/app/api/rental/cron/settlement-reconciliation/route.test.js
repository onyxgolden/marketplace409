import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRentalWebhookClient: vi.fn(),
  retrievePaymentIntentSettlement: vi.fn(),
  retrieveBalanceTransaction: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: mocks.createRentalWebhookClient,
}));

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: () => ({
    mode: "test",
    retrievePaymentIntentSettlement: mocks.retrievePaymentIntentSettlement,
    retrieveBalanceTransaction: mocks.retrieveBalanceTransaction,
  }),
}));

import { GET } from "./route.js";

function request(headers = {}) {
  return new Request("https://test/api/rental/cron/settlement-reconciliation", { headers });
}

function query(result) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    not: vi.fn(() => node),
    limit: vi.fn(() => node),
    in: vi.fn(() => node),
    then: (resolve) => resolve(result),
  };
  return node;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  mocks.retrievePaymentIntentSettlement.mockResolvedValue({
    paymentIntentId: "pi_20", chargeId: "ch_20", balanceTransactionId: "txn_20",
  });
  mocks.retrieveBalanceTransaction.mockResolvedValue({
    id: "txn_20",
    grossAmountCents: 2000,
    feeAmountCents: 0,
    netAmountCents: 2000,
    currencyCode: "USD",
    status: "pending",
    availableAt: "2026-08-27T00:00:00.000Z",
  });
  mocks.rpc.mockResolvedValue({ data: { status: "processed" }, error: null });
});

describe("rental settlement reconciliation cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.createRentalWebhookClient).not.toHaveBeenCalled();
  });

  it("records a successful Stripe payment that has no settlement row", async () => {
    const tables = {
      rental_payments: query({ data: [
        { id: "payment_20", owner_id: "owner_1", provider_payment_id: "pi_20" },
      ], error: null }),
      rental_settlements: query({ data: [], error: null }),
      landlord_payment_accounts: query({ data: [
        { owner_id: "owner_1", provider_account_id: "acct_landlord" },
      ], error: null }),
    };
    mocks.createRentalWebhookClient.mockReturnValue({
      from: vi.fn((table) => tables[table]),
      rpc: mocks.rpc,
    });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true, candidates: 1, reconciled: 1, pending: 0, failed: 0,
    });
    expect(mocks.retrievePaymentIntentSettlement).toHaveBeenCalledWith(
      { connectedAccountId: "acct_landlord" }, "pi_20",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("record_stripe_rental_settlement",
      expect.objectContaining({
        p_provider_event_id: "settlement_reconciliation_pi_20_txn_20",
        p_payment_intent_id: "pi_20",
        p_balance_transaction_id: "txn_20",
        p_gross_amount_cents: 2000,
        p_net_amount_cents: 2000,
        p_provider_mode: "test",
      }));
  });

  it("scopes both the payment-candidate query and the landlord-account query to the server's provider_mode — a live run excludes sandbox payments", async () => {
    const tables = {
      rental_payments: query({ data: [
        { id: "payment_20", owner_id: "owner_1", provider_payment_id: "pi_20" },
      ], error: null }),
      rental_settlements: query({ data: [], error: null }),
      landlord_payment_accounts: query({ data: [
        { owner_id: "owner_1", provider_account_id: "acct_landlord" },
      ], error: null }),
    };
    mocks.createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => tables[table]), rpc: mocks.rpc });

    await GET(request({ authorization: "Bearer cron-secret" }));

    expect(tables.rental_payments.eq).toHaveBeenCalledWith("provider_mode", "test");
    expect(tables.landlord_payment_accounts.eq).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("skips payments that already have settlement rows", async () => {
    const tables = {
      rental_payments: query({ data: [
        { id: "payment_20", owner_id: "owner_1", provider_payment_id: "pi_20" },
      ], error: null }),
      rental_settlements: query({ data: [{ payment_id: "payment_20" }], error: null }),
      landlord_payment_accounts: query({ data: [
        { owner_id: "owner_1", provider_account_id: "acct_landlord" },
      ], error: null }),
    };
    mocks.createRentalWebhookClient.mockReturnValue({
      from: vi.fn((table) => tables[table]),
      rpc: mocks.rpc,
    });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();

    expect(body.candidates).toBe(0);
    expect(mocks.retrievePaymentIntentSettlement).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps an unsettled PaymentIntent pending without writing a partial settlement", async () => {
    mocks.retrievePaymentIntentSettlement.mockResolvedValue({
      paymentIntentId: "pi_20", chargeId: "ch_20", balanceTransactionId: null,
    });
    const tables = {
      rental_payments: query({ data: [
        { id: "payment_20", owner_id: "owner_1", provider_payment_id: "pi_20" },
      ], error: null }),
      rental_settlements: query({ data: [], error: null }),
      landlord_payment_accounts: query({ data: [
        { owner_id: "owner_1", provider_account_id: "acct_landlord" },
      ], error: null }),
    };
    mocks.createRentalWebhookClient.mockReturnValue({
      from: vi.fn((table) => tables[table]),
      rpc: mocks.rpc,
    });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();

    expect(body).toMatchObject({ candidates: 1, reconciled: 0, pending: 1, failed: 0 });
    expect(mocks.retrieveBalanceTransaction).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
