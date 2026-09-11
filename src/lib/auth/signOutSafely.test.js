/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_CACHE_TTL_MS, readDashboardCache, writeDashboardCache } from "@/app/forge/financial/dashboardCache.js";
import { signOutSafely } from "./signOutSafely.js";

function fakeSupabase(signOutResult) {
  return { auth: { signOut: vi.fn().mockResolvedValue(signOutResult) } };
}

describe("signOutSafely", () => {
  let originalLocation;

  beforeEach(() => {
    // Seed a real dashboard-cache entry the way the Financial Overview page actually would, so
    // success/failure can be asserted against real read/write behavior, not a mocked stand-in.
    writeDashboardCache({ reports: ["real financial data"] }, { now: () => 1000 });

    originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, href: "" };
  });

  afterEach(() => {
    window.location = originalLocation;
    window.sessionStorage.clear();
  });

  it("on success: clears the dashboard cache and redirects to redirectTo, only after clearing", async () => {
    const supabase = fakeSupabase({ error: null });

    const result = await signOutSafely({ supabase, redirectTo: "/" });

    expect(result).toEqual({ success: true, error: null });
    expect(readDashboardCache({ now: () => 1000 + DASHBOARD_CACHE_TTL_MS - 1 })).toBeNull();
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
    // The cache seeded in beforeEach must still be readable -- a failed sign-out must never wipe a
    // still-legitimately-signed-in user's cached data.
    expect(readDashboardCache({ now: () => 1000 + DASHBOARD_CACHE_TTL_MS - 1 })).toEqual({ reports: ["real financial data"] });
    expect(window.location.href).toBe("");
  });

  it("calls the provided supabase client's own auth.signOut(), not a global/default one", async () => {
    const supabase = fakeSupabase({ error: null });
    await signOutSafely({ supabase, redirectTo: "/" });
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
  });
});
