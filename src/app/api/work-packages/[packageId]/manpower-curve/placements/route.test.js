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
  setStepPlacement: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { setStepPlacement } from "@/application/work-management/manpowerCurve";
import { PUT } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("PUT /api/work-packages/[packageId]/manpower-curve/placements", () => {
  it("forwards the body to the service and returns the saved placement", async () => {
    setStepPlacement.mockResolvedValue({
      ok: true,
      placement: { id: "place_1", stepId: "step_1", startDayIndex: 3, version: 1 },
      packageStatus: "in_progress",
    });
    const response = await PUT(
      new Request("https://test/x", {
        method: "PUT",
        body: JSON.stringify({ stepId: "step_1", startDayIndex: 3 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(setStepPlacement).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      input: { stepId: "step_1", startDayIndex: 3 },
    });
    const body = await response.json();
    expect(body.placement.startDayIndex).toBe(3);
  });

  it("forwards a version conflict with its status", async () => {
    setStepPlacement.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "The manpower curve was changed by someone else — refresh and try again.",
    });
    const response = await PUT(
      new Request("https://test/x", {
        method: "PUT",
        body: JSON.stringify({ stepId: "step_1", startDayIndex: 4, expectedVersion: 1, reason: "Sequencing" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/changed by someone else/);
  });
});
