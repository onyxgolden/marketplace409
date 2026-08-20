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
      }));
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

function cronRunsTable() {
  return { insert: vi.fn(async () => ({ error: null })), update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) };
}
function tablesWithCronRuns(base, cronRuns) {
  return { ...base, rental_cron_runs: cronRuns };
}

describe("rental settlement reconciliation cron audit trail", () => {
  it("records exactly one completed audit row, finalizing the same running row, with mapped counts", async () => {
    const cronRuns = cronRunsTable();
    const tables = tablesWithCronRuns({
      rental_payments: query({ data: [{ id: "payment_20", owner_id: "owner_1", provider_payment_id: "pi_20" }], error: null }),
      rental_settlements: query({ data: [], error: null }),
      landlord_payment_accounts: query({ data: [{ owner_id: "owner_1", provider_account_id: "acct_landlord" }], error: null }),
    }, cronRuns);
    mocks.createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => tables[table]), rpc: mocks.rpc });

    const response = await GET(request({ authorization: "Bearer cron-secret", "user-agent": "vercel-cron/1.0" }));
    expect(response.status).toBe(200);

    expect(cronRuns.insert).toHaveBeenCalledTimes(1);
    const [insertedRow] = cronRuns.insert.mock.calls[0];
    expect(insertedRow).toMatchObject({
      job_name: "settlement-reconciliation", route_path: "/api/rental/cron/settlement-reconciliation",
      trigger_source: "vercel_cron", status: "running",
    });
    expect(cronRuns.update).toHaveBeenCalledTimes(1);
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch).toMatchObject({ status: "succeeded", processed_count: 1, succeeded_count: 1, pending_count: 0, failed_count: 0 });
    expect(patch.result_summary).toMatchObject({ success: true, candidates: 1, reconciled: 1, pending: 0, failed: 0 });
    const eqMock = cronRuns.update.mock.results[0].value.eq;
    expect(eqMock).toHaveBeenCalledWith("id", insertedRow.id);
  });

  it("classifies a pending-only outcome as partially_succeeded, not succeeded", async () => {
    mocks.retrievePaymentIntentSettlement.mockResolvedValue({ paymentIntentId: "pi_20", chargeId: "ch_20", balanceTransactionId: null });
    const cronRuns = cronRunsTable();
    const tables = tablesWithCronRuns({
      rental_payments: query({ data: [{ id: "payment_20", owner_id: "owner_1", provider_payment_id: "pi_20" }], error: null }),
      rental_settlements: query({ data: [], error: null }),
      landlord_payment_accounts: query({ data: [{ owner_id: "owner_1", provider_account_id: "acct_landlord" }], error: null }),
    }, cronRuns);
    mocks.createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => tables[table]), rpc: mocks.rpc });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(200);
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch).toMatchObject({ status: "partially_succeeded", succeeded_count: 0, pending_count: 1, failed_count: 0 });
  });

  it("stays idempotent (does not re-reconcile an already-settled payment) whether or not the audit table is available", async () => {
    const cronRuns = cronRunsTable();
    const tables = tablesWithCronRuns({
      rental_payments: query({ data: [{ id: "payment_20", owner_id: "owner_1", provider_payment_id: "pi_20" }], error: null }),
      rental_settlements: query({ data: [{ payment_id: "payment_20" }], error: null }),
      landlord_payment_accounts: query({ data: [{ owner_id: "owner_1", provider_account_id: "acct_landlord" }], error: null }),
    }, cronRuns);
    mocks.createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => tables[table]), rpc: mocks.rpc });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(body).toMatchObject({ candidates: 0, reconciled: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch).toMatchObject({ status: "succeeded", processed_count: 0, succeeded_count: 0 });
  });

  it("still reconciles correctly, without repeating or corrupting settlement work, even when the audit write fails", async () => {
    const tables = {
      rental_payments: query({ data: [{ id: "payment_20", owner_id: "owner_1", provider_payment_id: "pi_20" }], error: null }),
      rental_settlements: query({ data: [], error: null }),
      landlord_payment_accounts: query({ data: [{ owner_id: "owner_1", provider_account_id: "acct_landlord" }], error: null }),
    };
    mocks.createRentalWebhookClient.mockReturnValue({
      from: vi.fn((table) => { if (table === "rental_cron_runs") throw new Error("audit unavailable"); return tables[table]; }),
      rpc: mocks.rpc,
    });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, candidates: 1, reconciled: 1, pending: 0, failed: 0 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("records a failed audit row when the reconciliation loop throws", async () => {
    const cronRuns = cronRunsTable();
    const tables = tablesWithCronRuns({
      rental_payments: query({ data: null, error: { message: "connection reset" } }),
    }, cronRuns);
    mocks.createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => tables[table]), rpc: mocks.rpc });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(500);
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch.status).toBe("failed");
    expect(patch.error_message).toContain("connection reset");
  });

  it("creates no audit record for an unauthorized request", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.createRentalWebhookClient).not.toHaveBeenCalled();
  });
});
