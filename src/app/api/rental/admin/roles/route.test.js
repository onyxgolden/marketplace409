// Rental Manager admin roles — slice 1: API route tests for
// /api/rental/admin/roles (GET list, POST create, PATCH update).
//
// Conventions follow src/app/api/rental/team/route.test.js: mock only the
// auth helper; the real adminRoleAuthorization gates run against a
// dispatching rpc mock, so the key checks are exercised for real.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET, PATCH, POST } from "./route.js";

const OWNER_ID = "owner_1";
const ROLE_ROW = {
  id: "role_manager",
  name: "manager",
  display_name: "Manager",
  is_starter: true,
  is_retired: false,
  version: 2,
  capabilities: ["rental.tenants.read", "rental.tenants.create"],
  active_assignee_count: 3,
};

function authed({ keys = ["rental.roles.read", "rental.roles.manage"], rpcImpl } = {}) {
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

function unauthed() {
  const response = new Response(JSON.stringify({ error: "Sign in required." }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    response,
    user: null,
    effectiveOwnerId: null,
    supabaseClient: null,
  });
}

const jsonRequest = (method, body) =>
  new Request("https://example.test/api/rental/admin/roles", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/admin/roles", () => {
  it("lists roles with the catalog and the caller's effective keys", async () => {
    const { rpc } = authed({
      rpcImpl: async (name) => (name === "rental_list_roles" ? { data: [ROLE_ROW], error: null } : { data: null, error: null }),
    });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.roles).toEqual([ROLE_ROW]);
    expect(Array.isArray(body.catalog)).toBe(true);
    expect(body.catalog.length).toBe(51);
    expect(body.myEffectiveKeys).toEqual(["rental.roles.read", "rental.roles.manage"]);
    expect(rpc).toHaveBeenCalledWith("rental_list_roles", { p_owner_id: OWNER_ID });
  });

  it("returns 401 when the caller is not signed in", async () => {
    unauthed();
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns 403 when the caller lacks rental.roles.read", async () => {
    authed({ keys: ["rental.tenants.read"] });
    const response = await GET();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/Missing permission/);
  });

  it("returns 500 when the list RPC fails", async () => {
    authed({ rpcImpl: async () => ({ data: null, error: { message: "db down" } }) });
    const response = await GET();
    expect(response.status).toBe(500);
  });
});

describe("POST /api/rental/admin/roles", () => {
  it("creates a role and confirms in plain words naming the role", async () => {
    authed({
      rpcImpl: async (name) => (name === "rental_create_role" ? { data: { role: { ...ROLE_ROW, name: "scheduler", display_name: "Scheduler" } }, error: null } : { data: null, error: null }),
    });
    const response = await POST(jsonRequest("POST", { name: "scheduler", displayName: "Scheduler", keys: ["rental.tenants.read"], requestId: "req-1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/Created the Scheduler role/);
  });

  it("returns 400 for a missing name or an unknown key", async () => {
    authed();
    const noName = await POST(jsonRequest("POST", { displayName: "X", keys: [] }));
    expect(noName.status).toBe(400);
    const badKey = await POST(jsonRequest("POST", { name: "x", displayName: "X", keys: ["rental.nope"] }));
    expect(badKey.status).toBe(400);
    expect((await badKey.json()).error).toMatch(/Unknown permission/);
  });

  it("returns 403 when the caller lacks rental.roles.manage", async () => {
    authed({ keys: ["rental.roles.read"] });
    const response = await POST(jsonRequest("POST", { name: "x", displayName: "X", keys: [] }));
    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/rental/admin/roles", () => {
  it("saves an edit and confirms added/removed permissions with the affected count", async () => {
    authed({
      rpcImpl: async (name) =>
        name === "rental_update_role"
          ? { data: { role: { ...ROLE_ROW, version: 3 }, added: ["rental.reports.read"], removed: ["rental.tenants.create"], affected_user_count: 3, version: 3 }, error: null }
          : { data: null, error: null },
    });
    const response = await PATCH(
      jsonRequest("PATCH", { roleId: "role_manager", addKeys: ["rental.reports.read"], removeKeys: ["rental.tenants.create"], expectedVersion: 2, requestId: "req-2" }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/added View reports/);
    expect(body.message).toMatch(/removed Add tenants/);
    expect(body.message).toMatch(/changes access for 3 staff members/);
    expect(body.version).toBe(3);
  });

  it("returns 409 with the fresh role list on a stale version", async () => {
    const { rpc } = authed({
      rpcImpl: async (name) => {
        if (name === "rental_update_role") return { data: null, error: { code: "P0001", message: "stale version: role was changed by someone else" } };
        if (name === "rental_list_roles") return { data: [{ ...ROLE_ROW, version: 3 }], error: null };
        return { data: null, error: null };
      },
    });
    const response = await PATCH(jsonRequest("PATCH", { roleId: "role_manager", addKeys: [], removeKeys: [], expectedVersion: 2 }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe("stale_version");
    expect(body.roles).toHaveLength(1);
    expect(body.roles[0].version).toBe(3);
    expect(rpc).toHaveBeenCalledWith("rental_list_roles", { p_owner_id: OWNER_ID });
  });

  it("returns 400 for a missing role id, a bad version, or an unknown key", async () => {
    authed();
    expect((await PATCH(jsonRequest("PATCH", { addKeys: [], removeKeys: [], expectedVersion: 2 }))).status).toBe(400);
    expect((await PATCH(jsonRequest("PATCH", { roleId: "r", addKeys: [], removeKeys: [], expectedVersion: 0 }))).status).toBe(400);
    expect((await PATCH(jsonRequest("PATCH", { roleId: "r", addKeys: ["rental.nope"], removeKeys: [], expectedVersion: 2 }))).status).toBe(400);
  });

  it("returns 403 when the caller lacks rental.roles.manage", async () => {
    authed({ keys: ["rental.roles.read"] });
    const response = await PATCH(jsonRequest("PATCH", { roleId: "r", addKeys: [], removeKeys: [], expectedVersion: 1 }));
    expect(response.status).toBe(403);
  });
});
