import { describe, expect, it, vi } from "vitest";
import { createStripeFinancialConnectionsAdapter } from "../stripe-financial-connections.provider";

function fakeStripeClient(overrides = {}) {
  return {
    financialConnections: {
      sessions: { create: vi.fn(), retrieve: vi.fn() },
      accounts: { subscribe: vi.fn(), unsubscribe: vi.fn(), disconnect: vi.fn(), retrieve: vi.fn(), refresh: vi.fn() },
      transactions: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
    },
    customers: { create: vi.fn() },
    ...overrides,
  };
}

function fakeVault(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    retrieveCredential: vi.fn(async (ownerId: string, vaultReference: string) => store.get(`${ownerId}:${vaultReference}`) ?? null),
    storeCredential: vi.fn(async ({ ownerId, vaultReference, secret }: { ownerId: string; vaultReference: string; secret: string }) => {
      store.set(`${ownerId}:${vaultReference}`, secret);
      return { vaultReference, storedAt: new Date().toISOString(), stored: true };
    }),
    _store: store,
  };
}

describe("createFinancialConnectionsSession", () => {
  it("creates a new platform Customer and vaults it the first time an owner connects", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.customers.create.mockResolvedValue({ id: "cus_new_1" });
    stripeClient.financialConnections.sessions.create.mockResolvedValue({ id: "fcsess_1", client_secret: "secret_1" });
    const credentialVaultService = fakeVault();

    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });
    const result = await adapter.createFinancialConnectionsSession({ ownerId: "owner_1" });

    expect(result).toEqual({ sessionId: "fcsess_1", clientSecret: "secret_1" });
    expect(stripeClient.customers.create).toHaveBeenCalledTimes(1);
    expect(credentialVaultService.storeCredential).toHaveBeenCalledWith({
      ownerId: "owner_1", vaultReference: "stripe_financial_connections_customer_id", secret: "cus_new_1",
    });
  });

  it("reuses an already-vaulted platform Customer on a second connection for the same owner, never creating a duplicate", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.financialConnections.sessions.create.mockResolvedValue({ id: "fcsess_2", client_secret: "secret_2" });
    const credentialVaultService = fakeVault({ "owner_1:stripe_financial_connections_customer_id": "cus_existing_1" });

    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });
    await adapter.createFinancialConnectionsSession({ ownerId: "owner_1" });

    expect(stripeClient.customers.create).not.toHaveBeenCalled();
    expect(stripeClient.financialConnections.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ account_holder: { type: "customer", customer: "cus_existing_1" } }),
    );
  });

  it("never creates a second platform customer for two different owners -- each gets their own", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.customers.create.mockResolvedValueOnce({ id: "cus_owner_a" }).mockResolvedValueOnce({ id: "cus_owner_b" });
    stripeClient.financialConnections.sessions.create.mockResolvedValue({ id: "fcsess_x", client_secret: "s" });
    const credentialVaultService = fakeVault();
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });

    await adapter.createFinancialConnectionsSession({ ownerId: "owner_a" });
    await adapter.createFinancialConnectionsSession({ ownerId: "owner_b" });

    expect(stripeClient.customers.create).toHaveBeenCalledTimes(2);
  });
});

describe("completeFinancialConnectionsSession", () => {
  it("returns every field needed to persist a real account durably -- and does NOT subscribe (that is now a separate, later step; see correction report item 5)", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.financialConnections.sessions.retrieve.mockResolvedValue({
      id: "fcsess_1",
      account_holder: { type: "customer", customer: "cus_existing_1" },
      accounts: { data: [{ id: "fca_1", display_name: "Checking", institution_name: "Chase", last4: "1111", category: "cash", subcategory: "checking", status: "active", balance: null }] },
    });
    const credentialVaultService = fakeVault({ "owner_1:stripe_financial_connections_customer_id": "cus_existing_1" });
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });

    const result = await adapter.completeFinancialConnectionsSession({ ownerId: "owner_1", sessionId: "fcsess_1" });

    expect(result.accounts).toEqual([{
      accountId: "fca_1", displayName: "Checking", institutionName: "Chase",
      last4: "1111", category: "cash", subcategory: "checking", status: "active",
    }]);
    expect(stripeClient.financialConnections.accounts.subscribe).not.toHaveBeenCalled();
  });

  it("rejects a session that does not belong to the expected owner's platform Customer -- the core anti-spoofing check", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.financialConnections.sessions.retrieve.mockResolvedValue({
      id: "fcsess_stolen",
      account_holder: { type: "customer", customer: "cus_someone_elses" },
      accounts: { data: [{ id: "fca_stolen", display_name: null, institution_name: null, last4: null, category: "cash", subcategory: null, status: "active", balance: null }] },
    });
    const credentialVaultService = fakeVault({ "owner_1:stripe_financial_connections_customer_id": "cus_existing_1" });
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });

    await expect(adapter.completeFinancialConnectionsSession({ ownerId: "owner_1", sessionId: "fcsess_stolen" }))
      .rejects.toThrow(/does not belong to the expected owner/);
    // Never subscribes an account it hasn't verified ownership of.
    expect(stripeClient.financialConnections.accounts.subscribe).not.toHaveBeenCalled();
  });

  it("never trusts account data the browser could supply -- always retrieves the session server-side by id alone", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.financialConnections.sessions.retrieve.mockResolvedValue({
      id: "fcsess_1", account_holder: { type: "customer", customer: "cus_existing_1" }, accounts: { data: [] },
    });
    const credentialVaultService = fakeVault({ "owner_1:stripe_financial_connections_customer_id": "cus_existing_1" });
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });

    await adapter.completeFinancialConnectionsSession({ ownerId: "owner_1", sessionId: "fcsess_1" });

    // No `expand` param -- Session.accounts is a plain, always-populated field (see client.ts).
    expect(stripeClient.financialConnections.sessions.retrieve).toHaveBeenCalledWith("fcsess_1");
  });
});

describe("subscribeFinancialConnectionsAccounts", () => {
  it("subscribes every given account id to transaction refreshes -- called by the route only after those accounts are durably persisted", async () => {
    const stripeClient = fakeStripeClient();
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService: fakeVault(), stripeClient });

    await adapter.subscribeFinancialConnectionsAccounts({ accountIds: ["fca_1", "fca_2"] });

    expect(stripeClient.financialConnections.accounts.subscribe).toHaveBeenCalledWith("fca_1", { features: ["transactions"] });
    expect(stripeClient.financialConnections.accounts.subscribe).toHaveBeenCalledWith("fca_2", { features: ["transactions"] });
  });
});

describe("importDataPayload -- manual sync path", () => {
  function context(vaultedSecret: string) {
    return {
      ownerId: "owner_1",
      connection: { id: "connection_1", userId: "owner_1", name: "Stripe", type: "bank" as const, status: "connected" as const, provider: "stripe_financial_connections", createdAt: "now", updatedAt: "now" },
      credentialReference: { id: "cred_1", provider: "stripe_financial_connections", externalCredentialId: "fcsess_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state", status: "active" as const, createdAt: "now", updatedAt: "now" },
      institutionReference: { id: "institution_1", connectionId: "connection_1", name: "Chase", type: "bank" as const, provider: "stripe_financial_connections", createdAt: "now", updatedAt: "now" },
    };
  }

  it("skips an inactive account entirely -- never refreshed, never imported", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.financialConnections.accounts.retrieve.mockResolvedValue({
      id: "fca_inactive", status: "inactive", balance: null, balance_refresh: null,
    });
    const vaultedSecret = JSON.stringify({ accountIds: ["fca_inactive"], transactionRefreshCursors: {} });
    const credentialVaultService = fakeVault({ "owner_1:vault://stripe_financial_connections/sessions/fcsess_1/state": vaultedSecret });
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });

    const payload = await adapter.importDataPayload(
      { id: "connection_1", userId: "owner_1", name: "Stripe", type: "bank", status: "connected", provider: "stripe_financial_connections", createdAt: "now", updatedAt: "now" },
      context(vaultedSecret),
    );

    expect(payload.accounts).toHaveLength(0);
    expect(payload.balances).toHaveLength(0);
    expect(payload.transactions).toHaveLength(0);
    expect(stripeClient.financialConnections.transactions.list).not.toHaveBeenCalled();
  });

  it("imports an active account's accounts/balances/transactions", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.financialConnections.accounts.retrieve.mockResolvedValue({
      id: "fca_active", status: "active",
      balance: { as_of: 1768000000, type: "cash", current: { usd: 100000 }, cash: { available: { usd: 100000 } } },
      balance_refresh: { status: "succeeded", next_refresh_available_at: null },
    });
    stripeClient.financialConnections.transactions.list.mockResolvedValue({
      data: [{ id: "fcxtxn_1", account: "fca_active", amount: -500, currency: "usd", description: "Coffee", status: "posted", transacted_at: 1768000000, status_transitions: { posted_at: 1768000000 }, transaction_refresh: "fctxnref_1" }],
      has_more: false,
    });
    const vaultedSecret = JSON.stringify({ accountIds: ["fca_active"], transactionRefreshCursors: {} });
    const credentialVaultService = fakeVault({ "owner_1:vault://stripe_financial_connections/sessions/fcsess_1/state": vaultedSecret });
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });

    const payload = await adapter.importDataPayload(
      { id: "connection_1", userId: "owner_1", name: "Stripe", type: "bank", status: "connected", provider: "stripe_financial_connections", createdAt: "now", updatedAt: "now" },
      context(vaultedSecret),
    );

    expect(payload.accounts).toHaveLength(1);
    expect(payload.balances).toHaveLength(1);
    expect((payload.balances[0] as { currentBalanceCents: number }).currentBalanceCents).toBe(100000);
    expect(payload.transactions).toHaveLength(1);
    expect((payload.transactions[0] as { amountCents: number }).amountCents).toBe(500); // Stripe -500 (debit) -> canonical +500 (outflow)
  });

  it("skips balance import when the refresh has not succeeded, without failing the whole sync", async () => {
    const stripeClient = fakeStripeClient();
    stripeClient.financialConnections.accounts.retrieve.mockResolvedValue({
      id: "fca_active", status: "active", balance: null, balance_refresh: { status: "pending", next_refresh_available_at: null },
    });
    const vaultedSecret = JSON.stringify({ accountIds: ["fca_active"], transactionRefreshCursors: {} });
    const credentialVaultService = fakeVault({ "owner_1:vault://stripe_financial_connections/sessions/fcsess_1/state": vaultedSecret });
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });

    const payload = await adapter.importDataPayload(
      { id: "connection_1", userId: "owner_1", name: "Stripe", type: "bank", status: "connected", provider: "stripe_financial_connections", createdAt: "now", updatedAt: "now" },
      context(vaultedSecret),
    );

    expect(payload.accounts).toHaveLength(1); // account itself still imported
    expect(payload.balances).toHaveLength(0); // but no misleading balance row
  });
});

describe("reportHealth", () => {
  function connection(overrides: Partial<{ status: string; provider: string }> = {}) {
    return {
      id: "connection_1",
      userId: "owner_1",
      name: "Capital One",
      type: "bank" as const,
      status: "connected",
      provider: "stripe_financial_connections",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("reports a connected account as healthy and ready for import", async () => {
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService: fakeVault(), stripeClient: fakeStripeClient() });

    const health = await adapter.reportHealth(connection({ status: "connected" }) as never);

    expect(health).toMatchObject({ state: "healthy", severity: "healthy", allowsImport: true, requiresUserAction: false, issueCount: 0 });
  });

  // The production incident this fixes: a deliberate, user-initiated disconnect (via the
  // /disconnect route, or via correction report item 7's manual local retirement) was
  // indistinguishable from a genuine failure -- every non-"connected" status, including
  // "disconnected", reported as "critical", forcing the whole platform state to "critical" and
  // surfacing a "Repair connection" action for a connection that needed no repair at all.
  it("reports an intentionally disconnected (retired) connection as historical, not needs_attention or critical", async () => {
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService: fakeVault(), stripeClient: fakeStripeClient() });

    const health = await adapter.reportHealth(connection({ status: "disconnected" }) as never);

    expect(health.state).toBe("retired");
    expect(health.severity).toBe("neutral");
    expect(health.allowsImport).toBe(false);
    expect(health.requiresUserAction).toBe(false);
    expect(health.issueCount).toBe(0);
    expect(health.warningCount).toBe(0);
  });

  it("still reports a deactivated (genuinely broken/auth-required) connection as requiring user action", async () => {
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService: fakeVault(), stripeClient: fakeStripeClient() });

    const health = await adapter.reportHealth(connection({ status: "needs_attention" }) as never);

    expect(health.state).toBe("critical");
    expect(health.requiresUserAction).toBe(true);
    expect(health.allowsImport).toBe(false);
    expect(health.issueCount).toBe(1);
  });

  it("still reports a generic error status as requiring user action -- provider failure, unaffected by the retired carve-out", async () => {
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService: fakeVault(), stripeClient: fakeStripeClient() });

    const health = await adapter.reportHealth(connection({ status: "error" }) as never);

    expect(health.state).toBe("critical");
    expect(health.requiresUserAction).toBe(true);
  });

  it("still reports a not_connected (authentication required / never completed) status as requiring user action", async () => {
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService: fakeVault(), stripeClient: fakeStripeClient() });

    const health = await adapter.reportHealth(connection({ status: "not_connected" }) as never);

    expect(health.state).toBe("critical");
    expect(health.requiresUserAction).toBe(true);
  });

  it("reports critical for a mismatched provider, regardless of status", async () => {
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService: fakeVault(), stripeClient: fakeStripeClient() });

    const health = await adapter.reportHealth(connection({ status: "connected", provider: "plaid" }) as never);

    expect(health.state).toBe("critical");
    expect(health.label).toBe("Invalid provider");
  });

  it("mixed active and historical connections resolve independently -- one retired connection never affects another connection's health", async () => {
    const adapter = createStripeFinancialConnectionsAdapter({ credentialVaultService: fakeVault(), stripeClient: fakeStripeClient() });

    const [active, retired] = await Promise.all([
      adapter.reportHealth(connection({ status: "connected" }) as never),
      adapter.reportHealth({ ...connection({ status: "disconnected" }), id: "connection_2" } as never),
    ]);

    expect(active.state).toBe("healthy");
    expect(retired.state).toBe("retired");
    expect(active.connectionId).toBe("connection_1");
    expect(retired.connectionId).toBe("connection_2");
  });
});
