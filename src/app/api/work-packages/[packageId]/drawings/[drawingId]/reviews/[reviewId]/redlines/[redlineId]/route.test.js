import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  resolveRedline: vi.fn(),
}));

import { workAuth } from "../../../../../../../_lib/auth.js";
import { resolveRedline } from "@/application/work-management/drawingReviews";
import { PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({
  packageId: "pkg_1", drawingId: "dwg_1",
  reviewId: "forge_wpdrvw_1", redlineId: "forge_wpdrl_1",
});

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("PATCH redline", () => {
  it("resolves a redline and returns it", async () => {
    resolveRedline.mockResolvedValue({
      ok: true, redline: { id: "forge_wpdrl_1", resolution: "RESOLVED", version: 2 },
    });
    const input = { expectedVersion: 1, resolution: "RESOLVED", resolutionNote: "Moved." };
    const response = await PATCH(
      new Request("https://test/x", { method: "PATCH", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(resolveRedline).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1", redlineId: "forge_wpdrl_1", input,
    });
    expect((await response.json()).redline.resolution).toBe("RESOLVED");
  });

  it("forwards a version conflict as 409", async () => {
    resolveRedline.mockResolvedValue({ ok: false, httpStatus: 409, error: "This record was changed by someone else — refresh and try again." });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, resolution: "RESOLVED", resolutionNote: "Moved." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
