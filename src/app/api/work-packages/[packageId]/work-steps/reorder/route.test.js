import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/workSteps", () => ({
  reorderWorkSteps: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { reorderWorkSteps } from "@/application/work-management/workSteps";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/work-steps/reorder", () => {
  it("forwards the permutation and generation to the service", async () => {
    reorderWorkSteps.mockResolvedValue({
      ok: true,
      steps: [{ id: "forge_wps_2", sequenceNo: 1 }, { id: "forge_wps_1", sequenceNo: 2 }],
      generation: 3,
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ stepIds: ["forge_wps_2", "forge_wps_1"], expectedGeneration: 2, reason: "Field order" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(reorderWorkSteps).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepIds: ["forge_wps_2", "forge_wps_1"],
      expectedGeneration: 2,
      reason: "Field order",
    });
    const body = await response.json();
    expect(body.generation).toBe(3);
    expect(body.steps).toHaveLength(2);
  });

  it("returns 409 on a stale generation", async () => {
    reorderWorkSteps.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "This work step was changed by someone else — refresh and try again.",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ stepIds: ["forge_wps_1"], expectedGeneration: 1 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
