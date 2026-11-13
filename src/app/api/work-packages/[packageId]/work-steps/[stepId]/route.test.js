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
  updateWorkStep: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { updateWorkStep } from "@/application/work-management/workSteps";
import { PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", stepId: "forge_wps_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("PATCH /api/work-packages/[packageId]/work-steps/[stepId]", () => {
  it("forwards the patch to the service", async () => {
    updateWorkStep.mockResolvedValue({ ok: true, step: { id: "forge_wps_1", version: 2 } });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, title: "New title" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(updateWorkStep).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepId: "forge_wps_1",
      patch: { expectedVersion: 1, title: "New title" },
    });
  });

  it("returns 409 on a stale version", async () => {
    updateWorkStep.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "This work step was changed by someone else — refresh and try again.",
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, title: "Stale" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
