import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
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
  getCurveSettings: vi.fn(),
  setCurveSettings: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { getCurveSettings, setCurveSettings } from "@/application/work-management/manpowerCurve";
import { GET, PUT } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/manpower-curve/settings", () => {
  it("returns settings with their history and the package status", async () => {
    getCurveSettings.mockResolvedValue({
      ok: true,
      settings: { outageStartDate: "2026-11-09", outageDays: 10, version: 2 },
      revisions: [{ version: 1, action: "create" }],
      notApplied: false,
      packageStatus: "in_progress",
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(getCurveSettings).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1" });
    const body = await response.json();
    expect(body.settings.version).toBe(2);
    expect(body.revisions).toHaveLength(1);
    expect(body.packageStatus).toBe("in_progress");
  });
});

describe("PUT /api/work-packages/[packageId]/manpower-curve/settings", () => {
  it("forwards the body to the service and returns the saved settings", async () => {
    setCurveSettings.mockResolvedValue({
      ok: true,
      settings: { outageStartDate: "2026-11-09", outageDays: 12, version: 3 },
      packageStatus: "in_progress",
    });
    const response = await PUT(
      new Request("https://test/x", {
        method: "PUT",
        body: JSON.stringify({ outageStartDate: "2026-11-09", outageDays: 12, expectedVersion: 2, reason: "Outage extended" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(setCurveSettings).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      input: { outageStartDate: "2026-11-09", outageDays: 12, expectedVersion: 2, reason: "Outage extended" },
    });
    const body = await response.json();
    expect(body.settings.outageDays).toBe(12);
  });

  it("passes affected step ids through on a placement-outside-window failure", async () => {
    setCurveSettings.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      code: "PLACEMENT_OUTSIDE_WINDOW",
      error: "That change would push 1 step outside the outage window — adjust the window or move the placement first.",
      affectedStepIds: ["step_1"],
    });
    const response = await PUT(
      new Request("https://test/x", {
        method: "PUT",
        body: JSON.stringify({ outageStartDate: "2026-11-09", outageDays: 8, expectedVersion: 2 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.affectedStepIds).toEqual(["step_1"]);
  });
});
