// POST /api/forge/planner/test-data/purge — owner-only test-client purge.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
vi.mock("@/application/work-management/plannerTestData", () => ({
  loadPlannerTestSamples: vi.fn(),
  previewPlannerTestPurge: vi.fn(),
  purgePlannerTestData: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { purgePlannerTestData } from "@/application/work-management/plannerTestData";
import { POST } from "./route.js";

const AUTH = { supabaseClient: { marker: "db" }, effectiveOwnerId: "owner_1" };

beforeEach(() => {
  vi.clearAllMocks();
  createAuthenticatedForgeApplication.mockResolvedValue(AUTH);
});

function post(body) {
  return new Request("https://test/api/forge/planner/test-data/purge", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/forge/planner/test-data/purge", () => {
  it("purges with the preview digest and the typed client name", async () => {
    const purge = { purged: true, alreadyPurged: false, deletedCounts: { forge_work_packages: 6 } };
    purgePlannerTestData.mockResolvedValue({ ok: true, purge });
    const response = await POST(post({
      clientId: "c1",
      digest: "a".repeat(64),
      requestId: "req-1",
      confirmName: "Fictional Test Client",
    }));
    expect(response.status).toBe(200);
    expect(purgePlannerTestData).toHaveBeenCalledWith(AUTH.supabaseClient, {
      ownerId: "owner_1",
      clientId: "c1",
      digest: "a".repeat(64),
      requestId: "req-1",
      confirmName: "Fictional Test Client",
    });
    expect((await response.json()).purge).toEqual(purge);
  });

  it("maps a digest mismatch to 409", async () => {
    purgePlannerTestData.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "The test data changed since the preview — preview again before deleting.",
    });
    const response = await POST(post({
      clientId: "c1",
      digest: "0".repeat(64),
      requestId: "req-2",
      confirmName: "Fictional Test Client",
    }));
    expect(response.status).toBe(409);
  });

  it("maps a confirm-name mismatch to 409", async () => {
    purgePlannerTestData.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "The typed name does not match the test client name.",
    });
    const response = await POST(post({
      clientId: "c1",
      digest: "a".repeat(64),
      requestId: "req-3",
      confirmName: "Wrong Name",
    }));
    expect(response.status).toBe(409);
  });

  it("maps a blocked purge to 409", async () => {
    purgePlannerTestData.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "This test client cannot be deleted yet — see the preview for what is blocking it.",
    });
    const response = await POST(post({
      clientId: "c1",
      digest: "a".repeat(64),
      requestId: "req-4",
      confirmName: "Fictional Test Client",
    }));
    expect(response.status).toBe(409);
  });

  it("returns the 401 response when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: Response.json({ error: "Authenticated owner id is required." }, { status: 401 }),
    });
    const response = await POST(post({
      clientId: "c1",
      digest: "a".repeat(64),
      requestId: "req-5",
      confirmName: "Fictional Test Client",
    }));
    expect(response.status).toBe(401);
    expect(purgePlannerTestData).not.toHaveBeenCalled();
  });
});
