/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signOutSafely } from "./signOutSafely.js";

const USER_ID = "user-aaaaaaaa-1111-1111-1111-111111111111";

const { clearDashboardCache } = vi.hoisted(() => ({ clearDashboardCache: vi.fn() }));

// dashboardCache.js's own read/write/clear behavior (TTL, per-user isolation, schema versioning,
// IndexedDB fallback) is verified once, directly, in dashboardCache.test.js -- this file only needs
// to prove signOutSafely calls the real clearDashboardCache export with the right user id, in the
// right order relative to signOut(). jsdom has no real IndexedDB to observe end-to-end through, so
// mocking the export (rather than injecting a fake store signOutSafely has no way to accept anyway)
// is the accurate way to test this boundary.
vi.mock("@/app/forge/financial/dashboardCache.js", () => ({ clearDashboardCache }));

function fakeSupabase(signOutResult, { user = { id: USER_ID } } = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      signOut: vi.fn().mockResolvedValue(signOutResult),
    },
  };
}

describe("signOutSafely", () => {
  let originalLocation;

  beforeEach(() => {
    clearDashboardCache.mockReset().mockResolvedValue(undefined);
    originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, href: "" };
  });

  afterEach(() => {
    window.location = originalLocation;
  });

  it("on success: clears the dashboard cache for the signing-out user's id, then redirects", async () => {
    const supabase = fakeSupabase({ error: null });

    const result = await signOutSafely({ supabase, redirectTo: "/" });

    expect(result).toEqual({ success: true, error: null });
    expect(clearDashboardCache).toHaveBeenCalledWith({ userId: USER_ID });
    expect(window.location.href).toBe("/");
  });

  it("defaults redirectTo to '/' when not specified", async () => {
    const supabase = fakeSupabase({ error: null });
    await signOutSafely({ supabase });
    expect(window.location.href).toBe("/");
  });

  it("respects a custom redirectTo", async () => {
    const supabase = fakeSupabase({ error: null });
    await signOutSafely({ supabase, redirectTo: "/goodbye" });
    expect(window.location.href).toBe("/goodbye");
  });

  it("on failure: does NOT clear the dashboard cache and does NOT redirect", async () => {
    const supabase = fakeSupabase({ error: { message: "network error" } });

    const result = await signOutSafely({ supabase, redirectTo: "/" });

    expect(result).toEqual({ success: false, error: { message: "network error" } });
    // A failed sign-out must never wipe a still-legitimately-signed-in user's cached data.
    expect(clearDashboardCache).not.toHaveBeenCalled();
    expect(window.location.href).toBe("");
  });

  it("calls the provided supabase client's own auth.signOut(), not a global/default one", async () => {
    const supabase = fakeSupabase({ error: null });
    await signOutSafely({ supabase, redirectTo: "/" });
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
  });

  it("reads the current user's id BEFORE calling signOut() -- getUser() would return no one once the session is already gone", async () => {
    const supabase = fakeSupabase({ error: null });
    const callOrder = [];
    supabase.auth.getUser.mockImplementation(async () => { callOrder.push("getUser"); return { data: { user: { id: USER_ID } } }; });
    supabase.auth.signOut.mockImplementation(async () => { callOrder.push("signOut"); return { error: null }; });

    await signOutSafely({ supabase, redirectTo: "/" });

    expect(callOrder).toEqual(["getUser", "signOut"]);
  });

  it("does not throw and simply skips clearing when there is no current user to read (already signed out, corrupted session)", async () => {
    const supabase = fakeSupabase({ error: null }, { user: null });
    const result = await signOutSafely({ supabase, redirectTo: "/" });

    expect(result).toEqual({ success: true, error: null });
    expect(clearDashboardCache).not.toHaveBeenCalled();
    expect(window.location.href).toBe("/");
  });
});
