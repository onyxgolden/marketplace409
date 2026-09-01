import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: mocks.authenticate,
}));

import { POST } from "./route";

describe("POST /api/workspace/members/accept", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls accept_workspace_invitation with no arguments -- never forwards a client-submitted user id", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: "workspace_member_1", role: "co_owner", status: "active", activated_at: "2026-08-29T00:00:00.000Z" },
      error: null,
    });
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });

    const response = await POST();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("accept_workspace_invitation");
    expect(rpc).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.member).toEqual({ id: "workspace_member_1", role: "co_owner", status: "active", activatedAt: "2026-08-29T00:00:00.000Z" });
  });

  it("surfaces a 400 with the RPC's own error when no pending invitation exists", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "No pending workspace invitation was found for this account." } });
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });

    const response = await POST();
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("No pending workspace invitation was found for this account.");
  });

  it("propagates the 401 response from the auth factory unchanged", async () => {
    const unauthorizedResponse = new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 });
    mocks.authenticate.mockResolvedValue({ response: unauthorizedResponse });

    const response = await POST();
    expect(response.status).toBe(401);
  });
});
