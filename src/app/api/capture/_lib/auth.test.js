import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
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
    const request = new Request("https://example.test/api/capture/upload", {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    const result = await guardCaptureRequest(request);

    expect(result.response).toBeUndefined();
    expect(result.user.id).toBe("user_1");
    expect(client.auth.getUser).toHaveBeenCalledWith(VALID_TOKEN);
    expect(createAuthenticatedForgeApplication).not.toHaveBeenCalled();
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
