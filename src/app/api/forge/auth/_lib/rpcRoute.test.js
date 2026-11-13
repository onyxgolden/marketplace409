// SaaS Auth PR 1 — unit tests for the /api/forge/auth/* route helper.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { forgeAuthRpcRoute, forgeAuthAccessRoute } from "./rpcRoute";

function authenticatedClient(rpcImpl) {
  return {
    supabaseClient: { rpc: vi.fn(rpcImpl) },
    user: { id: "user-1" },
    effectiveOwnerId: "owner-1",
  };
}

function postRequest(body) {
  return new Request("https://example.test/api/forge/auth/memberships/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("forgeAuthRpcRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("propagates the helper's 401 when signed out", async () => {
    const response = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    createAuthenticatedForgeApplication.mockResolvedValue({ response });
    const result = await forgeAuthRpcRoute(postRequest({ request_id: "r1" }), {
      rpc: "forge_workspace_membership_revoke",
      fields: ["owner_id"],
      params: { p_owner_id: "owner_id", p_request_id: "request_id" },
    });
    expect(result).toBe(response);
  });

  it("rejects a missing request_id with 400", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue(authenticatedClient(async () => ({ data: {}, error: null })));
    const result = await forgeAuthRpcRoute(postRequest({ owner_id: "owner-1" }), {
      rpc: "forge_workspace_membership_revoke",
      fields: ["owner_id"],
      params: { p_owner_id: "owner_id", p_request_id: "request_id" },
    });
    expect(result.status).toBe(400);
    expect((await result.json()).error).toMatch(/request_id/);
  });

  it("returns the RPC result on success", async () => {
    const client = authenticatedClient(async () => ({ data: { status: "revoked" }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await forgeAuthRpcRoute(
      postRequest({ request_id: "r1", owner_id: "owner-1", user_id: "u2", reason: "left" }),
      {
        rpc: "forge_workspace_membership_revoke",
        fields: ["owner_id", "user_id", "reason"],
        params: { p_owner_id: "owner_id", p_user_id: "user_id", p_reason: "reason", p_request_id: "request_id" },
      },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, status: "revoked" });
    expect(client.supabaseClient.rpc).toHaveBeenCalledWith("forge_workspace_membership_revoke", {
      p_owner_id: "owner-1",
      p_user_id: "u2",
      p_reason: "left",
      p_request_id: "r1",
    });
  });

  it("maps a FORGE_AUTH_* failure to plain words with the right status", async () => {
    const client = authenticatedClient(async () => ({
      data: null,
      error: { message: "FORGE_AUTH_CEILING_EXCEEDED", code: "42501" },
    }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await forgeAuthRpcRoute(
      postRequest({ request_id: "r1", owner_id: "owner-1", user_id: "u2", role: "co_owner" }),
      {
        rpc: "forge_workspace_membership_role_set",
        fields: ["owner_id", "user_id", "role"],
        params: { p_owner_id: "owner_id", p_user_id: "user_id", p_role: "role", p_request_id: "request_id" },
      },
    );
    expect(result.status).toBe(403);
    const body = await result.json();
    expect(body.error).toMatch(/workspace admin can't grant/);
    expect(body.error).not.toContain("FORGE_AUTH");
  });

  it("never leaks a raw Postgres message for an unknown failure", async () => {
    const client = authenticatedClient(async () => ({
      data: null,
      error: { message: 'relation "secret_table" does not exist', code: "42P01" },
    }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await forgeAuthRpcRoute(postRequest({ request_id: "r1" }), {
      rpc: "forge_provision_workspace",
      fields: [],
      params: { p_request_id: "request_id" },
    });
    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error).toBe("Unable to complete the request.");
  });
});

describe("forgeAuthAccessRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the gate result for the requested app", async () => {
    const client = authenticatedClient(async () => ({
      data: { allowed: true, via: "owner" },
      error: null,
    }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const request = new Request("https://example.test/api/forge/auth/access?app=planner");
    const result = await forgeAuthAccessRoute(request);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, allowed: true, via: "owner" });
    expect(client.supabaseClient.rpc).toHaveBeenCalledWith("forge_check_app_access", {
      p_owner_id: "owner-1",
      p_app_key: "planner",
    });
  });

  it("requires the app parameter", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue(authenticatedClient(async () => ({})));
    const request = new Request("https://example.test/api/forge/auth/access");
    const result = await forgeAuthAccessRoute(request);
    expect(result.status).toBe(400);
  });
});
