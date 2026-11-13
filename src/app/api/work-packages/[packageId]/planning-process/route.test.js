// Work Package Planner — planning-process checklist routes.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/planningProcess", () => ({
  getPlanningChecklist: vi.fn(),
  setPlanningStepStatus: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { getPlanningChecklist, setPlanningStepStatus } from "@/application/work-management/planningProcess";
import { GET, PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/planning-process", () => {
  it("returns the checklist with computed progress", async () => {
    const checklist = {
      packageId: "pkg_1",
      complexity: "standard",
      canUpdate: true,
      canReview: false,
      template: [{ stepKey: "pdf-01" }],
      instances: [{ templateStepId: "pdf-01", status: "Complete" }],
      progress: { percentComplete: 5, earnedMhrs: 2, totalMhrs: 40 },
    };
    getPlanningChecklist.mockResolvedValue({ ok: true, notApplied: false, checklist });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(getPlanningChecklist).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1" });
    const body = await response.json();
    expect(body.checklist.progress.percentComplete).toBe(5);
  });

  it("reports notApplied when the migration has not applied yet", async () => {
    getPlanningChecklist.mockResolvedValue({ ok: true, notApplied: true, checklist: null });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.notApplied).toBe(true);
    expect(body.checklist).toBeNull();
  });

  it("returns the service error status", async () => {
    getPlanningChecklist.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/work-packages/[packageId]/planning-process", () => {
  it("forwards the status change to the service and returns the instance", async () => {
    setPlanningStepStatus.mockResolvedValue({
      ok: true,
      instance: { templateStepId: "pdf-01", status: "Complete" },
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ templateStepId: "pdf-01", status: "Complete", expectedVersion: 1 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(setPlanningStepStatus).toHaveBeenCalledWith(AUTH.db, expect.objectContaining({
      ownerId: "owner_1",
      packageId: "pkg_1",
      templateStepId: "pdf-01",
      status: "Complete",
      evidenceLink: undefined,
      reason: undefined,
      attestation: undefined,
      expectedVersion: 1,
    }));
    // No client request ID: the route generates one (idempotency key).
    const call = setPlanningStepStatus.mock.calls[0][1];
    expect(typeof call.requestId).toBe("string");
    expect(call.requestId.length).toBeGreaterThan(0);
    const body = await response.json();
    expect(body.instance.status).toBe("Complete");
  });

  it("passes a client-supplied request ID, reason, attestation, and expected version through", async () => {
    setPlanningStepStatus.mockResolvedValue({
      ok: true,
      instance: { templateStepId: "pdf-06", status: "N/A" },
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({
          templateStepId: "pdf-06", status: "N/A",
          reason: "No engineering request needed on this package.",
          attestation: undefined, expectedVersion: 3, requestId: "req_client_1",
        }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(setPlanningStepStatus).toHaveBeenCalledWith(AUTH.db, expect.objectContaining({
      templateStepId: "pdf-06",
      status: "N/A",
      reason: "No engineering request needed on this package.",
      expectedVersion: 3,
      requestId: "req_client_1",
    }));
  });

  it("forwards an evidence link when supplied", async () => {
    setPlanningStepStatus.mockResolvedValue({
      ok: true,
      instance: { templateStepId: "pdf-01", status: "Complete", evidenceLink: "https://example.com/x.pdf" },
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ templateStepId: "pdf-01", status: "Complete", evidenceLink: "https://example.com/x.pdf", expectedVersion: 1 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(setPlanningStepStatus).toHaveBeenCalledWith(AUTH.db, expect.objectContaining({
      evidenceLink: "https://example.com/x.pdf",
    }));
  });

  it("returns the service error status (reviewer gate)", async () => {
    setPlanningStepStatus.mockResolvedValue({
      ok: false, httpStatus: 403, error: "Only a reviewer can mark a step Reviewed.",
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ templateStepId: "pdf-01", status: "Reviewed", expectedVersion: 2 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("Only a reviewer");
  });

  it("returns 400 for a missing or invalid expectedVersion before the service (F2)", async () => {
    for (const expectedVersion of [undefined, null, 0, -1, 1.5, "1"]) {
      const response = await PATCH(
        new Request("https://test/x", {
          method: "PATCH",
          body: JSON.stringify({ templateStepId: "pdf-01", status: "Complete", expectedVersion }),
        }),
        { params: params() },
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/expectedVersion must be a positive whole number/);
    }
    expect(setPlanningStepStatus).not.toHaveBeenCalled();
  });
});
