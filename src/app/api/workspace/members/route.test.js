import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: mocks.authenticate,
}));

import { GET, PATCH, POST } from "./route";

function request(method, body) {
  return new Request("http://localhost/api/workspace/members", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildQuery(rows) {
  const query = { select: () => query, order: () => query, then: (resolve) => resolve({ data: rows, error: null }) };
  return query;
}

const memberRow = {
  id: "workspace_member_1",
  role: "co_owner",
  status: "invited",
  invited_email: "wife@example.com",
  invited_at: "2026-08-29T00:00:00.000Z",
  activated_at: null,
  suspended_at: null,
};

describe("GET /api/workspace/members", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists members visible under RLS for the current caller, mapped to camelCase", async () => {
    const supabaseClient = { from: vi.fn(() => buildQuery([memberRow])) };
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.members).toEqual([{
      id: "workspace_member_1", role: "co_owner", status: "invited",
      invitedEmail: "wife@example.com", invitedAt: "2026-08-29T00:00:00.000Z",
      activatedAt: null, suspendedAt: null,
    }]);
  });

  it("propagates the 401 response from the auth factory unchanged", async () => {
    const unauthorizedResponse = new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 });
    mocks.authenticate.mockResolvedValue({ response: unauthorizedResponse });

    const response = await GET();
    expect(response.status).toBe(401);
  });
});

describe("POST /api/workspace/members (invite)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invites a member by email via invite_workspace_member, defaulting role to co_owner", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: memberRow, error: null });
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });

    const response = await POST(request("POST", { email: "wife@example.com" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("invite_workspace_member", { p_email: "wife@example.com", p_role: "co_owner" });
    const body = await response.json();
    expect(body.member.invitedEmail).toBe("wife@example.com");
  });

  it("rejects an invite with no email before ever calling the RPC", async () => {
    const rpc = vi.fn();
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });

    const response = await POST(request("POST", {}));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own error message (e.g. 'You cannot invite yourself.') rather than a generic one", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "You cannot invite yourself." } });
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });

    const response = await POST(request("POST", { email: "me@example.com" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("You cannot invite yourself.");
  });
});

describe("PATCH /api/workspace/members (suspend/reactivate)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls suspend_workspace_member for action=suspend", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...memberRow, status: "suspended" }, error: null });
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });

    const response = await PATCH(request("PATCH", { memberId: "workspace_member_1", action: "suspend" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("suspend_workspace_member", { p_member_id: "workspace_member_1" });
  });

  it("calls reactivate_workspace_member for action=reactivate", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...memberRow, status: "active" }, error: null });
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });

    const response = await PATCH(request("PATCH", { memberId: "workspace_member_1", action: "reactivate" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("reactivate_workspace_member", { p_member_id: "workspace_member_1" });
  });

  it("rejects an unrecognized action before calling any RPC", async () => {
    const rpc = vi.fn();
    mocks.authenticate.mockResolvedValue({ supabaseClient: { rpc } });

    const response = await PATCH(request("PATCH", { memberId: "workspace_member_1", action: "delete" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
