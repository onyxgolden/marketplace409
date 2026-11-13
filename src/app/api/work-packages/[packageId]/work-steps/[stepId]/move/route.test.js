import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/workSteps", () => ({
  moveWorkStep: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { moveWorkStep } from "@/application/work-management/workSteps";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", stepId: "forge_wps_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/work-steps/[stepId]/move", () => {
  it("forwards the step, target position, and generation to the service", async () => {
    moveWorkStep.mockResolvedValue({
      ok: true,
      steps: [{ id: "forge_wps_2", sequenceNo: 1 }, { id: "forge_wps_1", sequenceNo: 2 }],
      generation: 3,
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ targetSequenceNo: 2, expectedGeneration: 2, reason: "Field order" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(moveWorkStep).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepId: "forge_wps_1",
      targetSequenceNo: 2,
      expectedGeneration: 2,
      reason: "Field order",
    });
    const body = await response.json();
    expect(body.generation).toBe(3);
    expect(body.steps).toHaveLength(2);
  });

  it("returns 409 on a stale generation", async () => {
    moveWorkStep.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "This work step was changed by someone else — refresh and try again.",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ targetSequenceNo: 2, expectedGeneration: 1 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });

  it("returns 400 on an out-of-range target position", async () => {
    moveWorkStep.mockResolvedValue({
      ok: false,
      httpStatus: 400,
      error: "Insert position must be within the current step list.",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ targetSequenceNo: 99, expectedGeneration: 2 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
