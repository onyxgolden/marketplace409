import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedConnectionApplication: vi.fn(),
  getConnectionPlatformSuite: vi.fn(),
  completeFinancialConnectionsSession: vi.fn(),
  mapStripeFinancialConnectionsSessionToConnection: vi.fn(),
  provision: vi.fn(),
  persist: vi.fn(),
  executeImport: vi.fn(),
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
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/stripe/financial-connections/complete", { method: "POST", body: JSON.stringify(body) });
}

function connectionPlatformSuite() {
  return {
    stripeFinancialConnectionsProvider: { completeFinancialConnectionsSession: mocks.completeFinancialConnectionsSession },
    provisioningService: { provision: mocks.provision },
    persistenceService: { persist: mocks.persist },
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

    const completed = { sessionId: "fcsess_1", accounts: [{ accountId: "fca_1", displayName: "Checking", institutionName: "Chase" }] };
    mocks.completeFinancialConnectionsSession.mockResolvedValue(completed);
    const mappedConnection = { connection: { id: "connection_1" }, credentialReference: { id: "credential_1" }, institutionReference: { id: "institution_1" } };
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue(mappedConnection);
    mocks.provision.mockReturnValue({ ...mappedConnection, readyForPersistence: true });
    mocks.persist.mockResolvedValue({ ...mappedConnection, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    mocks.executeImport.mockResolvedValue({ success: true });

    const response = await POST(request({ sessionId: "fcsess_1", ownerId: "attacker-controlled-owner", accountId: "attacker-controlled-account" }));

    expect(response.status).toBe(200);
    expect(mocks.completeFinancialConnectionsSession).toHaveBeenCalledWith({ ownerId: "owner-123", sessionId: "fcsess_1" });
    expect(mocks.mapStripeFinancialConnectionsSessionToConnection).toHaveBeenCalledWith({ userId: "owner-123", sessionId: "fcsess_1", accounts: completed.accounts });
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), { ownerId: "owner-123" });
    expect(mocks.executeImport).toHaveBeenCalledWith({ connectionId: "connection_1", ownerId: "owner-123" });

    const body = (await response.json()) as { initialImport: { attempted: boolean; success: boolean } };
    expect(body.initialImport).toEqual({ attempted: true, success: true });
  });

  it("still returns success when the best-effort initial import fails -- the connection is already correctly persisted", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuite());
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.completeFinancialConnectionsSession.mockResolvedValue({ sessionId: "fcsess_1", accounts: [] });
    mocks.mapStripeFinancialConnectionsSessionToConnection.mockReturnValue({ connection: { id: "connection_1" }, credentialReference: {}, institutionReference: {} });
    mocks.provision.mockReturnValue({ readyForPersistence: true });
    mocks.persist.mockResolvedValue({ connection: { id: "connection_1" }, credentialReference: {}, institutionReference: {}, provisionedAt: "t1", persistedAt: "t2", readyForImport: true });
    mocks.executeImport.mockRejectedValue(new Error("import boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ sessionId: "fcsess_1" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; initialImport: { attempted: boolean; success: boolean } };
    expect(body.success).toBe(true);
    expect(body.initialImport).toEqual({ attempted: true, success: false });
    consoleError.mockRestore();
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
