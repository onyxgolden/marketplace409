// POST /api/forge/planner/test-data/preview — purge preflight.

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
import { previewPlannerTestPurge } from "@/application/work-management/plannerTestData";
import { POST } from "./route.js";

const AUTH = { supabaseClient: { marker: "db" }, effectiveOwnerId: "owner_1" };

beforeEach(() => {
  vi.clearAllMocks();
  createAuthenticatedForgeApplication.mockResolvedValue(AUTH);
});

function post(body) {
  return new Request("https://test/api/forge/planner/test-data/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/forge/planner/test-data/preview", () => {
  it("returns the preview counts, blockers, and digest", async () => {
    const preview = {
      clientId: "c1",
      counts: { forge_work_packages: 6, forge_work_steps: 31 },
      blockers: [],
      canPurge: true,
      digest: "a".repeat(64),
    };
    previewPlannerTestPurge.mockResolvedValue({ ok: true, preview });
    const response = await POST(post({ clientId: "c1" }));
    expect(response.status).toBe(200);
    expect(previewPlannerTestPurge).toHaveBeenCalledWith(AUTH.supabaseClient, {
      ownerId: "owner_1",
      clientId: "c1",
    });
    expect((await response.json()).preview).toEqual(preview);
  });

  it("maps a blocked purge preview through (still 200 — the blockers are the answer)", async () => {
    const preview = {
      clientId: "c1",
      counts: { forge_work_packages: 7 },
      blockers: [{ type: "non_sample_package", count: 1, message: "1 non-sample package(s) attached to this test client — move or delete them first" }],
      canPurge: false,
      digest: "b".repeat(64),
    };
    previewPlannerTestPurge.mockResolvedValue({ ok: true, preview });
    const response = await POST(post({ clientId: "c1" }));
    expect(response.status).toBe(200);
    expect((await response.json()).preview.canPurge).toBe(false);
  });

  it("maps a missing test client to 404", async () => {
    previewPlannerTestPurge.mockResolvedValue({
      ok: false,
      httpStatus: 404,
      error: "That test project or test client does not exist.",
    });
    const response = await POST(post({ clientId: "c-missing" }));
    expect(response.status).toBe(404);
  });

  it("returns the 401 response when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: Response.json({ error: "Authenticated owner id is required." }, { status: 401 }),
    });
    const response = await POST(post({ clientId: "c1" }));
    expect(response.status).toBe(401);
    expect(previewPlannerTestPurge).not.toHaveBeenCalled();
  });
});
