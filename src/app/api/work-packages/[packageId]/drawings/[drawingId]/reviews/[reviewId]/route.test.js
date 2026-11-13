import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  getReviewDetail: vi.fn(),
}));

import { workAuth } from "../../../../../_lib/auth.js";
import { getReviewDetail } from "@/application/work-management/drawingReviews";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1", reviewId: "forge_wpdrvw_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET review detail", () => {
  it("returns the review with redlines and audit events", async () => {
    getReviewDetail.mockResolvedValue({
      ok: true,
      review: { id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN" },
      redlines: [{ id: "forge_wpdrl_1", severity: "REQUIRED" }],
      events: [{ id: "forge_wpdre_1", eventType: "REVIEW_OPENED" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(getReviewDetail).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1", limit: null, offset: null,
    });
    const body = await response.json();
    expect(body.redlines).toHaveLength(1);
    expect(body.events).toHaveLength(1);
  });

  it("forwards a 404 for a review from another drawing", async () => {
    getReviewDetail.mockResolvedValue({ ok: false, httpStatus: 404, error: "Review not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});
