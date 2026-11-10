// Rental Manager admin roles — slice 1: API route tests for assign, revoke,
// lookup, and audit. Same conventions as roles/route.test.js: mock only the
// auth helper; the real adminRoleAuthorization gates run against a
// dispatching rpc mock.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { POST as assignPost } from "./assign/route.js";
import { POST as revokePost } from "./revoke/route.js";
import { POST as lookupPost } from "./lookup/route.js";
import { GET as auditGet } from "./audit/route.js";

const OWNER_ID = "owner_1";
const MANAGER_KEYS = ["rental.roles.read", "rental.roles.manage", "rental.audit.read"];
const READ_KEYS = ["rental.roles.read"];

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

const jsonRequest = (path, method, body) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/rental/admin/assign", () => {
  it("assigns a role and confirms in plain words naming the role and the person", async () => {
    authed({
      rpcImpl: async (name) =>
        name === "rental_assign_role"
          ? { data: { email: "bookkeeper@example.com", current_role: { display_name: "Bookkeeper" } }, error: null }
          : { data: null, error: null },
    });
    const response = await assignPost(jsonRequest("/api/rental/admin/assign", "POST", { userId: "user_2", roleId: "role_bookkeeper", requestId: "req-1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.message).toBe("Assigned the Bookkeeper role to bookkeeper@example.com.");
  });

  it("returns 400 for a missing user id or role id", async () => {
    authed();
    expect((await assignPost(jsonRequest("/api/rental/admin/assign", "POST", { roleId: "r" }))).status).toBe(400);
    expect((await assignPost(jsonRequest("/api/rental/admin/assign", "POST", { userId: "u" }))).status).toBe(400);
  });

  it("returns 403 when the caller lacks rental.roles.manage", async () => {
    authed({ keys: READ_KEYS });
    const response = await assignPost(jsonRequest("/api/rental/admin/assign", "POST", { userId: "u", roleId: "r" }));
    expect(response.status).toBe(403);
  });

  it("maps an RPC permission error to 403", async () => {
    authed({
      rpcImpl: async () => ({ data: null, error: { code: "42501", message: "only the owner can assign that role" } }),
    });
    const response = await assignPost(jsonRequest("/api/rental/admin/assign", "POST", { userId: "u", roleId: "r" }));
    expect(response.status).toBe(403);
  });
});

describe("POST /api/rental/admin/revoke", () => {
  it("revokes a role and confirms in plain words naming the person", async () => {
    authed({
      rpcImpl: async (name) =>
        name === "rental_revoke_role" ? { data: { email: "bookkeeper@example.com", current_role: null }, error: null } : { data: null, error: null },
    });
    const response = await revokePost(jsonRequest("/api/rental/admin/revoke", "POST", { userId: "user_2", requestId: "req-2" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.message).toMatch(/Removed the role from bookkeeper@example.com/);
    expect(body.message).toMatch(/can no longer use the permissions/);
  });

  it("returns 400 for a missing user id and 403 without rental.roles.manage", async () => {
    authed();
    expect((await revokePost(jsonRequest("/api/rental/admin/revoke", "POST", {}))).status).toBe(400);
    authed({ keys: READ_KEYS });
    expect((await revokePost(jsonRequest("/api/rental/admin/revoke", "POST", { userId: "u" }))).status).toBe(403);
  });
});

describe("POST /api/rental/admin/lookup", () => {
  it("returns the looked-up user with their current role and effective keys", async () => {
    authed({
      rpcImpl: async (name) =>
        name === "rental_lookup_user"
          ? { data: { user_id: "user_2", email: "bookkeeper@example.com", team_role: "bookkeeper", team_status: "active", current_role: { display_name: "Bookkeeper" }, effective_keys: ["rental.tenants.read"] }, error: null }
          : { data: null, error: null },
    });
    const response = await lookupPost(jsonRequest("/api/rental/admin/lookup", "POST", { search: "bookkeeper@example.com" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.user.email).toBe("bookkeeper@example.com");
    expect(body.user.current_role.display_name).toBe("Bookkeeper");
  });

  it("returns 400 for an empty search and 403 without rental.roles.read", async () => {
    authed();
    expect((await lookupPost(jsonRequest("/api/rental/admin/lookup", "POST", { search: "  " }))).status).toBe(400);
    authed({ keys: [] });
    expect((await lookupPost(jsonRequest("/api/rental/admin/lookup", "POST", { search: "x@example.com" }))).status).toBe(403);
  });

  it("maps a not-found RPC error to a plain 400 with no enumeration detail", async () => {
    authed({
      rpcImpl: async () => ({ data: null, error: { code: "22023", message: "No account was found for that exact user ID or verified email." } }),
    });
    const response = await lookupPost(jsonRequest("/api/rental/admin/lookup", "POST", { search: "nobody@example.com" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/No account was found/);
  });
});

describe("GET /api/rental/admin/audit", () => {
  const ENTRIES = [{ id: "a1", action: "assign", detail: { role: "Bookkeeper" } }];

  it("returns audit entries and clamps the limit to 1..500", async () => {
    const { rpc } = authed({
      rpcImpl: async (name) => (name === "rental_get_role_audit" ? { data: ENTRIES, error: null } : { data: null, error: null }),
    });
    const response = await auditGet(new Request("https://example.test/api/rental/admin/audit?limit=999"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.entries).toEqual(ENTRIES);
    expect(rpc).toHaveBeenCalledWith("rental_get_role_audit", { p_owner_id: OWNER_ID, p_limit: 500 });
  });

  it("returns 403 without rental.audit.read", async () => {
    authed({ keys: READ_KEYS });
    const response = await auditGet(new Request("https://example.test/api/rental/admin/audit"));
    expect(response.status).toBe(403);
  });
});
