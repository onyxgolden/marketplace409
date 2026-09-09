import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedConnectionApplication: vi.fn(),
  getConnectionPlatformSuite: vi.fn(),
  createFinancialConnectionsSession: vi.fn(),
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

import { POST } from "./route";

describe("POST /api/stripe/financial-connections/session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the authentication response when no owner is authenticated", async () => {
    const unauthorizedResponse = new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 });
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ response: unauthorizedResponse });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.createFinancialConnectionsSession).not.toHaveBeenCalled();
  });

  it("creates a session for the server-resolved owner id, never a client-supplied one, and returns only sessionId/clientSecret", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue({
      stripeFinancialConnectionsProvider: { createFinancialConnectionsSession: mocks.createFinancialConnectionsSession },
    });
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.createFinancialConnectionsSession.mockResolvedValue({ sessionId: "fcsess_1", clientSecret: "fcsess_1_secret_abc" });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.createFinancialConnectionsSession).toHaveBeenCalledWith({ ownerId: "owner-123" });
    await expect(response.json()).resolves.toEqual({ sessionId: "fcsess_1", clientSecret: "fcsess_1_secret_abc" });
  });

  it("never leaks a raw error (which could carry a client secret) to the response or logs", async () => {
    const currentOwnerId = vi.fn().mockResolvedValue("owner-123");
    mocks.getConnectionPlatformSuite.mockResolvedValue({
      stripeFinancialConnectionsProvider: { createFinancialConnectionsSession: mocks.createFinancialConnectionsSession },
    });
    mocks.createAuthenticatedConnectionApplication.mockResolvedValue({ currentOwnerId, getConnectionPlatformSuite: mocks.getConnectionPlatformSuite });
    mocks.createFinancialConnectionsSession.mockRejectedValue(new Error("secret sk_live_abc123 leaked in this message"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to create a Stripe Financial Connections session." });
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("sk_live");
    consoleError.mockRestore();
  });
});
