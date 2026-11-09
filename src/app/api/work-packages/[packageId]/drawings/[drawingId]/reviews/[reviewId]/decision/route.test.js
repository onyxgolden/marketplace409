import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  decideReview: vi.fn(),
}));

import { workAuth } from "../../../../../../_lib/auth.js";
import { decideReview } from "@/application/work-management/drawingReviews";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1", reviewId: "forge_wpdrvw_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST decision", () => {
  it("decides a review and returns it", async () => {
    decideReview.mockResolvedValue({
      ok: true, review: { id: "forge_wpdrvw_1", state: "APPROVED", version: 2 },
    });
    const input = { expectedVersion: 1, decision: "APPROVE", reason: "Checked against the P&ID." };
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(decideReview).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1", input,
    });
    expect((await response.json()).review.state).toBe("APPROVED");
  });

  it("forwards open redlines as 409 on approve", async () => {
    decideReview.mockResolvedValue({ ok: false, httpStatus: 409, error: "Resolve every open redline before approving." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, decision: "APPROVE", reason: "Checked." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
