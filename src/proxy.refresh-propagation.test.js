import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import pathToRegexp from "next/dist/compiled/path-to-regexp/index.js";

const { match } = pathToRegexp;

/*
 * Frozen request-level regression for P671-001 (PR #671 fix round).
 *
 * The bug: S3's narrowed proxy matcher excluded public pages, but
 * the shared RootLayout still called createClient().auth.getSession()
 * there. getSession() can refresh an expired session; in a Server
 * Component the SSR adapter's cookie writes are swallowed, so the
 * rotated credentials never reached the browser (repeated refreshes,
 * rotation/reuse races, possible session loss). ChatGPT proved it
 * with an executed probe at the old head (forge-ai-drop
 * results/chatgpt/pr671-reviewer-refresh-{probe,results}-2026-10-23).
 *
 * These tests replay that request pipeline end to end with the REAL
 * @supabase/ssr client and the REAL layout session path
 * (createClient from src/lib/supabase/server.js, the exact call
 * RootLayout makes): proxy/matcher -> ancestor session read ->
 * outgoing response cookies. Only the provider is synthetic (an
 * injected fetch stub — no real keys, accounts or network), and
 * next/headers is modeled with Server Component semantics (cookie
 * writes throw; server.js's adapter records-and-swallows them).
 *
 * Primary public-page case is /post: it is still a dynamic route
 * whose ancestor layout reads session state. /privacy — the other
 * page in the reviewer probe — is deliberately not used: S1
 * (PR #673) made it force-static, so at request time no server
 * session read executes for it at all. /forge/rental is the
 * protected-route positive control, unchanged across base/head.
 */

const harness = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    "synthetic-publishable-key";
  return {
    phase: "proxy",
    calls: [],
    providerMode: "ok",
    layoutJar: [],
    layoutWriteAttempts: [],
    newSession: null,
  };
});

function jwt(exp) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({ sub: "synthetic-user", exp, aud: "authenticated" }),
    ).toString("base64url"),
    "synthetic-signature",
  ].join(".");
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function sessions() {
  const now = nowSeconds();
  const oldSession = {
    access_token: jwt(now - 600),
    refresh_token: "synthetic-old-refresh",
    expires_at: now - 600,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "synthetic-user", aud: "authenticated" },
  };
  const newSession = {
    ...oldSession,
    access_token: jwt(now + 3600),
    refresh_token: "synthetic-new-refresh",
    expires_at: now + 3600,
  };
  const validSession = {
    ...oldSession,
    access_token: jwt(now + 3600),
    refresh_token: "synthetic-valid-refresh",
    expires_at: now + 3600,
  };
  return { oldSession, newSession, validSession };
}

const encodeSessionCookie = (session) =>
  `sb-proj-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

function decodeCookieValue(raw) {
  try {
    const value = raw.startsWith("base64-") ? raw.slice(7) : raw;
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return raw;
  }
}

async function providerFetch(input) {
  const url = String(input);
  const pathname = new URL(url).pathname;
  harness.calls.push({
    phase: harness.phase,
    method: pathname === "/auth/v1/token" ? "POST" : "GET",
    path: pathname,
  });
  if (pathname === "/auth/v1/token") {
    if (harness.providerMode === "denied") {
      return new Response(
        JSON.stringify({
          code: 400,
          error_code: "refresh_token_not_found",
          msg: "Invalid Refresh Token: Refresh Token Not Found",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(harness.newSession), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(harness.newSession.user), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createServerClient: (url, key, options) =>
      actual.createServerClient(url, key, {
        ...options,
        global: { fetch: providerFetch },
      }),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => harness.layoutJar,
    set: (name) => {
      harness.layoutWriteAttempts.push(name);
      throw new Error(
        "Cookies can only be modified in a Server Action or Route Handler",
      );
    },
  }),
}));

import { config, proxy } from "./proxy";
import { createClient } from "./lib/supabase/server";

const matcherFns = config.matcher.map((pattern) => match(pattern));
const proxyRunsFor = (pathname) =>
  matcherFns.some((fn) => fn(pathname) !== false);

const callsInPhase = (phase) =>
  harness.calls.filter((c) => c.phase === phase).map((c) => `${c.method} ${c.path}`);

async function runRequest(pathname, cookieHeader) {
  harness.phase = "proxy";
  const request = new NextRequest(`https://synthetic.test${pathname}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  const response = await proxy(request);

  // Ancestor phase: RootLayout's exact session read, over the cookie
  // jar the proxy forwarded downstream.
  harness.layoutJar = request.cookies.getAll();
  harness.phase = "layout";
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return { request, response, session };
}

function authSetCookies(response) {
  return response.headers
    .getSetCookie()
    .filter((c) => c.startsWith("sb-proj-auth-token="));
}

function decodedAuthSetCookie(response) {
  return authSetCookies(response)
    .map((c) => decodeCookieValue(c.split(";")[0].split("=").slice(1).join("=")))
    .join(" ");
}

beforeEach(() => {
  harness.calls = [];
  harness.providerMode = "ok";
  harness.layoutJar = [];
  harness.layoutWriteAttempts = [];
  harness.newSession = sessions().newSession;
});

describe("P671-001 matcher normalization", () => {
  it("covers the previously excluded public page and the protected control", () => {
    expect(proxyRunsFor("/post")).toBe(true);
    expect(proxyRunsFor("/forge/rental")).toBe(true);
    expect(proxyRunsFor("/favicon.ico")).toBe(false);
  });
});

describe("P671-001 expired-cookie refresh propagation", () => {
  it.each(["/post", "/forge/rental"])(
    "refresh for %s happens in the proxy and the rotated token reaches downstream state and the browser",
    async (pathname) => {
      const { oldSession } = sessions();
      const { request, response, session } = await runRequest(
        pathname,
        encodeSessionCookie(oldSession),
      );

      // The refresh occurred during the proxy phase — it is NOT
      // deferred to (or repeated by) the ancestor layout read.
      expect(callsInPhase("proxy")).toEqual([
        "POST /auth/v1/token",
        "GET /auth/v1/user",
      ]);
      expect(callsInPhase("layout")).toEqual([]);
      expect(harness.layoutWriteAttempts).toEqual([]);

      // Rotated credentials propagate to the browser...
      expect(authSetCookies(response)).toHaveLength(1);
      expect(decodedAuthSetCookie(response)).toContain(
        "synthetic-new-refresh",
      );
      // ...and to downstream server state: the forwarded request
      // jar and the layout's own session read both hold the
      // rotated session, not the stale one.
      const jar = request.cookies
        .getAll()
        .map((c) => decodeCookieValue(c.value))
        .join(" ");
      expect(jar).toContain("synthetic-new-refresh");
      expect(jar).not.toContain("synthetic-old-refresh");
      expect(session?.refresh_token).toBe("synthetic-new-refresh");
      expect(session?.user?.id).toBe("synthetic-user");
    },
  );

  it("propagates a denied refresh on /post as a session-clearing Set-Cookie, with no second refresh attempt in the layout", async () => {
    harness.providerMode = "denied";
    const { oldSession } = sessions();
    const { request, response, session } = await runRequest(
      "/post",
      encodeSessionCookie(oldSession),
    );

    // Exactly one refresh attempt, in the proxy. The layout does
    // not retry it (the forwarded jar no longer holds the dead
    // session), and nothing is silently lost: the denial outcome
    // is written to the response as a cleared auth cookie, so the
    // browser drops the dead credential too.
    expect(callsInPhase("proxy")).toEqual(["POST /auth/v1/token"]);
    expect(callsInPhase("layout")).toEqual([]);
    expect(harness.layoutWriteAttempts).toEqual([]);
    const clearing = authSetCookies(response);
    expect(clearing).toHaveLength(1);
    expect(decodedAuthSetCookie(response)).not.toContain(
      "synthetic-old-refresh",
    );
    expect(
      clearing[0].includes("Max-Age=0") ||
        clearing[0].startsWith("sb-proj-auth-token=;") ||
        clearing[0].startsWith("sb-proj-auth-token=base64-;") ||
        decodedAuthSetCookie(response) === "",
    ).toBe(true);
    const jar = request.cookies
      .getAll()
      .map((c) => decodeCookieValue(c.value))
      .join(" ");
    expect(jar).not.toContain("synthetic-old-refresh");
    expect(session).toBeNull();
  });

  it("keeps the anonymous shortcut on /post: zero provider calls, no cookies written", async () => {
    const { response, session } = await runRequest("/post", null);

    expect(harness.calls).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(harness.layoutWriteAttempts).toEqual([]);
    expect(session).toBeNull();
  });

  it("does not refresh a still-valid session on /post: validation only, no rotation to lose", async () => {
    const { validSession } = sessions();
    const { response, session } = await runRequest(
      "/post",
      encodeSessionCookie(validSession),
    );

    expect(callsInPhase("proxy")).toEqual(["GET /auth/v1/user"]);
    expect(callsInPhase("layout")).toEqual([]);
    expect(authSetCookies(response)).toEqual([]);
    expect(session?.refresh_token).toBe("synthetic-valid-refresh");
  });
});
