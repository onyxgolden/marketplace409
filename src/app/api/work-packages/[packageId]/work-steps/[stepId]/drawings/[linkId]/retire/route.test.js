import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/workSteps", () => ({
  retireStepDrawingLink: vi.fn(),
}));

import { workAuth } from "../../../../../../_lib/auth.js";
import { retireStepDrawingLink } from "@/application/work-management/workSteps";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", stepId: "forge_wps_1", linkId: "forge_wpsl_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/work-steps/[stepId]/drawings/[linkId]/retire", () => {
  it("forwards version and reason to the service", async () => {
    retireStepDrawingLink.mockResolvedValue({ ok: true, link: { id: "forge_wpsl_1", version: 2 } });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Wrong drawing" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireStepDrawingLink).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepId: "forge_wps_1",
      linkId: "forge_wpsl_1",
      expectedVersion: 1,
      reason: "Wrong drawing",
    });
  });

  it("returns 404 for an unknown link", async () => {
    retireStepDrawingLink.mockResolvedValue({ ok: false, httpStatus: 404, error: "Drawing link not found." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Wrong drawing" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(404);
  });
});
