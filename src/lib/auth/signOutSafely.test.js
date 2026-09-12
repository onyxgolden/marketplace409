/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signOutSafely } from "./signOutSafely.js";

const { clearDashboardCache } = vi.hoisted(() => ({ clearDashboardCache: vi.fn() }));

// dashboardCache.js's own read/write/clear behavior (TTL, per-(actingUserId, canonicalWorkspaceId)
// isolation, schema versioning, IndexedDB fallback, whole-store clear) is verified once, directly,
// in dashboardCache.test.js -- this file only needs to prove signOutSafely calls the real
// clearDashboardCache export, in the right order relative to signOut(). jsdom has no real IndexedDB
// to observe end-to-end through, so mocking the export (rather than injecting a fake store
// signOutSafely has no way to accept anyway) is the accurate way to test this boundary.
vi.mock("@/app/forge/financial/dashboardCache.js", () => ({ clearDashboardCache }));

function fakeSupabase(signOutResult) {
  return { auth: { signOut: vi.fn().mockResolvedValue(signOutResult) } };
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

  it("on success: clears the WHOLE dashboard cache (every entry, not one key), then redirects", async () => {
    const supabase = fakeSupabase({ error: null });

    const result = await signOutSafely({ supabase, redirectTo: "/" });

    expect(result).toEqual({ success: true, error: null });
    // No identity argument -- clearDashboardCache() wipes the entire store on its own; see
    // dashboardCache.test.js for proof it actually does.
    expect(clearDashboardCache).toHaveBeenCalledWith();
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

  it("clears the cache only AFTER signOut() actually succeeds, never before", async () => {
    const supabase = fakeSupabase({ error: null });
    const callOrder = [];
    supabase.auth.signOut.mockImplementation(async () => { callOrder.push("signOut"); return { error: null }; });
    clearDashboardCache.mockImplementation(async () => { callOrder.push("clearDashboardCache"); });

    await signOutSafely({ supabase, redirectTo: "/" });

    expect(callOrder).toEqual(["signOut", "clearDashboardCache"]);
  });
});
