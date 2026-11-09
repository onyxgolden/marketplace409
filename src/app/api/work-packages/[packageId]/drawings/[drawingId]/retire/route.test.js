import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  retireDrawing: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { retireDrawing } from "@/application/work-management/drawingReviews";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST retire", () => {
  it("retires a drawing and returns it", async () => {
    retireDrawing.mockResolvedValue({
      ok: true, drawing: { id: "dwg_1", retiredAt: "t2" },
    });
    const input = { reason: "Superseded by a re-issue." };
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireDrawing).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", input,
    });
    expect((await response.json()).drawing.retiredAt).toBe("t2");
  });

  it("forwards an already-retired drawing as 409", async () => {
    retireDrawing.mockResolvedValue({ ok: false, httpStatus: 409, error: "This drawing is retired — drawing reviews cannot change." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST", body: JSON.stringify({ reason: "Superseded." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
