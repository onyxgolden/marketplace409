// POST /api/forge/planner/test-data/load — owner-only sample loader.

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
import { loadPlannerTestSamples } from "@/application/work-management/plannerTestData";
import { POST } from "./route.js";

const AUTH = { supabaseClient: { marker: "db" }, effectiveOwnerId: "owner_1" };

beforeEach(() => {
  vi.clearAllMocks();
  createAuthenticatedForgeApplication.mockResolvedValue(AUTH);
});

function post(body) {
  return new Request("https://test/api/forge/planner/test-data/load", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/forge/planner/test-data/load", () => {
  it("loads samples into the test project and returns the load receipt", async () => {
    const load = { packages: 6, steps: 31, alreadyLoaded: false, message: "Loaded 6 sample packages / 31 steps" };
    loadPlannerTestSamples.mockResolvedValue({ ok: true, load });
    const response = await POST(post({ projectId: "p1", requestId: "req-1" }));
    expect(response.status).toBe(200);
    expect(loadPlannerTestSamples).toHaveBeenCalledWith(AUTH.supabaseClient, {
      ownerId: "owner_1",
      projectId: "p1",
      requestId: "req-1",
    });
    expect((await response.json()).load).toEqual(load);
  });

  it("generates a request id when omitted", async () => {
    loadPlannerTestSamples.mockResolvedValue({ ok: true, load: { packages: 6, steps: 31 } });
    const response = await POST(post({ projectId: "p1" }));
    expect(response.status).toBe(200);
    const requestId = loadPlannerTestSamples.mock.calls[0][1].requestId;
    expect(typeof requestId).toBe("string");
    expect(requestId.length).toBeGreaterThan(10);
  });

  it("maps a non-test-project error to 400 without revealing the project", async () => {
    loadPlannerTestSamples.mockResolvedValue({
      ok: false,
      httpStatus: 400,
      error: "Choose a test project — that project is real data, not test data.",
    });
    const response = await POST(post({ projectId: "p-real", requestId: "req-2" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Choose a test project — that project is real data, not test data.");
  });

  it("maps a missing test project to 404", async () => {
    loadPlannerTestSamples.mockResolvedValue({
      ok: false,
      httpStatus: 404,
      error: "That test project or test client does not exist.",
    });
    const response = await POST(post({ projectId: "p-missing", requestId: "req-3" }));
    expect(response.status).toBe(404);
  });

  it("returns the 401 response when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: Response.json({ error: "Authenticated owner id is required." }, { status: 401 }),
    });
    const response = await POST(post({ projectId: "p1", requestId: "req-4" }));
    expect(response.status).toBe(401);
    expect(loadPlannerTestSamples).not.toHaveBeenCalled();
  });
});
