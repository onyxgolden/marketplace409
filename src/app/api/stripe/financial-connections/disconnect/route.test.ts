import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedConnectionApplication: vi.fn(),
  getConnectionPlatformSuite: vi.fn(),
  getByIdConnection: vi.fn(),
  getByIdCredentialReference: vi.fn(),
  retrieveCredential: vi.fn(),
  saveConnection: vi.fn(),
  saveExecutionHistory: vi.fn(),
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
  unsubscribeFinancialConnectionsAccount: mocks.unsubscribeFinancialConnectionsAccount,
  disconnectFinancialConnectionsAccount: mocks.disconnectFinancialConnectionsAccount,
}));

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

  it("unsubscribes and disconnects every vaulted account, marks the connection disconnected, and records the acting user separately from ownerId", async () => {
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

    const response = await POST(request({ connectionId: "connection_1" }));

    expect(response.status).toBe(200);
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
