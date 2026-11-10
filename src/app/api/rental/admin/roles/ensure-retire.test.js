// Rental Manager admin roles — slice 1: API route tests for
// POST /api/rental/admin/roles/ensure and POST /api/rental/admin/roles/retire.
//
// The ensure route gates on requireTeamManager (owner/co-owner only), so
// teamAuthorization is mocked the way src/app/api/rental/team/route.test.js
// mocks it; the retire route uses the real adminRoleAuthorization gates
// against a dispatching rpc mock.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/rental/teamAuthorization", () => ({
  requireTeamManager: vi.fn(),
  buildSecurityContext: vi.fn(async () => null),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireTeamManager } from "@/lib/rental/teamAuthorization";
import { POST as ensurePost } from "./ensure/route.js";
import { POST as retirePost } from "./retire/route.js";

const OWNER_ID = "owner_1";
const MANAGER_KEYS = ["rental.roles.read", "rental.roles.manage"];

function authed({ keys = MANAGER_KEYS, rpcImpl } = {}) {
  const rpc = vi.fn(async (name, params) => {
    if (name === "rental_get_my_effective_permissions") return { data: keys, error: null };
    if (rpcImpl) return rpcImpl(name, params);
    return { data: null, error: null };
  });
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    response: null,
    user: { id: "caller_1" },
    effectiveOwnerId: OWNER_ID,
    supabaseClient: { rpc },
  });
  return { rpc };
}

function allowTeamManager() {
  requireTeamManager.mockResolvedValue({ response: null, authorization: { permissions: ["team.manage"] } });
}

function denyTeamManager() {
  requireTeamManager.mockResolvedValue({
    response: new Response(JSON.stringify({ error: "Only the owner or co-owner can manage the team." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
    authorization: null,
  });
}

const jsonRequest = (path, method, body) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/rental/admin/roles/ensure", () => {
  it("materializes the starter roles and confirms in plain words", async () => {
    authed({
      rpcImpl: async (name) =>
        name === "rental_ensure_starter_roles" ? { data: [{ name: "admin" }, { name: "manager" }, { name: "bookkeeper" }, { name: "read_only" }], error: null } : { data: null, error: null },
    });
    allowTeamManager();
    const response = await ensurePost();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.roles).toHaveLength(4);
    expect(body.message).toMatch(/four starter roles: Rental Admin, Manager, Bookkeeper, and Read-only/);
  });

  it("returns 403 when the caller is not owner/co-owner", async () => {
    authed();
    denyTeamManager();
    const response = await ensurePost();
    expect(response.status).toBe(403);
  });
});

describe("POST /api/rental/admin/roles/retire", () => {
  it("retires a role and reports how many staff members were moved", async () => {
    authed({
      rpcImpl: async (name) =>
        name === "rental_retire_role"
          ? { data: { role: { display_name: "Scheduler" }, reassigned_count: 2 }, error: null }
          : { data: null, error: null },
    });
    const response = await retirePost(jsonRequest("/api/rental/admin/roles/retire", "POST", { roleId: "role_scheduler", reassignRoleId: "role_manager", requestId: "req-3" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.message).toBe("Retired the Scheduler role and moved 2 staff members to another role.");
    expect(body.reassignedCount).toBe(2);
  });

  it("retires a role with no assignees and says so plainly", async () => {
    authed({
      rpcImpl: async (name) =>
        name === "rental_retire_role" ? { data: { role: { display_name: "Scheduler" }, reassigned_count: 0 }, error: null } : { data: null, error: null },
    });
    const response = await retirePost(jsonRequest("/api/rental/admin/roles/retire", "POST", { roleId: "role_scheduler" }));
    expect((await response.json()).message).toBe("Retired the Scheduler role.");
  });

  it("returns 400 for a missing role id and 403 without rental.roles.manage", async () => {
    authed();
    expect((await retirePost(jsonRequest("/api/rental/admin/roles/retire", "POST", {}))).status).toBe(400);
    authed({ keys: ["rental.roles.read"] });
    expect((await retirePost(jsonRequest("/api/rental/admin/roles/retire", "POST", { roleId: "r" }))).status).toBe(403);
  });
});
