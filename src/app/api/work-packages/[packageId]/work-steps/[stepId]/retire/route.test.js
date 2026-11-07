import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/workSteps", () => ({
  retireWorkStep: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { retireWorkStep } from "@/application/work-management/workSteps";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", stepId: "forge_wps_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/work-steps/[stepId]/retire", () => {
  it("forwards version, reason, and the historical-correction flag", async () => {
    retireWorkStep.mockResolvedValue({ ok: true, step: { id: "forge_wps_1", version: 2 } });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "No longer needed", historicalCorrection: true }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireWorkStep).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepId: "forge_wps_1",
      expectedVersion: 1,
      reason: "No longer needed",
      historicalCorrection: true,
    });
  });

  it("returns 400 when the reason is missing", async () => {
    retireWorkStep.mockResolvedValue({ ok: false, httpStatus: 400, error: "A reason is required for this change." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
