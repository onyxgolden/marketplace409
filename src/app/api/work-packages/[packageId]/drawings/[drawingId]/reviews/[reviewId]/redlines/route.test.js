import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  createRedline: vi.fn(),
}));

import { workAuth } from "../../../../../../_lib/auth.js";
import { createRedline } from "@/application/work-management/drawingReviews";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1", reviewId: "forge_wpdrvw_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST redlines", () => {
  it("adds a redline and returns 201", async () => {
    createRedline.mockResolvedValue({
      ok: true, redline: { id: "forge_wpdrl_1", severity: "REQUIRED" },
    });
    const input = {
      drawingRevisionId: "forge_wpdrv_1", comment: "Move this nozzle 50 mm up.",
      severity: "REQUIRED", anchorPage: 2, anchorX: 0.5, anchorY: 0.25,
    };
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createRedline).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1", input,
    });
  });

  it("forwards a closed review as 409", async () => {
    createRedline.mockResolvedValue({ ok: false, httpStatus: 409, error: "This review is closed — open a new round to continue." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ drawingRevisionId: "forge_wpdrv_1", comment: "x", severity: "INFO" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
