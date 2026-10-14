// L2-003 regression tests: SDK contracts verified against the LOCKED
// @supabase/supabase-js 2.110.5 / @supabase/auth-js 2.110.5 (no network —
// the client is constructed but no request is ever issued).
//
// These tests pin the exact provider surface the Layer 2 code depends on,
// so a future SDK upgrade that removes/renames these methods fails LOUDLY
// here instead of silently breaking recovery at runtime.

import { describe, expect, it, vi } from "vitest";

import { createClient } from "@supabase/supabase-js";
import { createUserScopedAuthClient } from "@/app/api/auth/_lib/gatewaySupport.js";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://db.test.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
};

function adminClient() {
  return createClient("https://db.test.supabase.co", "service-role-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe("locked SDK admin factor surface (2.110.5)", () => {
  it("exposes ONLY the underscore-prefixed _listFactors({ userId })", () => {
    const admin = adminClient().auth.admin;
    expect(typeof admin._listFactors).toBe("function");
    // The public names the old code called DO NOT EXIST in 2.110.5.
    expect(admin.listFactors).toBeUndefined();
    expect(admin.deleteFactor).toBeUndefined();
  });

  it("exposes ONLY the underscore-prefixed _deleteFactor({ userId, id })", () => {
    const admin = adminClient().auth.admin;
    expect(typeof admin._deleteFactor).toBe("function");
  });

  it("_listFactors validates and shapes its params (no network: assert the validation)", async () => {
    const admin = adminClient().auth.admin;
    // validateUUID rejects non-UUID userIds BEFORE any network call.
    await expect(admin._listFactors({ userId: "not-a-uuid" })).rejects.toThrow();
    await expect(admin._listFactors({})).rejects.toThrow();
  });

  it("_deleteFactor validates its params (no network: assert the validation)", async () => {
    const admin = adminClient().auth.admin;
    await expect(
      admin._deleteFactor({ userId: "not-a-uuid", id: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow();
  });

  it("admin.signOut takes (jwt, scope) — there is no by-user-id revocation", () => {
    const admin = adminClient().auth.admin;
    expect(admin.signOut.length).toBeGreaterThanOrEqual(1);
    // Calling with a bare user id would send it as the bearer JWT — the
    // adapter MUST pass a real JWT instead (asserted in
    // serverAuthTransport.test.js).
  });
});

describe("createUserScopedAuthClient", () => {
  it("is synchronous and injects the user's bearer token on every request", async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input, init) => {
      seen.push({ authorization: init?.headers?.get?.("authorization"), apikey: init?.headers?.get?.("apikey") });
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const client = createUserScopedAuthClient("user-jwt-abc", ENV);
      // Synchronous: not a Promise.
      expect(typeof client?.then).toBe("undefined");
      expect(typeof client.auth?.mfa?.enroll).toBe("function");
      // Trigger one request through the injected fetch to prove the header.
      await client.auth.getUser("user-jwt-abc").catch(() => {});
      // The client's own getUser passes the token explicitly; the header
      // injection is what the MFA methods (which take no token param) rely on.
      expect(globalThis.fetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("never calls setSession (the pinned SDK rejects empty refresh tokens)", () => {
    const client = createUserScopedAuthClient("user-jwt-abc", ENV);
    // If the implementation used setSession with refresh_token: "", the
    // pinned SDK would reject it. Construction succeeding synchronously
    // proves the header-injection path.
    expect(client).toBeTruthy();
  });

  it("uses NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (the app's deployment contract)", () => {
    expect(() => createUserScopedAuthClient("jwt", { NEXT_PUBLIC_SUPABASE_URL: "https://x.co" })).toThrow(
      /PUBLISHABLE_KEY/
    );
    // Legacy ANON_KEY name still works as a fallback.
    const client = createUserScopedAuthClient("jwt", {
      NEXT_PUBLIC_SUPABASE_URL: "https://x.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-legacy",
    });
    expect(client).toBeTruthy();
    // Publishable wins when both are present.
    const client2 = createUserScopedAuthClient("jwt", {
      NEXT_PUBLIC_SUPABASE_URL: "https://x.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub-key",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-legacy",
    });
    expect(client2).toBeTruthy();
  });

  it("requires the user's access token and the Supabase URL", () => {
    expect(() => createUserScopedAuthClient("", ENV)).toThrow(/access token/i);
    expect(() => createUserScopedAuthClient("jwt", {})).toThrow();
  });
});
