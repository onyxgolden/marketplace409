import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({
    error: result.error,
    ...(result.affectedStepIds ? { affectedStepIds: result.affectedStepIds } : {}),
  }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/manpowerCurve", () => ({
  getManpowerCurve: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { getManpowerCurve } from "@/application/work-management/manpowerCurve";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/manpower-curve", () => {
  it("returns the server-computed curve with the package status", async () => {
    getManpowerCurve.mockResolvedValue({
      ok: true,
      curve: {
        windowConfigured: true,
        baseline: { versionNumber: 1, baselineStart: "2026-11-09", baselineFinish: "2026-11-18" },
        window: { baselineVersion: 1, outageStartDate: "2026-11-09", outageEndDate: "2026-11-18", outageDays: 10 },
        days: [{ dayIndex: 1, date: "2026-11-09", totalRequiredHours: 10 }],
        totals: { requiredHours: 40 },
        notApplied: false,
      },
      packageStatus: "in_progress",
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(getManpowerCurve).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1", baselineVersion: null });
    const body = await response.json();
    expect(body.windowConfigured).toBe(true);
    expect(body.totals.requiredHours).toBe(40);
    expect(body.packageStatus).toBe("in_progress");
  });

  it("passes a named baseline version through to the service", async () => {
    getManpowerCurve.mockResolvedValue({
      ok: true,
      curve: { windowConfigured: true, notApplied: false },
      packageStatus: "in_progress",
    });
    const response = await GET(new Request("https://test/x?baselineVersion=2"), { params: params() });
    expect(response.status).toBe(200);
    expect(getManpowerCurve).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1", baselineVersion: 2 });
  });

  it("rejects a non-numeric or non-positive baseline version before calling the service", async () => {
    for (const bad of ["abc", "0", "-1", "1.5"]) {
      vi.clearAllMocks();
      const response = await GET(new Request(`https://test/x?baselineVersion=${bad}`), { params: params() });
      expect(response.status).toBe(400);
      expect(getManpowerCurve).not.toHaveBeenCalled();
    }
  });

  it("forwards a service failure with its status", async () => {
    getManpowerCurve.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Work package not found.");
  });

  it("returns the auth error without calling the service", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthenticated." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(getManpowerCurve).not.toHaveBeenCalled();
  });
});
