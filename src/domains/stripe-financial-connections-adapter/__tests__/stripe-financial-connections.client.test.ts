import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  createFinancialConnectionsSession,
  createStripeCustomerForOwner,
  disconnectFinancialConnectionsAccount,
  listAllFinancialConnectionsTransactions,
  refreshFinancialConnectionsAccountBalance,
  retrieveFinancialConnectionsAccount,
  retrieveFinancialConnectionsSession,
  subscribeFinancialConnectionsAccount,
  unsubscribeFinancialConnectionsAccount,
} from "../stripe-financial-connections.client";
import type { StripeFinancialConnectionsClient } from "../stripe-financial-connections.client";

// --- Compile-time contract test (item 1) ---
// This function's only purpose is to type-check. If StripeFinancialConnectionsClient ever drifts
// from what a real installed `Stripe` instance actually provides, this stops compiling -- proving
// the contract without a cast, a mock, or a test runner. Never called.
function _typeContract(real: Stripe): StripeFinancialConnectionsClient {
  return real;
}
void _typeContract;

function fakeClient(overrides = {}) {
  return {
    financialConnections: {
      sessions: { create: vi.fn(), retrieve: vi.fn() },
      accounts: { subscribe: vi.fn(), unsubscribe: vi.fn(), disconnect: vi.fn(), retrieve: vi.fn(), refresh: vi.fn() },
      transactions: { list: vi.fn() },
    },
    customers: { create: vi.fn() },
    ...overrides,
  } as unknown as StripeFinancialConnectionsClient;
}

describe("createFinancialConnectionsSession", () => {
  it("requests exactly payment_method/balances/transactions, US-only filters, and balances+transactions prefetch -- never ownership", async () => {
    const client = fakeClient();
    (client.financialConnections.sessions.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "fcsess_1", client_secret: "fcsess_1_secret_abc" });

    const result = await createFinancialConnectionsSession(client, { customerId: "cus_owner_1" });

    expect(result).toEqual({ id: "fcsess_1", clientSecret: "fcsess_1_secret_abc" });
    expect(client.financialConnections.sessions.create).toHaveBeenCalledWith({
      account_holder: { type: "customer", customer: "cus_owner_1" },
      permissions: ["payment_method", "balances", "transactions"],
      filters: { countries: ["US"] },
      prefetch: ["balances", "transactions"],
    });
    const [callArgs] = (client.financialConnections.sessions.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.permissions).not.toContain("ownership");
  });

  it("throws if Stripe returns no client_secret rather than handing the caller an unusable session", async () => {
    const client = fakeClient();
    (client.financialConnections.sessions.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "fcsess_1", client_secret: null });
    await expect(createFinancialConnectionsSession(client, { customerId: "cus_owner_1" })).rejects.toThrow(/client secret/);
  });
});

// Shaped exactly after Stripe's real Session object (Sessions.d.ts) -- accounts is a plain
// ApiList, never gated behind expand.
function stripeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "fcsess_1",
    object: "financial_connections.session",
    account_holder: { type: "customer", customer: "cus_owner_1" },
    accounts: { object: "list", data: [], has_more: false, url: "/v1/financial_connections/accounts" },
    client_secret: "secret",
    livemode: false,
    permissions: ["balances", "transactions", "payment_method"],
    prefetch: ["balances", "transactions"],
    ...overrides,
  };
}

describe("retrieveFinancialConnectionsSession", () => {
  it("retrieves server-side with no expand param and resolves the account_holder customer id from a string reference", async () => {
    const client = fakeClient();
    (client.financialConnections.sessions.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(stripeSession({
      accounts: { object: "list", data: [{ id: "fca_1", display_name: "Checking", institution_name: "Chase", last4: "1234", category: "cash", subcategory: "checking", status: "active" }], has_more: false, url: "x" },
    }));
    const result = await retrieveFinancialConnectionsSession(client, { sessionId: "fcsess_1" });
    expect(result.accountHolderCustomerId).toBe("cus_owner_1");
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ accountId: "fca_1", displayName: "Checking", category: "cash" });
    expect(client.financialConnections.sessions.retrieve).toHaveBeenCalledWith("fcsess_1");
  });

  it("resolves the account_holder customer id from an expanded Customer object", async () => {
    const client = fakeClient();
    (client.financialConnections.sessions.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(stripeSession({
      account_holder: { type: "customer", customer: { id: "cus_owner_1", object: "customer" } },
    }));
    const result = await retrieveFinancialConnectionsSession(client, { sessionId: "fcsess_1" });
    expect(result.accountHolderCustomerId).toBe("cus_owner_1");
  });

  it("returns null accountHolderCustomerId when the account_holder is not a customer type", async () => {
    const client = fakeClient();
    (client.financialConnections.sessions.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(stripeSession({
      account_holder: { type: "account", account: "acct_1" },
    }));
    const result = await retrieveFinancialConnectionsSession(client, { sessionId: "fcsess_1" });
    expect(result.accountHolderCustomerId).toBeNull();
  });
});

describe("subscribe/unsubscribe/disconnect", () => {
  it("subscribes an account to transactions only, not balance (balance has no subscribe feature)", async () => {
    const client = fakeClient();
    await subscribeFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(client.financialConnections.accounts.subscribe).toHaveBeenCalledWith("fca_1", { features: ["transactions"] });
  });

  it("unsubscribes an account from transactions", async () => {
    const client = fakeClient();
    await unsubscribeFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(client.financialConnections.accounts.unsubscribe).toHaveBeenCalledWith("fca_1", { features: ["transactions"] });
  });

  it("disconnects an account entirely, with no expand/params argument", async () => {
    const client = fakeClient();
    await disconnectFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(client.financialConnections.accounts.disconnect).toHaveBeenCalledWith("fca_1");
  });
});

// Shaped exactly after Stripe's real Account.Balance object (Accounts.d.ts): as_of, type,
// current[currency] always present, cash.available[currency]/credit.used[currency] present per
// balance.type.
describe("retrieveFinancialConnectionsAccount", () => {
  it("reads currentCents from balance.current, not cash.available -- and reads availableCents from cash.available for a cash account", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_1", status: "active",
      balance: { as_of: 1768000000, type: "cash", current: { usd: 154302 }, cash: { available: { usd: 150000 } } },
      balance_refresh: { status: "succeeded", last_attempted_at: 1768000000, next_refresh_available_at: 1768003600 },
      transaction_refresh: null,
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(result.balance).toMatchObject({ currentCents: 154302, availableCents: 150000, currency: "USD", type: "cash" });
    expect(result.balanceRefreshStatus).toBe("succeeded");
    expect(result.nextBalanceRefreshAvailableAt).toBe(new Date(1768003600 * 1000).toISOString());
    expect(client.financialConnections.accounts.retrieve).toHaveBeenCalledWith("fca_1");
  });

  it("reads currentCents from balance.current for a credit account, and does NOT derive it from (or negate) credit.used", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_2", status: "active",
      balance: { as_of: 1768000000, type: "credit", current: { usd: -50000 }, credit: { used: { usd: 50000 } } },
      balance_refresh: { status: "succeeded", last_attempted_at: 1768000000, next_refresh_available_at: null },
      transaction_refresh: null,
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_2" });
    // current is -50000 (money owed BY the holder) -- read directly, not re-derived as -(credit.used).
    expect(result.balance).toMatchObject({ currentCents: -50000, availableCents: null, currency: "USD", type: "credit" });
  });

  it("throws rather than defaulting to 0 when balance.current has no entry for the resolved currency", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_3", status: "active",
      balance: { as_of: 1768000000, type: "cash", current: {}, cash: { available: null } },
      balance_refresh: { status: "succeeded", last_attempted_at: 1768000000, next_refresh_available_at: null },
      transaction_refresh: null,
    });
    await expect(retrieveFinancialConnectionsAccount(client, { accountId: "fca_3" })).rejects.toThrow(/no currency keys/);
  });

  it("throws rather than guessing when balance.current has more than one currency key", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_4", status: "active",
      balance: { as_of: 1768000000, type: "cash", current: { usd: 100, eur: 90 }, cash: { available: { usd: 100 } } },
      balance_refresh: { status: "succeeded", last_attempted_at: 1768000000, next_refresh_available_at: null },
      transaction_refresh: null,
    });
    await expect(retrieveFinancialConnectionsAccount(client, { accountId: "fca_4" })).rejects.toThrow(/multiple currency keys/);
  });

  it("reports a null balance without fabricating one when Stripe has never returned a balance for this account", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_5", status: "active", balance: null,
      balance_refresh: { status: "pending", last_attempted_at: 1768000000, next_refresh_available_at: null },
      transaction_refresh: null,
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_5" });
    expect(result.balance).toBeNull();
    expect(result.balanceRefreshStatus).toBe("pending");
  });

  it("surfaces transaction_refresh id/status for the incremental-sync cursor", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_6", status: "active", balance: null, balance_refresh: null,
      transaction_refresh: { id: "fctxnref_abc", status: "succeeded", last_attempted_at: 1768000000, next_refresh_available_at: null },
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_6" });
    expect(result.transactionRefreshId).toBe("fctxnref_abc");
    expect(result.transactionRefreshStatus).toBe("succeeded");
  });

  // last_attempted_at is Stripe's own authoritative refresh-ordering signal (see the refresh
  // work state machine) -- surfaced verbatim, raw epoch seconds, never converted or rounded.
  it("surfaces balance_refresh and transaction_refresh last_attempted_at verbatim, for the refresh-work state machine's currency check", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_7", status: "active",
      balance: { as_of: 1768000000, type: "cash", current: { usd: 100 }, cash: { available: { usd: 100 } } },
      balance_refresh: { status: "succeeded", last_attempted_at: 1768111111, next_refresh_available_at: null },
      transaction_refresh: { id: "fctxnref_xyz", status: "succeeded", last_attempted_at: 1768222222, next_refresh_available_at: null },
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_7" });
    expect(result.balanceRefreshLastAttemptedAt).toBe(1768111111);
    expect(result.transactionRefreshLastAttemptedAt).toBe(1768222222);
  });

  it("reports null last_attempted_at fields when Stripe has never returned either refresh", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_8", status: "active", balance: null, balance_refresh: null, transaction_refresh: null,
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_8" });
    expect(result.balanceRefreshLastAttemptedAt).toBeNull();
    expect(result.transactionRefreshLastAttemptedAt).toBeNull();
  });

  it("surfaces displayName/institutionName/last4/category/subcategory directly from the Account object -- these are plain always-present fields, not something the caller should fabricate", async () => {
    const client = fakeClient();
    (client.financialConnections.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fca_7", status: "active",
      display_name: "Business Checking", institution_name: "Chase", last4: "4321",
      category: "credit", subcategory: "credit_card",
      balance: null, balance_refresh: null, transaction_refresh: null,
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_7" });
    expect(result).toMatchObject({
      displayName: "Business Checking", institutionName: "Chase", last4: "4321",
      category: "credit", subcategory: "credit_card",
    });
  });
});

describe("refreshFinancialConnectionsAccountBalance", () => {
  it("requests a balance-only refresh", async () => {
    const client = fakeClient();
    await refreshFinancialConnectionsAccountBalance(client, { accountId: "fca_1" });
    expect(client.financialConnections.accounts.refresh).toHaveBeenCalledWith("fca_1", { features: ["balance"] });
  });
});

describe("listAllFinancialConnectionsTransactions", () => {
  it("pages through has_more until exhausted, using the last transaction id as starting_after", async () => {
    const client = fakeClient();
    (client.financialConnections.transactions.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: [{ id: "fcxtxn_1", account: "fca_1", amount: -100, currency: "usd", description: "A", status: "posted", transacted_at: 1768000000, status_transitions: { posted_at: 1768000000, void_at: null }, transaction_refresh: "fctxnref_1" }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: "fcxtxn_2", account: "fca_1", amount: 200, currency: "usd", description: "B", status: "pending", transacted_at: 1768000100, status_transitions: { posted_at: null, void_at: null }, transaction_refresh: "fctxnref_1" }],
        has_more: false,
      });

    const transactions = await listAllFinancialConnectionsTransactions(client, { accountId: "fca_1" });

    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.transactionId)).toEqual(["fcxtxn_1", "fcxtxn_2"]);
    expect(client.financialConnections.transactions.list).toHaveBeenNthCalledWith(2, {
      account: "fca_1", limit: 100, starting_after: "fcxtxn_1",
    });
  });

  it("passes transaction_refresh.after through when a watermark refresh id is supplied -- the Stripe-documented incremental filter", async () => {
    const client = fakeClient();
    (client.financialConnections.transactions.list as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], has_more: false });
    await listAllFinancialConnectionsTransactions(client, { accountId: "fca_1", transactionRefreshAfter: "fctxnref_prev" });
    expect(client.financialConnections.transactions.list).toHaveBeenCalledWith({
      account: "fca_1", limit: 100, transaction_refresh: { after: "fctxnref_prev" },
    });
  });

  it("omits the transaction_refresh filter entirely on a first import with no prior cursor", async () => {
    const client = fakeClient();
    (client.financialConnections.transactions.list as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], has_more: false });
    await listAllFinancialConnectionsTransactions(client, { accountId: "fca_1" });
    expect(client.financialConnections.transactions.list).toHaveBeenCalledWith({ account: "fca_1", limit: 100 });
  });
});

describe("createStripeCustomerForOwner", () => {
  it("creates a platform-level customer (no stripeAccount param) tagged with the FORGE owner id", async () => {
    const client = fakeClient();
    (client.customers.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cus_new_1" });
    const result = await createStripeCustomerForOwner(client, { ownerId: "owner_1" });
    expect(result).toEqual({ customerId: "cus_new_1" });
    expect(client.customers.create).toHaveBeenCalledWith({
      metadata: { forge_owner_id: "owner_1", forge_purpose: "financial_connections_account_holder" },
    });
    const [callArgs] = (client.customers.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).not.toHaveProperty("stripeAccount");
  });
});
