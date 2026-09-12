import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { GET } from "./route";

describe("GET /api/financial/workspace-identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the authenticated acting user id and the server-resolved canonical workspace (effectiveOwnerId) for a primary owner", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1" });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      userId: "owner-1",
      effectiveOwnerId: "owner-1",
    });
  });

  it("resolves an active co-owner's effectiveOwnerId to the primary owner's id, not the co-owner's own id", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "coowner-1" }, effectiveOwnerId: "owner-1" });

    const response = await GET();
    const body = await response.json();
    expect(body.userId).toBe("coowner-1");
    expect(body.effectiveOwnerId).toBe("owner-1");
  });

  it("returns the authentication response (e.g. 401) when unauthenticated, rather than any workspace identity", async () => {
    mocks.authenticate.mockResolvedValueOnce({ response: new Response("unauthorized", { status: 401 }) });

    const response = await GET();
    expect(response.status).toBe(401);
  });
});
