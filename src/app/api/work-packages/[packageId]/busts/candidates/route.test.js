import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/busts", () => ({
  getBustCandidates: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../_lib/auth.js";
import { getBustCandidates } from "@/application/work-management/busts";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/busts/candidates", () => {
  it("returns candidates, insufficiencies and targets, read-only", async () => {
    getBustCandidates.mockResolvedValue({
      ok: true,
      packageId: "pkg_1", packageStatus: "in_progress", asOf: "2026-11-15",
      baseline: { id: "base_2", versionNumber: 2 },
      controlEstimate: null,
      candidates: [{ dimension: "LABOR_COST", varianceValue: 250000 }],
      insufficiencies: [{ dimension: "MANPOWER_SHORTFALL", reason: "No assignments on file." }],
      targets: { takeoffLines: [], steps: [] },
    });
    const response = await GET(
      new Request("https://test/x?asOf=2026-11-15&baselineVersion=2"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(getBustCandidates).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      asOf: "2026-11-15", baselineVersion: 2,
    });
    const body = await response.json();
    expect(body.candidates).toHaveLength(1);
    expect(body.insufficiencies).toHaveLength(1);
    expect(body.asOf).toBe("2026-11-15");
  });

  it("defaults asOf and baselineVersion when the query is empty", async () => {
    getBustCandidates.mockResolvedValue({
      ok: true, packageId: "pkg_1", packageStatus: "in_progress", asOf: "2026-11-15",
      baseline: null, controlEstimate: null, candidates: [], insufficiencies: [], targets: {},
    });
    await GET(new Request("https://test/x"), { params: params() });
    expect(getBustCandidates).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      asOf: undefined, baselineVersion: undefined,
    });
  });

  it("returns the service error status", async () => {
    getBustCandidates.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Work package not found.");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(getBustCandidates).not.toHaveBeenCalled();
  });

  it("returns the package-scope failure untouched", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Package not found." }, { status: 404 }));
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect(getBustCandidates).not.toHaveBeenCalled();
  });
});
