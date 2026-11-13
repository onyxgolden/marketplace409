import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
// SaaS Auth PR 1: the Bearer path resolves the effective owner and
// enforces the capture gate through these two helpers.
vi.mock("@/lib/supabase/resolveEffectiveOwnerId", () => ({
  resolveEffectiveOwnerId: vi.fn(),
}));
vi.mock("@/lib/supabase/forgeAppAccess", () => ({
  checkForgeAppAccess: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { checkForgeAppAccess } from "@/lib/supabase/forgeAppAccess";
import { resolveEffectiveOwnerId } from "@/lib/supabase/resolveEffectiveOwnerId";
import { guardCaptureRequest } from "./auth.js";

const VALID_TOKEN = "valid.jwt.token";

function supabaseWith(getUserResult) {
  return { auth: { getUser: vi.fn(async () => getUserResult) } };
}

describe("guardCaptureRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates a Bearer token and returns the token's user", async () => {
    const client = supabaseWith({ data: { user: { id: "user_1" } }, error: null });
    createClient.mockReturnValue(client);
    resolveEffectiveOwnerId.mockResolvedValue("user_1");
    checkForgeAppAccess.mockResolvedValue({ allowed: true, via: "owner" });
    const request = new Request("https://example.test/api/capture/upload", {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    const result = await guardCaptureRequest(request);

    expect(result.response).toBeUndefined();
    expect(result.user.id).toBe("user_1");
    expect(result.effectiveOwnerId).toBe("user_1");
    expect(client.auth.getUser).toHaveBeenCalledWith(VALID_TOKEN);
    expect(createAuthenticatedForgeApplication).not.toHaveBeenCalled();
    expect(checkForgeAppAccess).toHaveBeenCalledWith(client, "user_1", "capture");
    // The user's JWT must ride on every data-plane request so RLS applies.
    const createCall = createClient.mock.calls[0];
    expect(createCall[2]).toEqual({
      global: { headers: { Authorization: `Bearer ${VALID_TOKEN}` } },
    });
  });

  it("denies a Bearer token whose workspace has no capture entitlement", async () => {
    const client = supabaseWith({ data: { user: { id: "user_1" } }, error: null });
    createClient.mockReturnValue(client);
    resolveEffectiveOwnerId.mockResolvedValue("user_1");
    const denied = new Response(JSON.stringify({ error: "This app isn't enabled for your workspace yet." }), { status: 403 });
    checkForgeAppAccess.mockResolvedValue({ allowed: false, response: denied });
    const request = new Request("https://example.test/api/capture/upload", {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    const result = await guardCaptureRequest(request);

    expect(result.response).toBe(denied);
    expect(result.user).toBeUndefined();
  });

  it("fails closed with 503 when owner resolution throws on the Bearer path", async () => {
    const client = supabaseWith({ data: { user: { id: "user_1" } }, error: null });
    createClient.mockReturnValue(client);
    resolveEffectiveOwnerId.mockRejectedValue(new Error("boom"));
    const request = new Request("https://example.test/api/capture/upload", {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    const result = await guardCaptureRequest(request);

    expect(result.response.status).toBe(503);
    expect(checkForgeAppAccess).not.toHaveBeenCalled();
  });

  it("rejects an invalid Bearer token with 401 without touching cookies", async () => {
    const client = supabaseWith({ data: { user: null }, error: new Error("bad jwt") });
    createClient.mockReturnValue(client);
    const request = new Request("https://example.test/api/capture/upload", {
      headers: { authorization: "Bearer bogus" },
    });

    const result = await guardCaptureRequest(request);

    expect(result.response.status).toBe(401);
    const body = await result.response.json();
    expect(body.error).toMatch(/session/i);
    expect(createAuthenticatedForgeApplication).not.toHaveBeenCalled();
  });

  it("falls back to the cookie helper when no Bearer header is present", async () => {
    const authenticated = { user: { id: "cookie_user" }, supabaseClient: { tag: "cookie-client" } };
    createAuthenticatedForgeApplication.mockResolvedValue(authenticated);
    const request = new Request("https://example.test/api/capture/library");

    const result = await guardCaptureRequest(request);

    expect(result.user.id).toBe("cookie_user");
    expect(result.supabaseClient).toBe(authenticated.supabaseClient);
    expect(createAuthenticatedForgeApplication).toHaveBeenCalledWith({ appKey: "capture" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("propagates the cookie helper's 401 response", async () => {
    const response = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    createAuthenticatedForgeApplication.mockResolvedValue({ response });
    const request = new Request("https://example.test/api/capture/library");

    const result = await guardCaptureRequest(request);

    expect(result.response).toBe(response);
  });
});
