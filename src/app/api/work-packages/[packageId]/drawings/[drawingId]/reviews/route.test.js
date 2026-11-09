import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  createReview: vi.fn(),
  listReviews: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { createReview, listReviews } from "@/application/work-management/drawingReviews";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET reviews", () => {
  it("lists review rounds for the drawing", async () => {
    listReviews.mockResolvedValue({
      ok: true,
      drawing: { id: "dwg_1", drawingNumber: "P-101" },
      reviews: [{ id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listReviews).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", limit: null, offset: null,
    });
    expect((await response.json()).reviews).toHaveLength(1);
  });
});

describe("POST reviews", () => {
  it("opens a review round and returns 201", async () => {
    createReview.mockResolvedValue({
      ok: true, review: { id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN" },
    });
    const input = { drawingRevisionId: "forge_wpdrv_1", reason: "Ready for review." };
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createReview).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", input,
    });
  });

  it("forwards a duplicate open review as 409", async () => {
    createReview.mockResolvedValue({ ok: false, httpStatus: 409, error: "This revision already has an open review." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST", body: JSON.stringify({ drawingRevisionId: "forge_wpdrv_1" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
