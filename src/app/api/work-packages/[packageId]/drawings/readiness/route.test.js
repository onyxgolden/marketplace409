import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  getDrawingReadiness: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { getDrawingReadiness } from "@/application/work-management/drawingReviews";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/drawings/readiness", () => {
  it("returns the snapshot with counts", async () => {
    getDrawingReadiness.mockResolvedValue({
      ok: true, packageId: "pkg_1", packageStatus: "in_progress",
      drawings: [{ drawingId: "dwg_1", badge: "IFA — In review", constructionUsable: false }],
      counts: { drawingsTotal: 1, ifcReleased: 0, pendingReview: 1, returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0 },
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(getDrawingReadiness).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1" });
    const body = await response.json();
    expect(body.counts.pendingReview).toBe(1);
    expect(body.drawings[0].badge).toBe("IFA — In review");
  });

  it("forwards a service failure with its status", async () => {
    getDrawingReadiness.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Work package not found.");
  });

  it("returns the auth error without calling the service", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "x" }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(getDrawingReadiness).not.toHaveBeenCalled();
  });
});
