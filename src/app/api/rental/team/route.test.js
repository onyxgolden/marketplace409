import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/rental/teamAuthorization", () => ({
  requireTeamManager: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireTeamManager } from "@/lib/rental/teamAuthorization";
import { GET, PATCH, POST } from "./route.js";

const TEAM_ROW = {
  id: "member_1",
  member_user_id: "staff_user_1",
  invited_email: "bookkeeper@example.com",
  role: "bookkeeper",
  status: "active",
  invited_at: "2026-09-30T10:00:00Z",
  activated_at: "2026-09-30T10:05:00Z",
  suspended_at: null,
  permission_overrides: { "team.manage": false },
};

function authed({ rpcImpl = async () => ({ data: null, error: null }) } = {}) {
  const rpc = vi.fn(rpcImpl);
  const supabaseClient = { rpc };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    response: null,
    user: { id: "owner_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient,
  });
  return { rpc, supabaseClient };
}

function allowTeamManager() {
  requireTeamManager.mockResolvedValue({ response: null, authorization: { permissions: ["team.manage"] } });
}

function denyTeamManager() {
  requireTeamManager.mockResolvedValue({
    response: new Response(JSON.stringify({ error: "denied" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
    authorization: null,
  });
}

const jsonRequest = (method, body) =>
  new Request("https://t/api/rental/team", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/team", () => {
  it("403s without team.manage", async () => {
    authed();
    denyTeamManager();
    const response = await GET(jsonRequest("GET"));
    expect(response.status).toBe(403);
  });

  it("lists members with role labels, overrides, and effective permissions", async () => {
    const { rpc } = authed({ rpcImpl: async (name) => (name === "get_workspace_team" ? { data: [TEAM_ROW], error: null } : { data: null, error: null }) });
    allowTeamManager();
    const response = await GET(jsonRequest("GET"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_workspace_team");
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({
      id: "member_1",
      memberUserId: "staff_user_1",
      email: "bookkeeper@example.com",
      role: "bookkeeper",
      roleLabel: "Bookkeeper",
      status: "active",
      permissionOverrides: { "team.manage": false },
    });
    expect(body.members[0].effectivePermissions).toContain("payments.record");
    expect(body.members[0].effectivePermissions).not.toContain("team.manage");
    expect(body.permissionCatalog).toHaveLength(12);
    expect(body.viewerId).toBe("owner_1");
  });

  it("500s when the team RPC fails", async () => {
    authed({ rpcImpl: async () => ({ data: null, error: { message: "db down" } }) });
    allowTeamManager();
    const response = await GET(jsonRequest("GET"));
    expect(response.status).toBe(500);
  });
});

describe("POST /api/rental/team (invite)", () => {
  it("403s without team.manage", async () => {
    authed();
    denyTeamManager();
    const response = await POST(jsonRequest("POST", { email: "x@example.com", role: "bookkeeper" }));
    expect(response.status).toBe(403);
  });

  it("requires an email and a role", async () => {
    authed();
    allowTeamManager();
    expect((await POST(jsonRequest("POST", { role: "bookkeeper" }))).status).toBe(400);
    expect((await POST(jsonRequest("POST", { email: "x@example.com" }))).status).toBe(400);
  });

  it("invites through invite_workspace_member and returns the serialized member", async () => {
    const { rpc } = authed({ rpcImpl: async () => ({ data: TEAM_ROW, error: null }) });
    allowTeamManager();
    const response = await POST(jsonRequest("POST", { email: "bookkeeper@example.com", role: "bookkeeper" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("invite_workspace_member", {
      p_email: "bookkeeper@example.com",
      p_role: "bookkeeper",
    });
    expect(body.success).toBe(true);
    expect(body.member).toMatchObject({ id: "member_1", role: "bookkeeper" });
  });

  it("400s when the invite RPC rejects (no email is ever sent by this route)", async () => {
    authed({ rpcImpl: async () => ({ data: null, error: { message: "That user has no FORGE account yet." } }) });
    allowTeamManager();
    const response = await POST(jsonRequest("POST", { email: "ghost@example.com", role: "read_only" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no FORGE account/i);
  });
});

describe("PATCH /api/rental/team (role, overrides, status)", () => {
  it("403s without team.manage", async () => {
    authed();
    denyTeamManager();
    const response = await PATCH(jsonRequest("PATCH", { memberId: "member_1", role: "manager" }));
    expect(response.status).toBe(403);
  });

  it("requires a member id and rejects a blank role", async () => {
    authed();
    allowTeamManager();
    expect((await PATCH(jsonRequest("PATCH", { role: "manager" }))).status).toBe(400);
    expect((await PATCH(jsonRequest("PATCH", { memberId: "member_1", role: "" }))).status).toBe(400);
  });

  it("updates through update_workspace_member (the audited RPC)", async () => {
    const { rpc } = authed({ rpcImpl: async () => ({ data: { ...TEAM_ROW, role: "manager" }, error: null }) });
    allowTeamManager();
    const response = await PATCH(
      jsonRequest("PATCH", {
        memberId: "member_1",
        role: "manager",
        permissionOverrides: { "payments.void_refund": true },
        statusAction: "reactivate",
      })
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_workspace_member", {
      p_member_id: "member_1",
      p_role: "manager",
      p_permission_overrides: { "payments.void_refund": true },
      p_status_action: "reactivate",
    });
    expect(body.member.role).toBe("manager");
  });

  it("surfaces the RPC's guard errors (e.g. a co-owner editing another co-owner) as 400", async () => {
    authed({ rpcImpl: async () => ({ data: null, error: { message: "Co-owners cannot change another co-owner." } }) });
    allowTeamManager();
    const response = await PATCH(jsonRequest("PATCH", { memberId: "member_co", role: "manager" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/co-owner/i);
  });
});
