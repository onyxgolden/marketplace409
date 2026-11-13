// SaaS Auth PR 1 — unit tests for the per-request app-access gate.
import { describe, expect, it, vi } from "vitest";
import { checkForgeAppAccess, appAccessDeniedResponse } from "./forgeAppAccess";

function clientWith(result) {
  return { rpc: vi.fn(async () => result) };
}

describe("checkForgeAppAccess", () => {
  it("passes through an allowed gate result with its via", async () => {
    const client = clientWith({ data: { allowed: true, via: "owner" }, error: null });
    await expect(checkForgeAppAccess(client, "owner-1", "planner")).resolves.toEqual({
      allowed: true,
      via: "owner",
    });
    expect(client.rpc).toHaveBeenCalledWith("forge_check_app_access", {
      p_owner_id: "owner-1",
      p_app_key: "planner",
    });
  });

  it("turns a denial into a plain-words 403", async () => {
    const client = clientWith({
      data: { allowed: false, reason: "ENTITLEMENT_NOT_ACTIVE", via: null },
      error: null,
    });
    const result = await checkForgeAppAccess(client, "owner-1", "planner");
    expect(result.allowed).toBe(false);
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.error).toMatch(/isn't enabled for your workspace/);
    expect(body.error).not.toMatch(/ENTITLEMENT/);
  });

  it("fails closed with 503 when the RPC itself errors (migration not applied yet)", async () => {
    const client = clientWith({ data: null, error: { message: "function does not exist" } });
    const result = await checkForgeAppAccess(client, "owner-1", "planner");
    expect(result.allowed).toBe(false);
    expect(result.response.status).toBe(503);
    const body = await result.response.json();
    expect(body.error).toMatch(/temporarily unavailable/);
  });

  it("denies an unknown app key without calling the RPC", async () => {
    const client = clientWith({ data: { allowed: true }, error: null });
    const result = await checkForgeAppAccess(client, "owner-1", "rental");
    expect(result.allowed).toBe(false);
    expect(result.response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("every denial reason maps to plain words, never a code", async () => {
    for (const reason of [
      "WORKSPACE_NOT_FOUND",
      "WORKSPACE_NOT_ACTIVE",
      "NO_MEMBERSHIP",
      "ENTITLEMENT_NOT_ACTIVE",
      "CAPABILITY_DENIED",
      "AUTH_REQUIRED",
      "UNKNOWN_APP",
      "SOMETHING_ELSE",
    ]) {
      const response = appAccessDeniedResponse(reason);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).not.toContain(reason);
      expect(body.error.length).toBeGreaterThan(0);
    }
  });
});
