import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedConnectionApplication: vi.fn(),
  getConnectionPlatformSuite: vi.fn(),
  getByIdConnection: vi.fn(),
  getByIdCredentialReference: vi.fn(),
  retrieveCredential: vi.fn(),
  saveConnection: vi.fn(),
  saveExecutionHistory: vi.fn(),
  retrieveFinancialConnectionsAccount: vi.fn(),
  unsubscribeFinancialConnectionsAccount: vi.fn(),
  disconnectFinancialConnectionsAccount: vi.fn(),
  createStripeBillingProvider: vi.fn(),
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
  parseVaultedState: (secret: string) => JSON.parse(secret),
  retrieveFinancialConnectionsAccount: mocks.retrieveFinancialConnectionsAccount,
  unsubscribeFinancialConnectionsAccount: mocks.unsubscribeFinancialConnectionsAccount,
  disconnectFinancialConnectionsAccount: mocks.disconnectFinancialConnectionsAccount,
}));

// Shaped exactly after Stripe's real response for an already-disconnected account (confirmed
// live: both unsubscribe and disconnect return this same body) -- no structured error code, only
// type + message. See the route's own isAlreadyDisconnectedStripeError comment.
function alreadyDisconnectedStripeError() {
  return Object.assign(new Error("This account has been disconnected."), {
    type: "invalid_request_error", param: "account",
  });
}

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: mocks.createStripeBillingProvider,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/stripe/financial-connections/disconnect", { method: "POST", body: JSON.stringify(body) });
}

function suite(overrides: Record<string, unknown> = {}) {
  return {
    connectionRepository: { getById: mocks.getByIdConnection, save: mocks.saveConnection },
    credentialReferenceRepository: { getById: mocks.getByIdCredentialReference },
    credentialVaultService: { retrieveCredential: mocks.retrieveCredential },
    connectionExecutionHistoryRepository: { save: mocks.saveExecutionHistory },
    ...overrides,
  };
}

describe("POST /api/stripe/financial-connections/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createStripeBillingProvider.mockReturnValue({ stripe: {} });
  });

  it("returns 404 for a connection belonging to a different provider (e.g. Plaid), even if it exists and is owned by this workspace", async () => {
    mocks.getConnectionPlatformSuite.mockResolvedValue(suite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({
      currentOwnerId: vi.fn().mockResolvedValue("owner-123"),
      getConnectionPlatformSuite: mocks.getConnectionPlatformSuite,
      user: { id: "user-123" },
    });
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", provider: "plaid", status: "connected" });

    const response = await POST(request({ connectionId: "connection_1" }));

    expect(response.status).toBe(404);
    expect(mocks.unsubscribeFinancialConnectionsAccount).not.toHaveBeenCalled();
  });

  it("first disconnect: retrieves each account's status, unsubscribes and disconnects every account still active, marks the connection disconnected, and records the acting user separately from ownerId", async () => {
    mocks.getConnectionPlatformSuite.mockResolvedValue(suite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({
      currentOwnerId: vi.fn().mockResolvedValue("owner-123"),
      getConnectionPlatformSuite: mocks.getConnectionPlatformSuite,
      user: { id: "co-owner-user-456" },
    });
    mocks.getByIdConnection.mockResolvedValue({
      id: "connection_1", provider: "stripe_financial_connections", status: "connected", credentialReferenceId: "credential_1",
    });
    mocks.getByIdCredentialReference.mockResolvedValue({ id: "credential_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state" });
    mocks.retrieveCredential.mockResolvedValue(JSON.stringify({ accountIds: ["fca_1", "fca_2"], transactionRefreshCursors: {} }));
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue({ status: "active" });

    const response = await POST(request({ connectionId: "connection_1" }));

    expect(response.status).toBe(200);
    expect(mocks.retrieveFinancialConnectionsAccount).toHaveBeenCalledTimes(2);
    expect(mocks.unsubscribeFinancialConnectionsAccount).toHaveBeenCalledTimes(2);
    expect(mocks.disconnectFinancialConnectionsAccount).toHaveBeenCalledTimes(2);
    expect(mocks.unsubscribeFinancialConnectionsAccount).toHaveBeenCalledWith({}, { accountId: "fca_1" });

    expect(mocks.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection_1", status: "disconnected" }),
      { ownerId: "owner-123" },
    );

    // The acting user (a co-owner, distinct from the primary owner's workspace id) is recorded
    // separately -- see 20260908020000_add_connection_execution_history_actor.sql.
    expect(mocks.saveExecutionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "owner-123", actorUserId: "co-owner-user-456", operationType: "disconnect", status: "success" }),
      { ownerId: "owner-123" },
    );
  });

  it("repeated disconnect: every account already disconnected (checked via retrieve) is skipped entirely -- no unsubscribe/disconnect calls at all, yet the connection is still correctly (re)marked disconnected", async () => {
    mocks.getConnectionPlatformSuite.mockResolvedValue(suite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({
      currentOwnerId: vi.fn().mockResolvedValue("owner-123"),
      getConnectionPlatformSuite: mocks.getConnectionPlatformSuite,
      user: { id: "user-123" },
    });
    mocks.getByIdConnection.mockResolvedValue({
      id: "connection_1", provider: "stripe_financial_connections", status: "disconnected", credentialReferenceId: "credential_1",
    });
    mocks.getByIdCredentialReference.mockResolvedValue({ id: "credential_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state" });
    mocks.retrieveCredential.mockResolvedValue(JSON.stringify({ accountIds: ["fca_1", "fca_2"], transactionRefreshCursors: {} }));
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue({ status: "disconnected" });

    const response = await POST(request({ connectionId: "connection_1" }));

    expect(response.status).toBe(200);
    expect(mocks.unsubscribeFinancialConnectionsAccount).not.toHaveBeenCalled();
    expect(mocks.disconnectFinancialConnectionsAccount).not.toHaveBeenCalled();
    expect(mocks.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection_1", status: "disconnected" }),
      { ownerId: "owner-123" },
    );
  });

  it("mixed active/already-disconnected accounts: the active one is unsubscribed/disconnected, the already-disconnected one is skipped, and the connection still converges to disconnected", async () => {
    mocks.getConnectionPlatformSuite.mockResolvedValue(suite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({
      currentOwnerId: vi.fn().mockResolvedValue("owner-123"),
      getConnectionPlatformSuite: mocks.getConnectionPlatformSuite,
      user: { id: "user-123" },
    });
    mocks.getByIdConnection.mockResolvedValue({
      id: "connection_1", provider: "stripe_financial_connections", status: "connected", credentialReferenceId: "credential_1",
    });
    mocks.getByIdCredentialReference.mockResolvedValue({ id: "credential_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state" });
    mocks.retrieveCredential.mockResolvedValue(JSON.stringify({ accountIds: ["fca_active", "fca_already_gone"], transactionRefreshCursors: {} }));
    mocks.retrieveFinancialConnectionsAccount.mockImplementation((_client: unknown, { accountId }: { accountId: string }) =>
      Promise.resolve({ status: accountId === "fca_already_gone" ? "disconnected" : "active" }));

    const response = await POST(request({ connectionId: "connection_1" }));

    expect(response.status).toBe(200);
    expect(mocks.unsubscribeFinancialConnectionsAccount).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribeFinancialConnectionsAccount).toHaveBeenCalledWith({}, { accountId: "fca_active" });
    expect(mocks.disconnectFinancialConnectionsAccount).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectFinancialConnectionsAccount).toHaveBeenCalledWith({}, { accountId: "fca_active" });
    expect(mocks.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ status: "disconnected" }),
      { ownerId: "owner-123" },
    );
  });

  it("retrieve/disconnect race: retrieve reports 'active', but the disconnect call itself then reports already-disconnected (e.g. a concurrent disconnect or a disconnected webhook landed in between) -- treated as successful convergence, not an error", async () => {
    mocks.getConnectionPlatformSuite.mockResolvedValue(suite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({
      currentOwnerId: vi.fn().mockResolvedValue("owner-123"),
      getConnectionPlatformSuite: mocks.getConnectionPlatformSuite,
      user: { id: "user-123" },
    });
    mocks.getByIdConnection.mockResolvedValue({
      id: "connection_1", provider: "stripe_financial_connections", status: "connected", credentialReferenceId: "credential_1",
    });
    mocks.getByIdCredentialReference.mockResolvedValue({ id: "credential_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state" });
    mocks.retrieveCredential.mockResolvedValue(JSON.stringify({ accountIds: ["fca_1"], transactionRefreshCursors: {} }));
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue({ status: "active" }); // stale by the time disconnect actually runs
    mocks.unsubscribeFinancialConnectionsAccount.mockRejectedValue(alreadyDisconnectedStripeError());
    mocks.disconnectFinancialConnectionsAccount.mockRejectedValue(alreadyDisconnectedStripeError());

    const response = await POST(request({ connectionId: "connection_1" }));

    expect(response.status).toBe(200);
    expect(mocks.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ status: "disconnected" }),
      { ownerId: "owner-123" },
    );
  });

  it("does not hide an unrelated Stripe failure -- a genuine error (not the already-disconnected case) still produces an error response and must NOT mark the connection disconnected", async () => {
    mocks.getConnectionPlatformSuite.mockResolvedValue(suite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({
      currentOwnerId: vi.fn().mockResolvedValue("owner-123"),
      getConnectionPlatformSuite: mocks.getConnectionPlatformSuite,
      user: { id: "user-123" },
    });
    mocks.getByIdConnection.mockResolvedValue({
      id: "connection_1", provider: "stripe_financial_connections", status: "connected", credentialReferenceId: "credential_1",
    });
    mocks.getByIdCredentialReference.mockResolvedValue({ id: "credential_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state" });
    mocks.retrieveCredential.mockResolvedValue(JSON.stringify({ accountIds: ["fca_1"], transactionRefreshCursors: {} }));
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue({ status: "active" });
    mocks.unsubscribeFinancialConnectionsAccount.mockRejectedValue(
      Object.assign(new Error("Something else entirely went wrong."), { type: "api_error" }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ connectionId: "connection_1" }));

    expect(response.status).toBe(500);
    expect(mocks.saveConnection).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("local status update failure: if persisting the disconnected connection itself fails, the request still errors and does not report success", async () => {
    mocks.getConnectionPlatformSuite.mockResolvedValue(suite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({
      currentOwnerId: vi.fn().mockResolvedValue("owner-123"),
      getConnectionPlatformSuite: mocks.getConnectionPlatformSuite,
      user: { id: "user-123" },
    });
    mocks.getByIdConnection.mockResolvedValue({
      id: "connection_1", provider: "stripe_financial_connections", status: "connected", credentialReferenceId: "credential_1",
    });
    mocks.getByIdCredentialReference.mockResolvedValue({ id: "credential_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state" });
    mocks.retrieveCredential.mockResolvedValue(JSON.stringify({ accountIds: ["fca_1"], transactionRefreshCursors: {} }));
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue({ status: "disconnected" });
    mocks.saveConnection.mockRejectedValue(new Error("db write failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ connectionId: "connection_1" }));

    expect(response.status).toBe(500);
    expect(mocks.saveExecutionHistory).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("returns 404 rather than throwing when the connection does not exist (or RLS hid it -- e.g. an unrelated user's connectionId)", async () => {
    mocks.getConnectionPlatformSuite.mockResolvedValue(suite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({
      currentOwnerId: vi.fn().mockResolvedValue("owner-123"),
      getConnectionPlatformSuite: mocks.getConnectionPlatformSuite,
      user: { id: "user-123" },
    });
    mocks.getByIdConnection.mockResolvedValue(null);

    const response = await POST(request({ connectionId: "connection_unrelated" }));

    expect(response.status).toBe(404);
  });
});
