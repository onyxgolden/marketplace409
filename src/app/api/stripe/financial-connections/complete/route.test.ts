import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedConnectionApplication: vi.fn(),
  getConnectionPlatformSuite: vi.fn(),
  completeFinancialConnectionsSession: vi.fn(),
  subscribeFinancialConnectionsAccounts: vi.fn(),
  mapStripeFinancialConnectionsSessionToConnection: vi.fn(),
  provision: vi.fn(),
  persist: vi.fn(),
  importCanonicalAccounts: vi.fn(),
  executeImport: vi.fn(),
  accountMapperMapMany: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    },
  },
}));

vi.mock("@/lib/supabase/createAuthenticatedConnectionApplication", () => ({
  createAuthenticatedConnectionApplication: mocks.createAuthenticatedConnectionApplication,
}));

vi.mock("@/domains/stripe-financial-connections-adapter", () => ({
  mapStripeFinancialConnectionsSessionToConnection: mocks.mapStripeFinancialConnectionsSessionToConnection,
  STRIPE_FINANCIAL_CONNECTIONS_PROVIDER: "stripe_financial_connections",
  StripeFinancialConnectionsAccountMapper: function StripeFinancialConnectionsAccountMapper(this: { mapMany: typeof mocks.accountMapperMapMany }) {
    this.mapMany = mocks.accountMapperMapMany;
  },
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/stripe/financial-connections/complete", { method: "POST", body: JSON.stringify(body) });
}

function connectionPlatformSuite() {
  return {
    stripeFinancialConnectionsProvider: {
      completeFinancialConnectionsSession: mocks.completeFinancialConnectionsSession,
      subscribeFinancialConnectionsAccounts: mocks.subscribeFinancialConnectionsAccounts,
    },
    provisioningService: { provision: mocks.provision },
    persistenceService: { persist: mocks.persist },
    financialAccountImportService: { importCanonicalAccounts: mocks.importCanonicalAccounts },
    connectionImportExecutionCoordinator: { executeImport: mocks.executeImport },
  };
}

describe("POST /api/stripe/financial-connections/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the authentication response when no owner is authenticated", async () => {
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) });
    const response = await POST(request({ sessionId: "fcsess_1" }));
    expect(response.status).toBe(401);
    expect(mocks.completeFinancialConnectionsSession).not.toHaveBeenCalled();
  });

  it("rejects a missing sessionId", async () => {
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId: vi.fn().mockResolvedValue("owner-123") });
    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(mocks.completeFinancialConnectionsSession).not.toHaveBeenCalled();
  });

  it("completes for the server-resolved owner, persists, runs a best-effort initial import, and never trusts a client-supplied ownerId/accountId", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });

    const completed = { sessionId: "fcsess_1", accounts: [{ accountId: "fca_1", displayName: "Checking", institutionName: "Chase", last4: "1111", category: "cash", subcategory: "checking", status: "active" }] };
    mocks.completeFinancialConnectionsSession.mockResolvedValue(completed);
    const mappedConnection = { connection: { id: "connection_1" }, credentialReference: { id: "credential_1" }, institutionReference: { id: "institution_1" } };
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue(mappedConnection);
    mocks.provision.mockReturnValue({ ...mappedConnection, readyForPersistence: true });
    mocks.persist.mockResolvedValue({ ...mappedConnection, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    const canonicalAccounts = [{ id: "financial_account_stripe_financial_connections_fca_1", providerAccountId: "fca_1" }];
    mocks.accountMapperMapMany.mockReturnValue(canonicalAccounts);
    mocks.importCanonicalAccounts.mockResolvedValue({ importedFinancialAccountCount: 1 });
    mocks.subscribeFinancialConnectionsAccounts.mockResolvedValue(undefined);
    mocks.executeImport.mockResolvedValue({ success: true });

    const response = await POST(request({ sessionId: "fcsess_1", ownerId: "attacker-controlled-owner", accountId: "attacker-controlled-account" }));

    expect(response.status).toBe(200);
    expect(mocks.completeFinancialConnectionsSession).toHaveBeenCalledWith({ ownerId: "owner-123", sessionId: "fcsess_1" });
    expect(mocks.mapStripeFinancialConnectionsSessionToConnection).toHaveBeenCalledWith({ userId: "owner-123", sessionId: "fcsess_1", accounts: completed.accounts });
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), { ownerId: "owner-123" });

    // The durable account-persistence step must happen BEFORE subscribing (correction report item 5).
    const importOrder = mocks.importCanonicalAccounts.mock.invocationCallOrder[0];
    const subscribeOrder = mocks.subscribeFinancialConnectionsAccounts.mock.invocationCallOrder[0];
    expect(importOrder).toBeLessThan(subscribeOrder);
    expect(mocks.subscribeFinancialConnectionsAccounts).toHaveBeenCalledWith({ accountIds: ["fca_1"] });
    expect(mocks.executeImport).toHaveBeenCalledWith({ connectionId: "connection_1", ownerId: "owner-123" });

    const body = (await response.json()) as { initialImport: { attempted: boolean; success: boolean } };
    expect(body.initialImport).toEqual({ attempted: true, success: true });
  });

  it("still returns success when the best-effort initial import fails -- the connection is already correctly persisted", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.completeFinancialConnectionsSession.mockResolvedValue({ sessionId: "fcsess_1", accounts: [{ accountId: "fca_1", displayName: null, institutionName: null, last4: null, category: "cash", subcategory: "checking", status: "active" }] });
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue({ connection: { id: "connection_1" }, credentialReference: {}, institutionReference: {} });
    mocks.provision.mockReturnValue({ readyForPersistence: true });
    mocks.persist.mockResolvedValue({ connection: { id: "connection_1" }, credentialReference: {}, institutionReference: {}, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    mocks.accountMapperMapMany.mockReturnValue([{ id: "financial_account_1", providerAccountId: "fca_1" }]);
    mocks.importCanonicalAccounts.mockResolvedValue({ importedFinancialAccountCount: 1 });
    mocks.subscribeFinancialConnectionsAccounts.mockResolvedValue(undefined);
    mocks.executeImport.mockRejectedValue(new Error("import boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ sessionId: "fcsess_1" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; initialImport: { attempted: boolean; success: boolean } };
    expect(body.success).toBe(true);
    expect(body.initialImport).toEqual({ attempted: true, success: false });
    consoleError.mockRestore();
  });

  it("never subscribes an account, and fails the whole completion, if the durable account-persistence step itself fails -- the exact ordering correction report item 5 requires", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.completeFinancialConnectionsSession.mockResolvedValue({ sessionId: "fcsess_1", accounts: [{ accountId: "fca_1", displayName: null, institutionName: null, last4: null, category: "cash", subcategory: "checking", status: "active" }] });
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue({ connection: { id: "connection_1" }, credentialReference: {}, institutionReference: {} });
    mocks.provision.mockReturnValue({ readyForPersistence: true });
    mocks.persist.mockResolvedValue({ connection: { id: "connection_1" }, credentialReference: {}, institutionReference: {}, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    mocks.accountMapperMapMany.mockReturnValue([{ id: "financial_account_1", providerAccountId: "fca_1" }]);
    mocks.importCanonicalAccounts.mockRejectedValue(new Error("db write failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ sessionId: "fcsess_1" }));

    expect(response.status).toBe(500);
    expect(mocks.subscribeFinancialConnectionsAccounts).not.toHaveBeenCalled();
    expect(mocks.executeImport).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  // Real fixture shape, captured from a live Stripe test-mode "Test (Non-OAuth)" institution
  // session: it returns 10 named scenario accounts, of which exactly 2 ("Failure" and "Account
  // closes after linking") are inactive by design. Confirmed live that subscribing all 10
  // unconditionally makes Stripe reject the inactive ones ("Data cannot be refreshed on inactive
  // accounts."), which previously failed the ENTIRE completion via Promise.all -- even though the
  // other 8 accounts, and all 10 accounts' durable financial_accounts rows, were already fine.
  const TEST_NON_OAUTH_ACCOUNTS = [
    { accountId: "fca_test_failure", displayName: "Failure", institutionName: "Test Institution", last4: "0000", category: "cash", subcategory: "checking", status: "inactive" },
    { accountId: "fca_test_closes_after_linking", displayName: "Account closes after linking", institutionName: "Test Institution", last4: "0001", category: "cash", subcategory: "checking", status: "inactive" },
    { accountId: "fca_test_success", displayName: "Success", institutionName: "Test Institution", last4: "0002", category: "cash", subcategory: "checking", status: "active" },
    { accountId: "fca_test_very_high_balance", displayName: "Very High Balance", institutionName: "Test Institution", last4: "0003", category: "cash", subcategory: "checking", status: "active" },
    { accountId: "fca_test_insufficient_funds", displayName: "Insufficient Funds", institutionName: "Test Institution", last4: "0004", category: "cash", subcategory: "checking", status: "active" },
    { accountId: "fca_test_success_later_disputed", displayName: "Success (Later Disputed)", institutionName: "Test Institution", last4: "0005", category: "cash", subcategory: "checking", status: "active" },
    { accountId: "fca_test_payment_processes_indefinitely", displayName: "Payment Processes Indefinitely", institutionName: "Test Institution", last4: "0006", category: "cash", subcategory: "checking", status: "active" },
    { accountId: "fca_test_high_balance", displayName: "High Balance", institutionName: "Test Institution", last4: "0007", category: "cash", subcategory: "checking", status: "active" },
    { accountId: "fca_test_debit_not_authorized", displayName: "Debit Not Authorized", institutionName: "Test Institution", last4: "0008", category: "cash", subcategory: "checking", status: "active" },
    { accountId: "fca_test_weekly_volume_exceeded", displayName: "Weekly Payment Volume Exceeded", institutionName: "Test Institution", last4: "0009", category: "cash", subcategory: "checking", status: "active" },
  ];

  it("subscribes only the 8 active accounts from a real 10-account Test (Non-OAuth) session, never the 2 inactive ones, and still succeeds overall", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.completeFinancialConnectionsSession.mockResolvedValue({ sessionId: "fcsess_10acct", accounts: TEST_NON_OAUTH_ACCOUNTS });
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue({ connection: { id: "connection_10acct" }, credentialReference: { id: "credential_10acct" }, institutionReference: { id: "institution_10acct" } });
    mocks.provision.mockReturnValue({ readyForPersistence: true });
    mocks.persist.mockResolvedValue({ connection: { id: "connection_10acct" }, credentialReference: { id: "credential_10acct" }, institutionReference: { id: "institution_10acct" }, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    // active mirrors the account mapper's real behavior (active: account.status === "active").
    const canonicalAccounts = TEST_NON_OAUTH_ACCOUNTS.map((account) => ({
      id: `financial_account_stripe_financial_connections_${account.accountId}`,
      providerAccountId: account.accountId,
      active: account.status === "active",
    }));
    mocks.accountMapperMapMany.mockReturnValue(canonicalAccounts);
    mocks.importCanonicalAccounts.mockResolvedValue({ importedFinancialAccountCount: 10 });
    mocks.subscribeFinancialConnectionsAccounts.mockResolvedValue(undefined);
    mocks.executeImport.mockResolvedValue({ success: true });

    const response = await POST(request({ sessionId: "fcsess_10acct" }));

    expect(response.status).toBe(200);
    // All 10 accounts (active AND inactive) are durably persisted -- inactive ones are represented
    // as not-active, not omitted and not silently treated as healthy.
    expect(mocks.importCanonicalAccounts).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(canonicalAccounts),
      expect.any(String),
    );
    const persistedInactive = canonicalAccounts.filter((account) => !account.active);
    expect(persistedInactive).toHaveLength(2);
    expect(persistedInactive.map((account) => account.providerAccountId)).toEqual(["fca_test_failure", "fca_test_closes_after_linking"]);

    // Subscribe is called with exactly the 8 active account ids -- never the 2 inactive ones.
    const subscribedIds = mocks.subscribeFinancialConnectionsAccounts.mock.calls[0][0].accountIds as string[];
    expect(subscribedIds).toHaveLength(8);
    expect(subscribedIds).not.toContain("fca_test_failure");
    expect(subscribedIds).not.toContain("fca_test_closes_after_linking");
    expect(subscribedIds).toEqual(
      TEST_NON_OAUTH_ACCOUNTS.filter((account) => account.status === "active").map((account) => account.accountId),
    );

    const body = (await response.json()) as { success: boolean; importedAccountCount: number };
    expect(body.success).toBe(true);
    expect(body.importedAccountCount).toBe(10);
  });

  it("does not fail completion when subscribeFinancialConnectionsAccounts is called with only active ids -- proves the fix actually prevents the Promise.all rejection that previously took down the whole route", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.completeFinancialConnectionsSession.mockResolvedValue({ sessionId: "fcsess_10acct_b", accounts: TEST_NON_OAUTH_ACCOUNTS });
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue({ connection: { id: "connection_10acct_b" }, credentialReference: {}, institutionReference: {} });
    mocks.provision.mockReturnValue({ readyForPersistence: true });
    mocks.persist.mockResolvedValue({ connection: { id: "connection_10acct_b" }, credentialReference: {}, institutionReference: {}, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    mocks.accountMapperMapMany.mockReturnValue(TEST_NON_OAUTH_ACCOUNTS.map((account) => ({ id: `financial_account_${account.accountId}`, providerAccountId: account.accountId })));
    mocks.importCanonicalAccounts.mockResolvedValue({ importedFinancialAccountCount: 10 });
    // Simulates the real adapter: it would reject if asked to subscribe an inactive account.
    // Because route.ts now filters to active-only ids first, this mock is never even given the
    // chance to see an inactive id -- if it were, this assertion below would fail.
    mocks.subscribeFinancialConnectionsAccounts.mockImplementation(async ({ accountIds }: { accountIds: string[] }) => {
      if (accountIds.includes("fca_test_failure") || accountIds.includes("fca_test_closes_after_linking")) {
        throw new Error("Data cannot be refreshed on inactive accounts.");
      }
    });
    mocks.executeImport.mockResolvedValue({ success: true });

    const response = await POST(request({ sessionId: "fcsess_10acct_b" }));

    expect(response.status).toBe(200);
  });

  it("returns a clear non-500 response and persists nothing when the session completes with zero accounts", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.completeFinancialConnectionsSession.mockResolvedValue({ sessionId: "fcsess_empty", accounts: [] });

    const response = await POST(request({ sessionId: "fcsess_empty" }));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { success: boolean; error: string; accountCount: number };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/no account was authorized/i);
    expect(body.accountCount).toBe(0);

    // No partial rows of any kind: nothing after the zero-account check is ever reached.
    expect(mocks.mapStripeFinancialConnectionsSessionToConnection).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.accountMapperMapMany).not.toHaveBeenCalled();
    expect(mocks.importCanonicalAccounts).not.toHaveBeenCalled();
    expect(mocks.subscribeFinancialConnectionsAccounts).not.toHaveBeenCalled();
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it("retrying the same zero-account session again produces the same clear response and still persists nothing", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.completeFinancialConnectionsSession.mockResolvedValue({ sessionId: "fcsess_empty_retry", accounts: [] });

    const first = await POST(request({ sessionId: "fcsess_empty_retry" }));
    const second = await POST(request({ sessionId: "fcsess_empty_retry" }));

    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.completeFinancialConnectionsSession).toHaveBeenCalledTimes(2);
  });

  it("persists and completes normally for exactly one account (the common single-account case)", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    const completed = { sessionId: "fcsess_one", accounts: [{ accountId: "fca_capital_one", displayName: "360 Checking", institutionName: "Capital One", last4: "7553", category: "cash", subcategory: "checking", status: "active" }] };
    mocks.completeFinancialConnectionsSession.mockResolvedValue(completed);
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue({ connection: { id: "connection_one" }, credentialReference: { id: "credential_one" }, institutionReference: { id: "institution_one" } });
    mocks.provision.mockReturnValue({ readyForPersistence: true });
    mocks.persist.mockResolvedValue({ connection: { id: "connection_one" }, credentialReference: { id: "credential_one" }, institutionReference: { id: "institution_one" }, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    mocks.accountMapperMapMany.mockReturnValue([{ id: "financial_account_capital_one", providerAccountId: "fca_capital_one", active: true }]);
    mocks.importCanonicalAccounts.mockResolvedValue({ importedFinancialAccountCount: 1 });
    mocks.subscribeFinancialConnectionsAccounts.mockResolvedValue(undefined);
    mocks.executeImport.mockResolvedValue({ success: true });

    const response = await POST(request({ sessionId: "fcsess_one" }));

    expect(response.status).toBe(200);
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { success: boolean; accountCount: number };
    expect(body.success).toBe(true);
    expect(body.accountCount).toBe(1);
  });

  it("persists and completes normally for multiple accounts, preserving durable-persistence-before-subscribe ordering", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    const completed = {
      sessionId: "fcsess_multi",
      accounts: [
        { accountId: "fca_checking", displayName: "Checking", institutionName: "Chase", last4: "1111", category: "cash", subcategory: "checking", status: "active" },
        { accountId: "fca_savings", displayName: "Savings", institutionName: "Chase", last4: "2222", category: "cash", subcategory: "savings", status: "active" },
      ],
    };
    mocks.completeFinancialConnectionsSession.mockResolvedValue(completed);
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue({ connection: { id: "connection_multi" }, credentialReference: { id: "credential_multi" }, institutionReference: { id: "institution_multi" } });
    mocks.provision.mockReturnValue({ readyForPersistence: true });
    mocks.persist.mockResolvedValue({ connection: { id: "connection_multi" }, credentialReference: { id: "credential_multi" }, institutionReference: { id: "institution_multi" }, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    const canonicalAccounts = [
      { id: "financial_account_checking", providerAccountId: "fca_checking", active: true },
      { id: "financial_account_savings", providerAccountId: "fca_savings", active: true },
    ];
    mocks.accountMapperMapMany.mockReturnValue(canonicalAccounts);
    mocks.importCanonicalAccounts.mockResolvedValue({ importedFinancialAccountCount: 2 });
    mocks.subscribeFinancialConnectionsAccounts.mockResolvedValue(undefined);
    mocks.executeImport.mockResolvedValue({ success: true });

    const response = await POST(request({ sessionId: "fcsess_multi" }));

    expect(response.status).toBe(200);
    const importOrder = mocks.importCanonicalAccounts.mock.invocationCallOrder[0];
    const subscribeOrder = mocks.subscribeFinancialConnectionsAccounts.mock.invocationCallOrder[0];
    expect(importOrder).toBeLessThan(subscribeOrder);
    expect(mocks.subscribeFinancialConnectionsAccounts).toHaveBeenCalledWith({ accountIds: ["fca_checking", "fca_savings"] });
    const body = (await response.json()) as { accountCount: number; importedAccountCount: number };
    expect(body.accountCount).toBe(2);
    expect(body.importedAccountCount).toBe(2);
  });

  it("returns a user-safe error and does not persist anything when the session doesn't belong to the expected owner", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.completeFinancialConnectionsSession.mockRejectedValue(new Error("Stripe Financial Connections session does not belong to the expected owner workspace."));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ sessionId: "fcsess_stolen" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "This connection could not be verified for your account." });
    expect(mocks.persist).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
