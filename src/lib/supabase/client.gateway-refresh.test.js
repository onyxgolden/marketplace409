// L2-008(d): the browser refresh wrapper must preserve the gateway's
// refusal status and Retry-After instead of mapping everything to 401.
//
// Two levels:
//  1. Wrapper level (gatewayRefreshFetchForTest): the exact Response the
//     wrapper synthesizes for the SDK — status and Retry-After preserved.
//  2. Real SDK path: the REAL @supabase/supabase-js refreshSession driven
//     through the wrapper — a gateway 429 surfaces to the SDK as a 429
//     (retryable), not a 401 (session dead).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://db.test.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  NEXT_PUBLIC_LAYER2_GATEWAY_REFRESH: "true",
};

let realFetch;
let realEnv;

beforeEach(() => {
  realFetch = globalThis.fetch;
  realEnv = { ...process.env };
  Object.assign(process.env, ENV);
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = realEnv;
  vi.resetModules();
});

function gatewayResponse(status, payload, retryAfter = null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...(retryAfter !== null ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

function stubGateway(gatewayImpl) {
  globalThis.fetch = vi.fn(async (input) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    if (url === "/api/auth/refresh") {
      return gatewayImpl();
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function refreshTokenRequest() {
  return [
    "https://db.test.supabase.co/auth/v1/token?grant_type=refresh_token",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: "rt-synthetic" }),
    },
  ];
}

describe("L2-008(d) wrapper mapping (exact synthesized Response)", () => {
  it("is enabled by NEXT_PUBLIC_LAYER2_GATEWAY_REFRESH=true", async () => {
    const { isGatewayRefreshEnabled } = await import("@/lib/supabase/client.js");
    expect(isGatewayRefreshEnabled()).toBe(true);
  });

  it("preserves a gateway 429 with its Retry-After header", async () => {
    stubGateway(() => gatewayResponse(429, { error: "Too many requests", retryAfterSeconds: 7 }, 7));
    const { gatewayRefreshFetchForTest } = await import("@/lib/supabase/client.js");
    const res = await gatewayRefreshFetchForTest()(...refreshTokenRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
  });

  it("preserves a gateway 503 (retryable) instead of mapping to 401", async () => {
    stubGateway(() => gatewayResponse(503, { error: "Service unavailable" }));
    const { gatewayRefreshFetchForTest } = await import("@/lib/supabase/client.js");
    const res = await gatewayRefreshFetchForTest()(...refreshTokenRequest());
    expect(res.status).toBe(503);
  });

  it("keeps a genuine 401 as 401 (dead credential)", async () => {
    stubGateway(() => gatewayResponse(401, { error: "Session refresh failed. Please sign in again." }));
    const { gatewayRefreshFetchForTest } = await import("@/lib/supabase/client.js");
    const res = await gatewayRefreshFetchForTest()(...refreshTokenRequest());
    expect(res.status).toBe(401);
  });

  it("maps a gateway transport failure to 503 (retryable), never 401", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const { gatewayRefreshFetchForTest } = await import("@/lib/supabase/client.js");
    const res = await gatewayRefreshFetchForTest()(...refreshTokenRequest());
    expect(res.status).toBe(503);
  });

  it("translates a successful gateway refresh into the token shape (rotation sync)", async () => {
    stubGateway(() =>
      gatewayResponse(200, {
        status: "ok",
        session: {
          access_token: "atk-new",
          refresh_token: "rt-new",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "user-1" },
        },
      })
    );
    const { gatewayRefreshFetchForTest } = await import("@/lib/supabase/client.js");
    const res = await gatewayRefreshFetchForTest()(...refreshTokenRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    // Rotation sync: the NEW refresh token is what the SDK persists.
    expect(json.access_token).toBe("atk-new");
    expect(json.refresh_token).toBe("rt-new");
  });

  it("passes non-refresh requests through to the real fetch untouched", async () => {
    const passthrough = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = passthrough;
    const { gatewayRefreshFetchForTest } = await import("@/lib/supabase/client.js");
    await gatewayRefreshFetchForTest()("https://db.test.supabase.co/auth/v1/user", { method: "GET" });
    expect(passthrough).toHaveBeenCalled();
  });
});

describe("L2-008(d) real SDK path (supabase-js refreshSession through the wrapper)", () => {
  it("a gateway 429 surfaces to the SDK as a 429, not a 401", async () => {
    stubGateway(() => gatewayResponse(429, { error: "Too many requests", retryAfterSeconds: 7 }, 7));
    const { gatewayRefreshFetchForTest } = await import("@/lib/supabase/client.js");
    const client = createSupabaseClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: gatewayRefreshFetchForTest() },
    });
    const { error } = await client.auth.refreshSession({ refresh_token: "rt-synthetic" });
    expect(error).not.toBeNull();
    // 429 means "back off and retry", NOT "credential dead". The old code
    // mapped every refusal to 401, making the SDK drop the session.
    expect(error.status).toBe(429);
  });

  it("a gateway 401 surfaces to the SDK as a 401 (the session is really dead)", async () => {
    stubGateway(() => gatewayResponse(401, { error: "Session refresh failed. Please sign in again." }));
    const { gatewayRefreshFetchForTest } = await import("@/lib/supabase/client.js");
    const client = createSupabaseClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: gatewayRefreshFetchForTest() },
    });
    const { error } = await client.auth.refreshSession({ refresh_token: "rt-synthetic" });
    expect(error).not.toBeNull();
    expect(error.status).toBe(401);
  });
});
