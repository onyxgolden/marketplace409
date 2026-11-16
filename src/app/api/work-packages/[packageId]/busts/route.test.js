import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/busts", () => ({
  confirmBust: vi.fn(),
  listBusts: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../_lib/auth.js";
import { confirmBust, listBusts } from "@/application/work-management/busts";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/busts", () => {
  it("returns the paged busts with the filters passed through", async () => {
    listBusts.mockResolvedValue({
      ok: true,
      busts: [{ id: "forge_wpbust_1", status: "OPEN" }],
      total: 1, limit: 100, offset: 0,
    });
    const response = await GET(
      new Request("https://test/x?status=OPEN&dimension=LABOR_COST&scope=PACKAGE&includeRetired=true&limit=10&offset=20"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(listBusts).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      status: "OPEN", dimension: "LABOR_COST", scopeType: "PACKAGE",
      includeRetired: true, limit: "10", offset: "20",
    });
    const body = await response.json();
    expect(body.busts).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("defaults to no filters and retired excluded", async () => {
    listBusts.mockResolvedValue({ ok: true, busts: [], total: 0, limit: 100, offset: 0 });
    await GET(new Request("https://test/x"), { params: params() });
    expect(listBusts).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      status: undefined, dimension: undefined, scopeType: undefined,
      includeRetired: false, limit: undefined, offset: undefined,
    });
  });

  it("returns the service error status", async () => {
    listBusts.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Work package not found.");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(listBusts).not.toHaveBeenCalled();
  });

  it("returns the package-scope failure untouched", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Package not found." }, { status: 404 }));
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect(listBusts).not.toHaveBeenCalled();
  });
});

describe("POST /api/work-packages/[packageId]/busts", () => {
  const body = {
    dimension: "LABOR_COST",
    scopeType: "PACKAGE",
    baselineId: "base_1",
    baselineVersion: 1,
    plannedValue: 1000000,
    observedValue: 1250000,
    unit: "USD_CENTS",
    evidenceSummary: "Actual cost is over the frozen baseline.",
    comparisonAsOf: "2026-11-15",
    requestId: "req_1",
    reason: "Confirming the detected overrun.",
  };

  it("confirms with 201 and the created bust", async () => {
    confirmBust.mockResolvedValue({
      ok: true,
      bust: { id: "forge_wpbust_1", status: "OPEN", version: 1 },
    });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(body) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(confirmBust).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      dimension: "LABOR_COST", scopeType: "PACKAGE",
      takeoffLineId: null, workStepId: null, craft: null, workDate: null, shiftKey: null,
      baselineId: "base_1", baselineVersion: 1,
      plannedValue: 1000000, observedValue: 1250000, unit: "USD_CENTS",
      evidenceSummary: "Actual cost is over the frozen baseline.",
      evidenceRef: null, comparisonAsOf: "2026-11-15",
      sourceFingerprint: null, requestId: "req_1",
      reason: "Confirming the detected overrun.",
    });
    expect((await response.json()).bust.id).toBe("forge_wpbust_1");
  });

  it("returns 409 when the service refuses a duplicate confirmation", async () => {
    confirmBust.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "A matching bust is already recorded (forge_wpbust_1).",
    });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(body) }),
      { params: params() },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("forge_wpbust_1");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(body) }),
      { params: params() },
    );
    expect(response.status).toBe(401);
    expect(confirmBust).not.toHaveBeenCalled();
  });
});
