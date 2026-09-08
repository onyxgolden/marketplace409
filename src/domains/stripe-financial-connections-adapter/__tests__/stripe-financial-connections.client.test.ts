import { describe, expect, it, vi } from "vitest";
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

function fakeClient(overrides = {}) {
  return {
    financialConnections: {
      sessions: { create: vi.fn(), retrieve: vi.fn() },
      accounts: { subscribe: vi.fn(), unsubscribe: vi.fn(), disconnect: vi.fn(), retrieve: vi.fn(), refresh: vi.fn() },
      transactions: { list: vi.fn() },
    },
    customers: { create: vi.fn() },
    ...overrides,
  };
}

describe("createFinancialConnectionsSession", () => {
  it("requests exactly payment_method/balances/transactions, US-only filters, and balances+transactions prefetch -- never ownership", async () => {
    const client = fakeClient();
    client.financialConnections.sessions.create.mockResolvedValue({ id: "fcsess_1", client_secret: "fcsess_1_secret_abc" });

    const result = await createFinancialConnectionsSession(client, { customerId: "cus_owner_1" });

    expect(result).toEqual({ id: "fcsess_1", clientSecret: "fcsess_1_secret_abc" });
    expect(client.financialConnections.sessions.create).toHaveBeenCalledWith({
      account_holder: { type: "customer", customer: "cus_owner_1" },
      permissions: ["payment_method", "balances", "transactions"],
      filters: { countries: ["US"] },
      prefetch: ["balances", "transactions"],
    });
    const [callArgs] = client.financialConnections.sessions.create.mock.calls[0];
    expect(callArgs.permissions).not.toContain("ownership");
  });

  it("throws if Stripe returns no client_secret rather than handing the caller an unusable session", async () => {
    const client = fakeClient();
    client.financialConnections.sessions.create.mockResolvedValue({ id: "fcsess_1", client_secret: null });
    await expect(createFinancialConnectionsSession(client, { customerId: "cus_owner_1" })).rejects.toThrow(/client secret/);
  });
});

describe("retrieveFinancialConnectionsSession", () => {
  it("retrieves server-side and resolves the account_holder customer id from a string reference", async () => {
    const client = fakeClient();
    client.financialConnections.sessions.retrieve.mockResolvedValue({
      id: "fcsess_1",
      account_holder: { type: "customer", customer: "cus_owner_1" },
      accounts: { data: [{ id: "fca_1", display_name: "Checking", institution_name: "Chase", last4: "1234", category: "cash", subcategory: "checking", status: "active", balance: null }] },
    });
    const result = await retrieveFinancialConnectionsSession(client, { sessionId: "fcsess_1" });
    expect(result.accountHolderCustomerId).toBe("cus_owner_1");
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ accountId: "fca_1", displayName: "Checking", category: "cash" });
    expect(client.financialConnections.sessions.retrieve).toHaveBeenCalledWith("fcsess_1", { expand: ["accounts"] });
  });

  it("resolves the account_holder customer id from an expanded Customer object", async () => {
    const client = fakeClient();
    client.financialConnections.sessions.retrieve.mockResolvedValue({
      id: "fcsess_1",
      account_holder: { type: "customer", customer: { id: "cus_owner_1" } },
      accounts: { data: [] },
    });
    const result = await retrieveFinancialConnectionsSession(client, { sessionId: "fcsess_1" });
    expect(result.accountHolderCustomerId).toBe("cus_owner_1");
  });

  it("returns null accountHolderCustomerId when the account_holder is not a customer type", async () => {
    const client = fakeClient();
    client.financialConnections.sessions.retrieve.mockResolvedValue({
      id: "fcsess_1", account_holder: { type: "account", account: "acct_1" }, accounts: { data: [] },
    });
    const result = await retrieveFinancialConnectionsSession(client, { sessionId: "fcsess_1" });
    expect(result.accountHolderCustomerId).toBeNull();
  });
});

describe("subscribe/unsubscribe/disconnect", () => {
  it("subscribes an account to transactions only, not balance", async () => {
    const client = fakeClient();
    await subscribeFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(client.financialConnections.accounts.subscribe).toHaveBeenCalledWith("fca_1", { features: ["transactions"] });
  });

  it("unsubscribes an account from transactions", async () => {
    const client = fakeClient();
    await unsubscribeFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(client.financialConnections.accounts.unsubscribe).toHaveBeenCalledWith("fca_1", { features: ["transactions"] });
  });

  it("disconnects an account entirely", async () => {
    const client = fakeClient();
    await disconnectFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(client.financialConnections.accounts.disconnect).toHaveBeenCalledWith("fca_1");
  });
});

describe("retrieveFinancialConnectionsAccount", () => {
  it("parses a cash (depository) balance from balance.cash.available", async () => {
    const client = fakeClient();
    client.financialConnections.accounts.retrieve.mockResolvedValue({
      id: "fca_1", status: "active",
      balance: { as_of: 1768000000, cash: { available: { usd: 154302 } } },
      balance_refresh: { status: "succeeded", next_refresh_available_at: 1768003600 },
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(result.balance).toMatchObject({ currentCents: 154302, availableCents: 154302, currency: "USD" });
    expect(result.balanceRefreshStatus).toBe("succeeded");
    expect(result.nextBalanceRefreshAvailableAt).toBe(new Date(1768003600 * 1000).toISOString());
  });

  it("parses a credit balance from balance.credit.used, negated (a balance owed, not available)", async () => {
    const client = fakeClient();
    client.financialConnections.accounts.retrieve.mockResolvedValue({
      id: "fca_2", status: "active",
      balance: { as_of: 1768000000, credit: { used: { usd: 50000 } } },
      balance_refresh: { status: "succeeded", next_refresh_available_at: null },
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_2" });
    expect(result.balance).toMatchObject({ currentCents: -50000, availableCents: null, currency: "USD" });
    expect(result.nextBalanceRefreshAvailableAt).toBeNull();
  });

  it("reports a pending/failed refresh status without fabricating a balance", async () => {
    const client = fakeClient();
    client.financialConnections.accounts.retrieve.mockResolvedValue({
      id: "fca_1", status: "active", balance: null, balance_refresh: { status: "pending", next_refresh_available_at: null },
    });
    const result = await retrieveFinancialConnectionsAccount(client, { accountId: "fca_1" });
    expect(result.balance).toBeNull();
    expect(result.balanceRefreshStatus).toBe("pending");
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
    client.financialConnections.transactions.list
      .mockResolvedValueOnce({
        data: [{ id: "fcxtxn_1", amount: -100, currency: "usd", description: "A", status: "posted", transacted_at: 1768000000, status_transitions: { posted_at: 1768000000 } }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: "fcxtxn_2", amount: 200, currency: "usd", description: "B", status: "pending", transacted_at: 1768000100, status_transitions: {} }],
        has_more: false,
      });

    const transactions = await listAllFinancialConnectionsTransactions(client, { accountId: "fca_1" });

    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.transactionId)).toEqual(["fcxtxn_1", "fcxtxn_2"]);
    expect(client.financialConnections.transactions.list).toHaveBeenNthCalledWith(2, {
      account: "fca_1", limit: 100, starting_after: "fcxtxn_1",
    });
  });

  it("passes transacted_at gte through as an optimization filter when a watermark is supplied", async () => {
    const client = fakeClient();
    client.financialConnections.transactions.list.mockResolvedValue({ data: [], has_more: false });
    await listAllFinancialConnectionsTransactions(client, { accountId: "fca_1", transactedAtGte: 1768000000 });
    expect(client.financialConnections.transactions.list).toHaveBeenCalledWith({
      account: "fca_1", limit: 100, transacted_at: { gte: 1768000000 },
    });
  });
});

describe("createStripeCustomerForOwner", () => {
  it("creates a platform-level customer (no stripeAccount param) tagged with the FORGE owner id", async () => {
    const client = fakeClient();
    client.customers.create.mockResolvedValue({ id: "cus_new_1" });
    const result = await createStripeCustomerForOwner(client, { ownerId: "owner_1" });
    expect(result).toEqual({ customerId: "cus_new_1" });
    expect(client.customers.create).toHaveBeenCalledWith({
      metadata: { forge_owner_id: "owner_1", forge_purpose: "financial_connections_account_holder" },
    });
    const [callArgs] = client.customers.create.mock.calls[0];
    expect(callArgs).not.toHaveProperty("stripeAccount");
  });
});
