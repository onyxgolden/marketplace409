// Direct tests for the real fail() in this _lib (the route tests mock
// the whole _lib/auth module, so they cannot prove the real
// forwarding). The import chain creates a Supabase browser client at
// module load, so the synthetic env values below must be set before
// the imports resolve — same vi.hoisted pattern as
// src/proxy.refresh-propagation.test.js. No network, no real keys.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key";
});

import { fail } from "./auth.js";

describe("fail()", () => {
  it("forwards the not-applied flag on a 503 result (FV-1)", async () => {
    const response = fail({
      ok: false,
      httpStatus: 503,
      error: "Field verification isn't available yet — the database change for this feature hasn't been applied.",
      notApplied: true,
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: "Field verification isn't available yet — the database change for this feature hasn't been applied.",
      notApplied: true,
    });
  });

  it("omits notApplied when the result does not carry it", async () => {
    const response = fail({ ok: false, httpStatus: 400, error: "Bad input." });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Bad input." });
  });

  it("still forwards blockers and affected step ids", async () => {
    const response = fail({
      ok: false,
      httpStatus: 409,
      error: "Blocked.",
      blockers: ["bust-open"],
      affectedStepIds: ["step_1"],
    });
    expect(await response.json()).toEqual({
      error: "Blocked.",
      blockers: ["bust-open"],
      affectedStepIds: ["step_1"],
    });
  });
});
