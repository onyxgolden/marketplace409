import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/rental/teamAuthorization", () => ({
  requireTeamManager: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireTeamManager } from "@/lib/rental/teamAuthorization";
import { GET } from "./route.js";

const ENTRY = {
  id: "audit_1",
  action: "member.role_changed",
  actor_user_id: "owner_1",
  target_member_id: "member_1",
  detail: { from: "bookkeeper", to: "manager" },
  created_at: "2026-10-01T07:00:00Z",
};

function authed(rpcImpl = async () => ({ data: [ENTRY], error: null })) {
  const rpc = vi.fn(rpcImpl);
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    response: null,
    user: { id: "owner_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: { rpc },
  });
  return rpc;
}

const request = () => new Request("https://t/api/rental/team/audit");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/team/audit", () => {
  it("403s without team.manage", async () => {
    authed();
    requireTeamManager.mockResolvedValue({
      response: new Response("denied", { status: 403 }),
      authorization: null,
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
  });

  it("returns serialized audit entries for a team manager", async () => {
    const rpc = authed();
    requireTeamManager.mockResolvedValue({ response: null, authorization: { permissions: ["team.manage"] } });
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_team_audit_log", { p_limit: 100 });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      id: "audit_1",
      action: "member.role_changed",
      actorUserId: "owner_1",
      targetMemberId: "member_1",
      detail: { from: "bookkeeper", to: "manager" },
      createdAt: "2026-10-01T07:00:00Z",
    });
  });

  it("500s when the audit RPC fails", async () => {
    authed(async () => ({ data: null, error: { message: "db down" } }));
    requireTeamManager.mockResolvedValue({ response: null, authorization: { permissions: ["team.manage"] } });
    expect((await GET(request())).status).toBe(500);
  });
});
