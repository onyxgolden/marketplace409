import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({
    error: result.error,
    ...(result.affectedStepIds ? { affectedStepIds: result.affectedStepIds } : {}),
  }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/manpowerCurve", () => ({
  clearStepPlacement: vi.fn(),
  listPlacementRevisions: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { clearStepPlacement, listPlacementRevisions } from "@/application/work-management/manpowerCurve";
import { GET, DELETE } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", placementId: "place_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/manpower-curve/placements/[placementId]", () => {
  it("forwards paging to the service and returns the placement with its history", async () => {
    listPlacementRevisions.mockResolvedValue({
      ok: true,
      placement: { id: "place_1", stepId: "step_1", startDayIndex: 3, version: 2 },
      revisions: [{ version: 1, action: "set" }, { version: 2, action: "set" }],
      hasMore: false,
      packageStatus: "in_progress",
    });
    const response = await GET(
      new Request("https://test/x?limit=100&offset=0"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(listPlacementRevisions).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      placementId: "place_1",
      limit: "100",
      offset: "0",
    });
    const body = await response.json();
    expect(body.revisions).toHaveLength(2);
    expect(body.hasMore).toBe(false);
  });
});

describe("DELETE /api/work-packages/[packageId]/manpower-curve/placements/[placementId]", () => {
  it("forwards the version and reason to the service and returns the retired placement", async () => {
    clearStepPlacement.mockResolvedValue({
      ok: true,
      placement: { id: "place_1", stepId: "step_1", startDayIndex: 3, version: 2, retiredAt: "t3" },
      packageStatus: "in_progress",
    });
    const response = await DELETE(
      new Request("https://test/x", {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 1, reason: "No longer sequenced" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(clearStepPlacement).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      placementId: "place_1",
      expectedVersion: 1,
      reason: "No longer sequenced",
    });
    const body = await response.json();
    expect(body.placement.retiredAt).toBe("t3");
  });
});
