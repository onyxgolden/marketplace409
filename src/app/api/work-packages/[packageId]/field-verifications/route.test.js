import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  // Mirrors the real fail() in ../../_lib/auth.js — including the
  // notApplied forward (FV-1) — so the route test asserts the service
  // result reaches the response body unchanged.
  fail: (result) => Response.json({ error: result.error, ...(result.notApplied ? { notApplied: true } : {}) }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/fieldVerifications", () => ({
  createFieldVerification: vi.fn(),
  listFieldVerifications: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../_lib/auth.js";
import { createFieldVerification, listFieldVerifications } from "@/application/work-management/fieldVerifications";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/field-verifications", () => {
  it("returns the paged verifications with the filters and summary passed through", async () => {
    listFieldVerifications.mockResolvedValue({
      ok: true,
      verifications: [{ id: "forge_wpfv_1", status: "DRAFT" }],
      summary: { total: 1, draft: 1, submitted: 0, accepted: 0, returned: 0, rejected: 0, retired: 0, changedSinceReview: 0 },
      total: 1, limit: 100, offset: 0,
    });
    const response = await GET(
      new Request("https://test/x?status=DRAFT&targetType=WORK_STEP&workLocation=FIELD&includeRetired=true&limit=10&offset=20"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(listFieldVerifications).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      status: "DRAFT", targetType: "WORK_STEP", workLocation: "FIELD",
      includeRetired: true, limit: "10", offset: "20",
    });
    const body = await response.json();
    expect(body.verifications).toHaveLength(1);
    expect(body.summary.total).toBe(1);
  });

  it("defaults to no filters and retired excluded", async () => {
    listFieldVerifications.mockResolvedValue({
      ok: true, verifications: [], summary: { total: 0 }, total: 0, limit: 100, offset: 0,
    });
    await GET(new Request("https://test/x"), { params: params() });
    expect(listFieldVerifications).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      status: undefined, targetType: undefined, workLocation: undefined,
      includeRetired: false, limit: undefined, offset: undefined,
    });
  });

  it("returns the service error status", async () => {
    listFieldVerifications.mockResolvedValue({ ok: false, httpStatus: 503, error: "Field verification isn't available yet — the database change for this feature hasn't been applied." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(503);
  });

  it("carries the not-applied flag through on the 503 body", async () => {
    listFieldVerifications.mockResolvedValue({ ok: false, httpStatus: 503, error: "Field verification isn't available yet — the database change for this feature hasn't been applied.", notApplied: true });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.notApplied).toBe(true);
    expect(body.error).toContain("isn't available yet");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(listFieldVerifications).not.toHaveBeenCalled();
  });

  it("returns the package-scope failure untouched", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Package not found." }, { status: 404 }));
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect(listFieldVerifications).not.toHaveBeenCalled();
  });
});

describe("POST /api/work-packages/[packageId]/field-verifications", () => {
  const body = {
    targetType: "WORK_STEP",
    stepId: "forge_step_1",
    workLocation: "FIELD",
    inspectionDate: "2026-11-15",
    sourceCheckedAt: "2026-11-15T12:00:00Z",
    physicalCompletion: "PARTIALLY_COMPLETE",
    observationNote: "Spool welded and aligned against IFC revision R2.",
    evidenceRef: "field-photo-2026-11-15-01.jpg",
    sourceFingerprint: "a".repeat(32),
    requestId: "req_1",
  };

  it("creates with 201 and the created verification", async () => {
    createFieldVerification.mockResolvedValue({
      ok: true, verification: { id: "forge_wpfv_1", status: "DRAFT" },
    });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(body) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createFieldVerification).toHaveBeenCalledWith(AUTH.db, expect.objectContaining({
      ownerId: "owner_1", packageId: "pkg_1",
      targetType: "WORK_STEP", stepId: "forge_step_1",
      sourceFingerprint: "a".repeat(32), requestId: "req_1",
    }));
    expect((await response.json()).verification.id).toBe("forge_wpfv_1");
  });

  it("returns the stale-source 409", async () => {
    createFieldVerification.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "The plan or recorded actuals changed since this observation was reviewed. Review the updated source and resubmit.",
    });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(body) }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
