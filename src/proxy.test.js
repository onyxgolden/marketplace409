import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import pathToRegexp from "next/dist/compiled/path-to-regexp/index.js";

const { match } = pathToRegexp;

const { createServerClientMock, getUserMock, capturedCookies } = vi.hoisted(
  () => ({
    createServerClientMock: vi.fn(),
    getUserMock: vi.fn(),
    capturedCookies: { current: null },
  }),
);

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { config, proxy } from "./proxy";

const matcherFns = config.matcher.map((pattern) => match(pattern));

function proxyRunsFor(pathname) {
  return matcherFns.some((fn) => fn(pathname) !== false);
}

describe("proxy matcher coverage (S3 fix round: every page route — P671-001)", () => {
  // The matcher no longer scopes to authenticated sections. The
  // shared RootLayout reads SSR session state on every page, and
  // getSession() can refresh an expired session; a refresh in a
  // Server Component cannot persist its rotated cookies. Every
  // page route therefore stays matched so the refresh happens in
  // the proxy, where cookie writes persist (P671-001). Anonymous
  // requests on these routes still perform zero validation via
  // the no-cookie shortcut in the proxy body (see proxy() tests).
  it.each([
    "/",
    "/api/financial/accounts",
    "/api/forge/developer/anything",
    "/forge",
    "/forge/rental",
    "/forge/download/capture/1.2.3/app.zip",
    "/admin/business-claims",
    "/auth",
    "/auth/mfa",
    "/auth/recovery",
    "/investors",
    "/investors/properties",
    "/investors/dscr-loans/admin",
    "/businesses/add",
    "/businesses/edit/abc123",
    "/businesses/abc123/claim",
    "/edit/abc123",
    "/jobs/add",
    "/jobs/edit/abc123",
    "/pets/add",
    "/pets/edit/abc123",
    "/financial-snapshot",
    "/import",
    "/my-listings",
    "/saved-listings",
    "/privacy",
    "/terms",
    "/market",
    "/post",
    "/browse",
    "/community",
    "/listing/abc123",
    "/businesses",
    "/businesses/abc123",
    "/jobs",
    "/pets",
    "/pets/shelters",
    "/rentals/some-slug",
    "/rentals/some-slug/apply",
    "/rentals/screening/some-token",
    "/book/some-slug",
    "/book/some-slug/access/some-token",
    "/definitely-not-a-real-page",
    "/apiary",
    "/forgex",
  ])("runs the proxy for page route %s", (pathname) => {
    expect(proxyRunsFor(pathname)).toBe(true);
  });

  it.each([
    "/favicon.ico",
    "/brand/og-image.jpg",
    "/icon.svg",
    "/photo.png",
    "/anim.gif",
    "/pic.webp",
    "/img.jpeg",
    "/_next/static/chunks/main-app.js",
    "/_next/image",
  ])("does not run the proxy for static asset %s", (pathname) => {
    expect(proxyRunsFor(pathname)).toBe(false);
  });
});

describe("proxy()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCookies.current = null;
    createServerClientMock.mockImplementation((url, key, opts) => {
      capturedCookies.current = opts.cookies;
      return { auth: { getUser: getUserMock } };
    });
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("(b) performs zero Auth-server validation for an anonymous request on a protected route", async () => {
    const request = new NextRequest("https://test/forge/rental");
    const response = await proxy(request);

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("(b) performs zero Auth-server validation for an anonymous request on a public page route", async () => {
    // Public pages are matched again after P671-001 (the shared
    // layout reads session state there), but the no-cookie
    // shortcut keeps anonymous traffic validation-free: the
    // Supabase client is never even constructed.
    const request = new NextRequest("https://test/post");
    const response = await proxy(request);

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("(b) performs zero Auth-server validation for an anonymous request carrying only unrelated cookies", async () => {
    const request = new NextRequest("https://test/", {
      headers: { cookie: "theme=dark; analytics=off" },
    });
    const response = await proxy(request);

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("(a) an unauthenticated request with a stale auth cookie to a protected route gets the same passthrough response (the proxy never gated; pages still do)", async () => {
    const request = new NextRequest("https://test/forge/rental", {
      headers: { cookie: "sb-proj-auth-token=stale-token" },
    });
    const response = await proxy(request);

    expect(createServerClientMock).toHaveBeenCalledTimes(1);
    expect(getUserMock).toHaveBeenCalledTimes(1);
    // Identical outward contract as the anonymous case and as the
    // pre-change proxy: passthrough, no redirect, no cookie writes
    // when the session does not refresh.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("(c) session refresh on a matched route still writes cookies to the request and the response", async () => {
    getUserMock.mockImplementation(async () => {
      // Mimic @supabase/ssr: a refresh during getUser() pushes the
      // rotated session cookie through the provided setAll adapter.
      capturedCookies.current.setAll([
        {
          name: "sb-proj-auth-token",
          value: "refreshed-token",
          options: { path: "/", maxAge: 3600 },
        },
      ]);
      return { data: { user: { id: "user-1" } }, error: null };
    });

    const request = new NextRequest("https://test/forge/rental", {
      headers: { cookie: "sb-proj-auth-token=stale-token" },
    });
    const response = await proxy(request);

    expect(getUserMock).toHaveBeenCalledTimes(1);
    const setCookies = response.headers.getSetCookie();
    expect(
      setCookies.some((cookie) =>
        cookie.startsWith("sb-proj-auth-token=refreshed-token"),
      ),
    ).toBe(true);
    // The request-side cookie jar is updated too, so downstream
    // server code in the same request sees the refreshed session.
    expect(request.cookies.get("sb-proj-auth-token")?.value).toBe(
      "refreshed-token",
    );
  });

  it("takes the full validation path for chunked auth cookies and PKCE verifier cookies", async () => {
    for (const cookie of [
      "sb-proj-auth-token.0=chunk-a",
      "sb-proj-auth-token-code-verifier=verifier",
    ]) {
      vi.clearAllMocks();
      createServerClientMock.mockImplementation((url, key, opts) => {
        capturedCookies.current = opts.cookies;
        return { auth: { getUser: getUserMock } };
      });
      const request = new NextRequest("https://test/forge/rental", {
        headers: { cookie },
      });
      await proxy(request);
      expect(getUserMock).toHaveBeenCalledTimes(1);
    }
  });
});
